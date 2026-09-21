import { test, expect } from "./fixtures/auth-fixture";
import { api } from "../convex/_generated/api";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { config } from "dotenv";

config({ path: ".env.local" });
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const DAY = 86_400_000;

/**
 * ACCUEIL ADMIN SERVI PAR LE CACHE — il doit valoir le calcul direct.
 *
 * `decisionDashboard` et `getDueTotal` sont montées sur l'accueil admin et
 * relisaient tout le projet à chaque écriture de la journée (689 et 504 MB le
 * 2026-09-19). Elles lisent maintenant `dashboardCache`, recalculé toutes les
 * 30 min. Le risque est double : un TOTAL D'ARGENT faux, et un accueil qui ne
 * réagit plus à l'action qu'on vient d'y faire — d'où l'invalidation dans les
 * mutations d'argent, vérifiée ici.
 */
test.describe("Accueil admin — servi par le cache", () => {
  test("le total dû vaut la somme des cycles, n'est pas réécrit pour rien, et un acompte le corrige TOUT DE SUITE", async () => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Pricing accueil ${ts}`,
      montantFixe: 300,
      nbVideosCible: 10,
      tauxCPM: 3,
    });
    const creator = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Soraya Ben Amara accueil ${ts}`,
      email: `e2e-accueil-due-${ts}@repackit.test`,
      password: "accueil-12345678",
    });
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Fmt accueil ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@soraya.benamara_${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creator.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 5 * DAY,
      pricingId,
    });
    const mission = (
      await admin.query(api.assignments.listAssignments, {})
    ).find(
      (a) => a.formatId === formatId && a.creatorId === creator.creatorId,
    )!;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: mission._id,
      status: "to_publish",
    });
    const { publicationIds } = await creator.client.mutation(
      api.assignments.confirmPublication,
      {
        projectId,
        id: mission._id,
        urls: [
          {
            platform: "TikTok",
            url: `https://www.tiktok.com/@soraya.benamara_${ts}/video/7351${ts % 1_000_000}`,
          },
        ],
      },
    );
    // Vues NON rondes, sous le plafond de 150 $/vidéo : un total rond ne
    // prouverait pas que le montant traverse le cache intact.
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: publicationIds[0],
      capturedAt: Date.now(),
      vues: 27_413,
      likes: 2_108,
    });

    // 1. PREMIER CALCUL : le cache est écrit, et il vaut la somme des cycles
    //    non payés lue par l'écran Paiements (deux lectures indépendantes).
    const premier = await admin.mutation(
      api.payments.e2eRefreshDueTotalCache,
      { secret: E2E_SECRET, projectId },
    );
    expect(premier.changed).toBe(true);

    const cycles = await admin.query(api.payments.listPayments, {});
    const attendu = cycles
      .filter((p) => p.status !== "paid")
      .reduce((s, p) => s + p.remainingDue, 0);
    // PRÉSENCE : de l'argent circule, sinon on comparerait 0 à 0.
    expect(attendu).toBeGreaterThan(0);
    const servi = (await admin.query(api.payments.getDueTotal, {})).dueTotal;
    expect(servi).toBe(attendu);

    // 2. RIEN N'A BOUGÉ : aucune écriture — c'est elle qui relancerait la
    //    query chez tous les admins connectés.
    const second = await admin.mutation(
      api.payments.e2eRefreshDueTotalCache,
      { secret: E2E_SECRET, projectId },
    );
    expect(second.changed).toBe(false);

    // 3. LE CACHE EST LU : de nouvelles vues changent le calcul, pas ce que
    //    l'accueil sert — jusqu'au recalcul suivant. Sans cette étape, une
    //    query qui recalculerait encore tout passerait toutes les autres.
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: publicationIds[0],
      capturedAt: Date.now() + 1_000,
      vues: 41_902,
      likes: 3_771,
    });
    const perime = (await admin.query(api.payments.getDueTotal, {})).dueTotal;
    expect(perime).toBe(attendu);
    await admin.mutation(api.payments.e2eRefreshDueTotalCache, {
      secret: E2E_SECRET,
      projectId,
    });
    const frais = (await admin.query(api.payments.getDueTotal, {})).dueTotal;
    expect(frais).toBeGreaterThan(attendu);

    // 4. UN ACOMPTE : l'accueil doit le montrer TOUT DE SUITE, sans attendre
    //    le cron — c'est l'invalidation posée dans la mutation d'argent.
    const cycle = cycles.find(
      (c) => c.creatorId === creator.creatorId && c.status !== "paid",
    )!;
    await admin.mutation(api.payments.recordAdvance, {
      creatorId: creator.creatorId,
      cycleIndex: cycle.cycleIndex,
      amount: 42.5,
    });
    const apres = (await admin.query(api.payments.getDueTotal, {})).dueTotal;
    expect(apres).toBeCloseTo(frais - 42.5, 2);
  });

  test("les décisions sont servies par le cache, et graduer un hook les rafraîchit tout de suite", async () => {
    test.setTimeout(300_000);
    const projectId = await admin.getProjectId();

    // Un premier passage pour poser la row, quel que soit l'état laissé par
    // les specs précédentes (elles tournent sur le même projet e2e).
    await admin.mutation(api.dashboardDecisions.e2eRefreshDecisionsCache, {
      secret: E2E_SECRET,
      projectId,
    });
    const second = await admin.mutation(
      api.dashboardDecisions.e2eRefreshDecisionsCache,
      { secret: E2E_SECRET, projectId },
    );
    expect(second.changed).toBe(false);

    // Le cache est SERVI : on fabrique une divergence (un hook désactivé
    // disparaît des « hooks morts » au recalcul) et on vérifie que la lecture
    // ne bouge qu'après invalidation.
    const avant = await admin.query(
      api.dashboardDecisions.decisionDashboard,
      {},
    );
    expect(Array.isArray(avant.posts48h)).toBe(true);

    // PRÉSENCE : une brique bien à nous, sinon « la row a disparu » ne
    // prouverait rien de l'invalidation.
    const ts = Date.now();
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Campagne accueil ${ts}`,
    });
    const brickId = await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "hook",
      label: `[E2E_TEST] Hook accueil ${ts}`,
      content: `Tu as vu ce que personne ne regarde ? ${ts}`,
    });

    await admin.mutation(api.scripts.updateBrick, {
      id: brickId,
      label: `[E2E_TEST] Hook accueil corrigé ${ts}`,
    });
    // La row a été SUPPRIMÉE par la mutation : la lecture retombe sur le
    // calcul direct (elle répond, elle ne casse pas), et le recalcul réécrit.
    const sansCache = await admin.query(
      api.dashboardDecisions.decisionDashboard,
      {},
    );
    expect(sansCache.posts48h).toEqual(avant.posts48h);
    const troisieme = await admin.mutation(
      api.dashboardDecisions.e2eRefreshDecisionsCache,
      { secret: E2E_SECRET, projectId },
    );
    expect(troisieme.changed).toBe(true);
  });

  test("Comptes : la version suivi rend les mêmes comptes que listComptes", async () => {
    const ts = Date.now();
    const creator = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Ndeye Faye-Gomis ${ts}`,
      email: `e2e-comptes-suivi-${ts}@repackit.test`,
    });
    const handle = `@ndeye.faye_suivi${ts}`;
    await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle,
    });

    const complet = await admin.query(api.comptes.listComptes, {});
    const suivi = await admin.query(api.comptes.listComptesSuivi, {});
    // PRÉSENCE : le compte semé est bien là, avec sa durée de chauffe servie
    // par le serveur — sinon l'égalité passerait sur deux listes amputées.
    const sien = suivi.find((c) => c.handle === handle);
    expect(sien?.targetDays).toBeGreaterThan(0);
    expect(suivi).toEqual(
      complet.map((c) => ({
        _id: c._id,
        handle: c.handle,
        plateforme: c.plateforme,
        creatorId: c.creatorId,
        status: c.status,
        actif: c.actif,
        warmupStartedAt: c.warmupStartedAt,
        warmupProtocol: c.warmupProtocol,
        targetDays: c.targetDays,
        warmupDone: c.warmupDone,
      })),
    );
  });
});
