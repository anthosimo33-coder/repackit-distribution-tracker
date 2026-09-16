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
 * CLASSEMENT DU PORTAIL LU DANS LE CACHE — il doit valoir le classement calculé.
 *
 * Le portail ne recalcule plus le classement : il lit `leaderboardCache`,
 * recalculé toutes les 10 minutes (convex/leaderboardCache.ts). C'était 45 % de
 * la facture Convex. Le risque de l'opération, c'est de l'ARGENT affiché faux :
 * cette spec compare, créatrice par créatrice, ce que le portail sert à ce que
 * le calcul direct (classement admin) rend.
 *
 * Elle prouve aussi que le cache est VRAIMENT lu. Sans la phase « périmé », une
 * query qui recalculerait encore tout passerait l'égalité — et la facture ne
 * baisserait pas.
 */
test.describe("Classement du portail — servi par le cache", () => {
  test("le cache vaut le calcul direct, n'est réécrit que s'il change, et c'est lui qui est lu", async () => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Pricing cache classement ${ts}`,
      montantFixe: 300,
      nbVideosCible: 10,
      tauxCPM: 3,
    });

    // Deux partenaires aux noms COMPLETS : une qui gagne (fixe + CPM sur des
    // vues non rondes), une ancrée sans rien publier (0 $, mais classée).
    const gagnante = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Marie-Clémentine Deschamps cache ${ts}`,
      email: `e2e-cache-classement-a-${ts}@repackit.test`,
      password: "classement-12345678",
    });
    const muette = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Inès Belkacem-Rousseau cache ${ts}`,
      email: `e2e-cache-classement-b-${ts}@repackit.test`,
      password: "classement-12345678",
    });

    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Fmt cache classement ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: gagnante.creatorId,
      platform: "TikTok",
      handle: `@e2e.cache_classement${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: gagnante.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 5 * DAY,
      pricingId,
    });
    const [mission] = (
      await admin.query(api.assignments.listAssignments, {})
    ).filter(
      (a) => a.formatId === formatId && a.creatorId === gagnante.creatorId,
    );
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: mission._id,
      status: "to_publish",
    });
    const { publicationIds } = await gagnante.client.mutation(
      api.assignments.confirmPublication,
      {
        projectId,
        id: mission._id,
        urls: [
          {
            platform: "TikTok",
            url: `https://www.tiktok.com/@e2e.cache_classement${ts}/video/73000000${ts % 100000}`,
          },
        ],
      },
    );
    const publicationId = publicationIds[0];
    expect(publicationId).toBeTruthy();
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId,
      capturedAt: Date.now(),
      vues: 21_413,
      likes: 3_021,
    });
    await admin.mutation(api.creators.e2eSetPayAnchor, {
      secret: E2E_SECRET,
      creatorId: muette.creatorId,
      firstPostAt: ts - 3 * DAY - 7_321_000,
    });

    const miennes = <T extends { name: string }>(rows: T[]) =>
      rows.filter((r) => r.name.includes(`cache ${ts}`));
    // Le rang dépend de TOUT le projet (d'autres specs y laissent des
    // créatrices) : il est vérifié à part, sur la liste servie entière.
    const sansRang = <T extends { rank: number }>(rows: T[]) =>
      rows.map((r) => ({ ...r, rank: undefined }));

    // 1. PREMIER CALCUL : le classement a bougé, la row est écrite.
    const premier = await admin.mutation(
      api.leaderboardCache.e2eRefreshLeaderboardCache,
      { secret: E2E_SECRET, projectId },
    );
    expect(premier.changed).toBe(true);

    // 2. RIEN N'A BOUGÉ : aucune écriture — c'est elle qui relancerait la query
    //    chez toutes les créatrices connectées.
    const second = await admin.mutation(
      api.leaderboardCache.e2eRefreshLeaderboardCache,
      { secret: E2E_SECRET, projectId },
    );
    expect(second.changed).toBe(false);

    // 3. ÉGALITÉ avec le calcul direct, du point de vue de la gagnante.
    const direct = await admin.query(api.payments.leaderboard, {});
    const servi = await gagnante.client.query(api.payments.projectLeaderboard, {
      projectId,
    });
    // PRÉSENCE d'abord : sans elle, l'égalité passerait sur deux listes vides.
    expect(miennes(servi)).toHaveLength(2);
    const ligneGagnante = servi.find((r) => r.creatorId === gagnante.creatorId);
    expect(ligneGagnante?.totalDue ?? 0).toBeGreaterThan(0);
    expect(servi.filter((r) => r.isMe).map((r) => r.creatorId)).toEqual([
      gagnante.creatorId,
    ]);
    expect(sansRang(miennes(servi))).toEqual(
      sansRang(
        miennes(direct).map((r) => ({
          ...r,
          isMe: r.creatorId === gagnante.creatorId,
        })),
      ),
    );
    expect(servi.map((r) => r.rank)).toEqual(servi.map((_, i) => i + 1));

    // Et du point de vue de l'autre : même classement, SA ligne marquée.
    const vuParMuette = await muette.client.query(
      api.payments.projectLeaderboard,
      { projectId },
    );
    expect(vuParMuette.filter((r) => r.isMe).map((r) => r.creatorId)).toEqual([
      muette.creatorId,
    ]);

    // 4. LE CACHE EST LU : de nouvelles vues changent le calcul direct, pas ce
    //    que le portail sert — jusqu'au recalcul suivant.
    // Vues choisies SOUS le plafond de 150 $ par vidéo : au-delà, les deux
    // montants seraient plafonnés et égaux, et la phase ne prouverait rien.
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId,
      capturedAt: Date.now() + 1_000,
      vues: 33_907,
      likes: 5_380,
    });
    const directApres = (await admin.query(api.payments.leaderboard, {})).find(
      (r) => r.creatorId === gagnante.creatorId,
    );
    expect(directApres!.totalDue).toBeGreaterThan(ligneGagnante!.totalDue);
    const perime = (
      await gagnante.client.query(api.payments.projectLeaderboard, { projectId })
    ).find((r) => r.creatorId === gagnante.creatorId);
    expect(perime!.totalDue).toBe(ligneGagnante!.totalDue);

    const troisieme = await admin.mutation(
      api.leaderboardCache.e2eRefreshLeaderboardCache,
      { secret: E2E_SECRET, projectId },
    );
    expect(troisieme.changed).toBe(true);
    const frais = (
      await gagnante.client.query(api.payments.projectLeaderboard, { projectId })
    ).find((r) => r.creatorId === gagnante.creatorId);
    expect(frais!.totalDue).toBe(directApres!.totalDue);
  });
});
