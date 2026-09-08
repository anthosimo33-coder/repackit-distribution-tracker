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

/**
 * CLASSEMENT DU CYCLE — partenaires uniquement.
 *
 * Un talent en est exclu DE FAIT : il ne publie jamais, donc pas de
 * `firstPostAt`, donc pas de cycle. Un CLIPPEUR, lui, publie — et il
 * apparaissait au milieu des partenaires.
 *
 * Or un classement compare des performances. Le clippeur monte les rushes d'un
 * talent : il n'a pas produit ce qu'il publie, et il est payé un montant fixe
 * par clip, pas au CPM sur ses vues. Le comparer à une partenaire ne mesure rien.
 *
 * Un classement SÉPARÉ par population aurait peut-être du sens un jour. Il n'est
 * pas construit — cette note coûte moins que de laisser croire que celui-ci le
 * remplace.
 */
test.describe("Classement du cycle — partenaires uniquement", () => {
  test("un clippeur qui a publié n'entre PAS dans le classement", async () => {
    const ts = Date.now();
    const populations = [
      { kind: "clipper" as const, attendu: false },
      { kind: "talent" as const, attendu: false },
      { kind: "partner" as const, attendu: true },
    ];
    const ids: Record<string, string> = {};
    for (const { kind } of populations) {
      const { creatorId } = await admin.mutation(api.creators.inviteCreator, {
        name: `[E2E_TEST] ${kind} classement ${ts}`,
        email: `e2e-creator-${kind}-classement-${ts}@repackit.test`,
        kind,
      });
      ids[kind] = creatorId;
      // Les TROIS ont une ancre de publication : sans ça, le talent et le
      // clippeur seraient écartés par le filtre `firstPostAt` et le test ne
      // prouverait rien de la garde de population.
      await admin.mutation(api.creators.e2eSetPayAnchor, {
        secret: E2E_SECRET,
        creatorId,
        firstPostAt: ts - 3 * 86_400_000,
      });
    }

    const classement = await admin.query(api.payments.leaderboard, {});
    const presents = classement.map((l) => l.creatorId as string);
    for (const { kind, attendu } of populations) {
      expect(presents.includes(ids[kind])).toBe(attendu);
    }
  });
});

/**
 * LE CLASSEMENT NE CALCULE QU'UN CYCLE — il doit rendre LE MÊME.
 *
 * `computeProjectLeaderboard` ne demande plus à `cyclePaymentsForCreator` que le
 * cycle EN COURS (`onlyCycle`), au lieu de dérouler tous les cycles depuis le
 * premier pour n'en garder qu'un. Sur une créatrice active depuis cinq cycles,
 * c'était cinq breakdowns complets pour une ligne de classement.
 *
 * Cette spec est le garde-fou de cette optimisation, et c'est de l'ARGENT : le
 * montant du classement doit être, au centime, celui que l'écran Paiements
 * affiche pour le même cycle. Les deux passent par le même moteur, mais par deux
 * chemins différents — et c'est exactement ce genre d'écart qui ne se voit pas
 * avant qu'une créatrice le signale.
 */
test.describe("Classement — le cycle calculé seul vaut le cycle calculé en lot", () => {
  test("classement et écran Paiements donnent le MÊME montant", async () => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const DAY = 86_400_000;
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Pricing classement ${ts}`,
      montantFixe: 300,
      nbVideosCible: 10,
      tauxCPM: 3,
    });

    // DEUX partenaires, ANCRÉES LOIN dans le passé et QUI GAGNENT VRAIMENT.
    //  - Sans plusieurs cycles, « n'en calculer qu'un » et « les calculer tous »
    //    font le même travail : la spec ne prouverait rien de l'optimisation.
    //  - Sans argent, elle comparerait 0 à 0 : elle ne prouverait rien tout court.
    for (const n of [0, 1]) {
      const creator = await createCreatorSession(convexUrl, {
        name: `[E2E_TEST] cycle-unique ${n} ${ts}`,
        email: `e2e-cycle-unique-${n}-${ts}@repackit.test`,
        password: "classement-12345678",
      });
      const formatId = await createFormatWithRate(admin, {
        name: `[E2E_TEST] Fmt classement ${n} ${ts}`,
        type: "short",
        rateModel: { basePerPost: 5 },
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: creator.creatorId,
        platform: "TikTok",
        handle: `@e2eclassement${n}${ts}`,
      });
      await admin.mutation(api.assignments.assignFormat, {
        formatId,
        creatorId: creator.creatorId,
        targets: [target],
        postsPerCreator: 3,
        dueDate: ts + 5 * DAY,
        pricingId,
      });
      const mine = (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) => a.formatId === formatId && a.creatorId === creator.creatorId,
      );
      const projectId = await admin.getProjectId();
      for (let i = 0; i < mine.length; i++) {
        await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
          secret: E2E_SECRET,
          id: mine[i]._id,
          status: "to_publish",
        });
        const { publicationIds } = await creator.client.mutation(
          api.assignments.confirmPublication,
          {
            projectId,
            id: mine[i]._id,
            urls: [
              {
                platform: "TikTok",
                url: `https://www.tiktok.com/@e2eclassement${n}${ts}/video/7300000000${n}${i}${ts % 1000}`,
              },
            ],
          },
        );
        // Des VUES, donc du CPM : le montant comparé n'est pas un forfait rond.
        if (publicationIds[0]) {
          await admin.mutation(api.metricSnapshots.createSnapshot, {
            publicationId: publicationIds[0],
            capturedAt: Date.now(),
            vues: 137_000 + i * 4_100,
            likes: 3_000,
          });
        }
      }
      // Ancre reculée APRÈS les publications : 4 et 5 cycles J+30 derrière soi,
      // les vidéos tombant dans le cycle EN COURS.
      await admin.mutation(api.creators.e2eSetPayAnchor, {
        secret: E2E_SECRET,
        creatorId: creator.creatorId,
        firstPostAt: ts - (120 + n * 30) * DAY,
      });
    }

    const classement = await admin.query(api.payments.leaderboard, {});
    const paiements = await admin.query(api.payments.listPayments, {});
    const miennes = classement.filter((l) =>
      l.name.includes(`cycle-unique`) && l.name.includes(String(ts)),
    );
    expect(miennes.length).toBe(2);
    // Le test ne vaut que si de l'ARGENT circule : sinon il compare 0 à 0.
    expect(miennes.every((l) => l.totalDue > 0)).toBe(true);

    for (const ligne of miennes) {
      // Le cycle que l'écran Paiements montre pour cette créatrice sur la MÊME
      // fenêtre — apparié par les bornes, pas par un index recalculé ici.
      const cycle = paiements.find(
        (p) =>
          p.creatorId === ligne.creatorId &&
          p.cycleStart === ligne.cycleStart &&
          p.cycleEnd === ligne.cycleEnd,
      );
      expect(
        cycle,
        `aucun cycle Paiements pour ${ligne.name} sur cette fenêtre`,
      ).toBeTruthy();
      expect(ligne.totalDue).toBe(cycle!.totalDue);
    }
  });
});
