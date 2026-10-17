import { test, expect } from "./fixtures/auth-fixture";
import { adminPath, createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;

/**
 * BONUS PAR VIDÉO FRANCHI APRÈS LE PAIEMENT DE SON CYCLE — reporté, jamais perdu.
 *
 * Calqué sur la plainte de Juliette (17/10/2026) : un reel publié 1 h 20 avant
 * la fin de son cycle, cycle marqué payé le lendemain avec 5 750 vues (IG 3 009 +
 * TikTok 2 741, sous le seuil de 10 000), puis 56 124 vues (IG 51 560 + TikTok
 * 4 564). Grille du barème « Juliette Nouveau Contrat » : 10 k → 10, 50 k → 40,
 * 100 k → 80, NON cumulative. Le reel doit 40 € — au cycle SUIVANT, puisque le
 * sien est payé et que le grand livre ne se réécrit pas.
 *
 * Les dates sont posées en temps réel autour de `Date.now()` : `markCyclePaid`
 * date le paiement de l'instant, et c'est cet instant, comparé à la fenêtre de
 * paie J+30 de la vidéo, qui décide si son bonus était encore ouvert.
 */

async function setup(ts: number, tag: string) {
  const creator = await createCreatorSession(url!, {
    name: `[E2E_TEST] Report ${tag} ${ts}`,
    email: `e2e-report-${tag}-${ts}@repackit.test`,
    password: "creator-report-12345",
  });
  // Fixe 350 / 30 vidéos (11,67 par vidéo, comme la ligne gelée de Juliette),
  // pas de CPM : seul le bonus par vidéo bouge avec les vues.
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Report ${tag} ${ts}`,
    montantFixe: 350,
    nbVideosCible: 30,
    tauxCPM: 0,
    videoBonus: {
      cumulative: false,
      tiers: [
        { seuilVues: 10_000, montant: 10 },
        { seuilVues: 50_000, montant: 40 },
        { seuilVues: 100_000, montant: 80 },
      ],
    },
  });
  const formatId = await createFormatWithRate(admin, {
    name: `[E2E_TEST] Format report ${tag} ${ts}`,
    type: "short",
    rateModel: { basePerPost: 0 },
  });

  /** Une vidéo publiée à `publishedAt` sur `platforms` ; rend ses publications. */
  async function publier(
    suffix: string,
    publishedAt: number,
    platforms: ("TikTok" | "Instagram")[],
  ): Promise<{ assignmentId: Id<"assignments">; pubs: Id<"publications">[] }> {
    const targets = [];
    for (const platform of platforms) {
      targets.push(
        await availableTarget({
          e2eClient: admin,
          creatorId: creator.creatorId,
          platform,
          handle: `@e2erep${tag}${suffix}${platform === "TikTok" ? "tt" : "ig"}${ts}`,
        }),
      );
    }
    const avant = new Set(
      (await admin.query(api.assignments.listAssignments, {}))
        .filter((a) => a.formatId === formatId)
        .map((a) => a._id),
    );
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creator.creatorId,
      targets,
      postsPerCreator: 1,
      dueDate: ts + 5 * DAY,
      pricingId,
    });
    const assignmentId = (await admin.query(api.assignments.listAssignments, {}))
      .filter((a) => a.formatId === formatId && !avant.has(a._id))
      .map((a) => a._id)[0] as Id<"assignments">;
    expect(assignmentId).toBeTruthy();
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignmentId,
      status: "to_publish",
    });
    const { publicationIds } = await admin.mutation(
      api.assignments.confirmPublicationAsAdmin,
      {
        id: assignmentId,
        urls: platforms.map((platform, i) =>
          platform === "TikTok"
            ? {
                platform,
                url: `https://www.tiktok.com/@e2erep${tag}${suffix}tt${ts}/video/75${i}${ts % 100000}`,
              }
            : {
                platform,
                url: `https://www.instagram.com/reel/Rep${tag}${suffix}${ts % 100000}/`,
              },
        ),
        publishedAt,
        allowBackdate: true,
      },
    );
    expect(publicationIds).toHaveLength(platforms.length);
    return { assignmentId, pubs: publicationIds };
  }

  /** Un relevé par post (vues dans l'ordre des plateformes). */
  async function relever(pubs: Id<"publications">[], vues: number[], capturedAt: number) {
    for (let i = 0; i < pubs.length; i++) {
      await admin.mutation(api.metricSnapshots.createSnapshot, {
        publicationId: pubs[i],
        capturedAt,
        vues: vues[i],
        likes: Math.round(vues[i] / 37),
      });
    }
  }

  const cycles = () =>
    creator.client.query(api.payments.getMyPayments, { projectId: creator.projectId });
  const cycle = async (k: number) => {
    const c = (await cycles()).find((x) => x.cycleIndex === k);
    expect(c, `cycle ${k} listé`).toBeTruthy();
    return c!;
  };
  const payer = (k: number) =>
    admin.mutation(api.payments.markCyclePaid, {
      creatorId: creator.creatorId,
      cycleIndex: k,
    });
  return { creator, pricingId, formatId, publier, relever, cycle, payer };
}

test.describe("Bonus par vidéo reporté au cycle suivant", () => {
  test("cas Juliette : reel publié 1 h 20 avant la fin, cycle payé à J+1 sous le seuil, 40 € au cycle suivant", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const s = await setup(ts, "jul");

    // Ancre du cycle 0 : un premier post il y a 31 j 2 h. Cycle 0 = [ancre,
    // ancre + 30 j) se termine donc il y a 26 h — le paiement ci-dessous tombe
    // à J+1, comme celui du 08/10.
    const ancreAt = ts - 31 * DAY - 2 * HOUR;
    const finCycle0 = ancreAt + 30 * DAY;
    const ancre = await s.publier("ancre", ancreAt, ["TikTok"]);
    await s.relever(ancre.pubs, [2_345], ancreAt + 2 * DAY);

    // Le reel, 1 h 20 avant la fin du cycle 0, avec son jumeau TikTok.
    const reel = await s.publier("reel", finCycle0 - 80 * MIN, ["Instagram", "TikTok"]);
    await s.relever(reel.pubs, [3_009, 2_741], ts - 2 * HOUR);
    // Témoin SANS ÉCART : 12 345 au paiement (10 € gelés), 34 567 ensuite — même
    // palier, rien à reporter.
    const stable = await s.publier("stable", finCycle0 - 3 * HOUR, ["TikTok"]);
    await s.relever(stable.pubs, [12_345], ts - 2 * HOUR);
    // Témoin de SOUSTRACTION : 10 € gelés au paiement, 61 234 ensuite ⇒ 40 dus,
    // 30 de complément (jamais 40 : les 10 sont déjà versés).
    const grimpe = await s.publier("grimpe", finCycle0 - 5 * HOUR, ["TikTok"]);
    await s.relever(grimpe.pubs, [11_872], ts - 2 * HOUR);

    // ── AVANT le paiement : le cycle 0 porte les trois vidéos jeunes ────────
    const avant = await s.cycle(0);
    expect(avant.status).toBe("accruing");
    expect(
      avant.pricingBreakdown.videoBonuses
        .map((b) => [b.assignmentId, b.montant])
        .sort(),
    ).toEqual(
      [
        [stable.assignmentId, 10],
        [grimpe.assignmentId, 10],
      ].sort(),
    );
    // L'AVERTISSEMENT de « Marquer payé » : les trois vidéos publiées dans les
    // dernières heures ont encore leur fenêtre ouverte et un palier devant elles ;
    // l'ancre (fenêtre close depuis 2 h) n'en fait pas partie.
    // (asserté en fin de test : ce n'est pas la propriété principale, et un
    // rouge ici masquerait celui du report.)
    const encoreOuvertesAvant = avant.pricingBreakdown.videoBonusStillOpen;
    // … et l'ÉCRAN : la phrase est sous la ligne du cycle, à côté de « Marquer
    // payé », sans avoir à ouvrir le détail.
    await page.goto(adminPath("/paiements"));
    await expect(page.getByTestId(`video-bonus-open-${avant.key}`)).toHaveText(
      "3 vidéos de ce cycle ont moins de 30 jours ; leur bonus se règlera au cycle suivant.",
    );
    await expect(page.getByTestId(`mark-paid-${avant.key}`)).toBeEnabled();

    await s.payer(0);
    const paye0 = await s.cycle(0);
    expect(paye0.status).toBe("paid");
    // Gelé tel quel : 4 vidéos au fixe, les deux bonus à 10, rien pour le reel.
    const bonusGeles0 = paye0.lineItems.filter((li) => li.kind === "video_bonus");
    expect(bonusGeles0.map((li) => li.assignmentId).sort()).toEqual(
      [stable.assignmentId, grimpe.assignmentId].sort(),
    );
    expect(paye0.lineItems.some((li) => li.assignmentId === reel.assignmentId && li.kind === "video_bonus")).toBe(false);
    const total0 = paye0.totalDue;

    // ── Les vues montent APRÈS le paiement ─────────────────────────────────
    const plusTard = Date.now();
    await s.relever(reel.pubs, [51_560, 4_564], plusTard);
    await s.relever(stable.pubs, [34_567], plusTard);
    await s.relever(grimpe.pubs, [61_234], plusTard);

    const ouvert = await s.cycle(1);
    expect(ouvert.status).toBe("accruing");
    // PRÉSENCE : le reel (40) et le complément de « grimpe » (40 − 10 = 30).
    // ABSENCE appariée : « stable », resté dans son palier, n'a pas de ligne.
    expect(
      ouvert.pricingBreakdown.videoBonuses
        .map((b) => ({ id: b.assignmentId, views: b.views, montant: b.montant, carriedOver: b.carriedOver }))
        .sort((a, b) => a.montant - b.montant),
    ).toEqual([
      { id: grimpe.assignmentId, views: 61_234, montant: 30, carriedOver: true },
      { id: reel.assignmentId, views: 56_124, montant: 40, carriedOver: true },
    ]);
    expect(ouvert.pricingBreakdown.videoBonusTotal).toBe(70);
    expect(ouvert.totalDue).toBe(70);
    // QUELLE vidéo : la créatrice retrouve le reel (nom de mission + ses liens).
    const refReel = ouvert.bonusVideos.find((v) => v.assignmentId === reel.assignmentId);
    expect(refReel?.title).toBe(`[E2E_TEST] Format report jul ${ts}`);
    expect(refReel?.posts.map((p) => p.platform).sort()).toEqual(["Instagram", "TikTok"]);
    // Le cycle payé, lui, n'a pas bougé d'un centime.
    expect((await s.cycle(0)).totalDue).toBe(total0);
    // L'ÉCRAN de la créatrice (vue admin de son espace) : la ligne dit
    // « reporté », nomme la vidéo, et dit pourquoi elle est là.
    await page.goto(`/admin/voir/e2e-test/${s.creator.creatorId}/paiements`);
    await expect(page.getByText(/Bonus vidéo reporté — 56\s?124 vues/)).toBeVisible();
    await expect(
      page.getByText("Vidéo d'un cycle déjà payé : ce palier a été atteint après le paiement, il est réglé sur ce cycle.").first(),
    ).toBeVisible();

    // ── Le complément se GÈLE au paiement du cycle qui le porte ─────────────
    await s.payer(1);
    const paye1 = await s.cycle(1);
    expect(paye1.status).toBe("paid");
    const reportes = paye1.lineItems
      .filter((li) => li.kind === "video_bonus")
      .map((li) => ({ id: li.assignmentId, amount: li.amount, carriedOver: li.detail?.carriedOver }))
      .sort((a, b) => a.amount - b.amount);
    expect(reportes).toEqual([
      { id: grimpe.assignmentId, amount: 30, carriedOver: true },
      { id: reel.assignmentId, amount: 40, carriedOver: true },
    ]);
    expect(paye1.totalDue).toBe(70);
    expect((await s.cycle(0)).totalDue).toBe(total0);
    expect(encoreOuvertesAvant).toBe(3);

    await admin.mutation(api.assignments.cleanupTestAssignments, { secret: E2E_SECRET });
  });

  test("cycle suivant payé lui aussi trop tôt : ce qui reste repasse dans le cycle d'après", async () => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const s = await setup(ts, "deux");

    // Cycle 0 = [ancre, ancre + 30 j) fini il y a 30 j 12 h ; cycle 1 fini il y a
    // 12 h ; on est dans le cycle 2. Un reel publié 1 h avant la fin du cycle 0
    // a encore 11 h de fenêtre J+30 devant lui.
    const ancreAt = ts - 60 * DAY - 12 * HOUR;
    const finCycle0 = ancreAt + 30 * DAY;
    // L'ancre a franchi 10 k dans sa fenêtre, close depuis un mois : payée 10 au
    // cycle 0, elle est RÉGLÉE pour de bon — le témoin de la borne, plus bas.
    const ancre = await s.publier("ancre", ancreAt, ["TikTok"]);
    await s.relever(ancre.pubs, [12_418], ancreAt + 2 * DAY);
    const reel = await s.publier("reel", finCycle0 - HOUR, ["Instagram", "TikTok"]);
    await s.relever(reel.pubs, [3_009, 2_741], ts - 3 * HOUR);

    await s.payer(0);
    expect(
      (await s.cycle(0)).lineItems
        .filter((li) => li.kind === "video_bonus")
        .map((li) => [li.assignmentId, li.amount]),
    ).toEqual([[ancre.assignmentId, 10]]);

    // 12 113 vues : le premier palier (10) est franchi, reporté sur le cycle 1…
    await s.relever(reel.pubs, [9_214, 2_899], ts - 2 * HOUR);
    const c1 = await s.cycle(1);
    expect(c1.pricingBreakdown.videoBonuses.map((b) => [b.assignmentId, b.montant])).toEqual([
      [reel.assignmentId, 10],
    ]);
    // … qui est payé à son tour, avant que la fenêtre de la vidéo ne se ferme.
    await s.payer(1);
    const paye1 = await s.cycle(1);
    expect(
      paye1.lineItems
        .filter((li) => li.kind === "video_bonus")
        .map((li) => [li.assignmentId, li.amount, li.detail?.carriedOver]),
    ).toEqual([[reel.assignmentId, 10, true]]);

    // 56 124 vues : 40 dus, 10 déjà versés ⇒ 30 dans le cycle 2.
    await s.relever(reel.pubs, [51_560, 4_564], ts - HOUR);
    const c2 = await s.cycle(2);
    expect(c2.status).toBe("accruing");
    expect(
      c2.pricingBreakdown.videoBonuses.map((b) => [b.assignmentId, b.views, b.montant]),
    ).toEqual([[reel.assignmentId, 56_124, 30]]);
    expect(c2.totalDue).toBe(30);
    // Ni le cycle 0 ni le cycle 1 n'ont bougé.
    expect((await s.cycle(1)).totalDue).toBe(10);

    // ── LA BORNE : une grille relevée APRÈS coup ne rouvre pas une vidéo réglée.
    // Le palier 10 k passe à 15. L'ancre (payée 10, fenêtre close avant son
    // paiement) ne doit RIEN recevoir ; le reel, toujours dans sa fenêtre, reste
    // au palier 50 k : 30 inchangés.
    await admin.mutation(api.pricing.updatePricing, {
      id: s.pricingId,
      name: `[E2E_TEST] Report deux ${ts}`,
      montantFixe: 350,
      nbVideosCible: 30,
      tauxCPM: 0,
      videoBonus: {
        cumulative: false,
        tiers: [
          { seuilVues: 10_000, montant: 15 },
          { seuilVues: 50_000, montant: 40 },
          { seuilVues: 100_000, montant: 80 },
        ],
      },
    });
    const apresGrille = await s.cycle(2);
    expect(
      apresGrille.pricingBreakdown.videoBonuses.map((b) => [b.assignmentId, b.montant]),
    ).toEqual([[reel.assignmentId, 30]]);

    await admin.mutation(api.assignments.cleanupTestAssignments, { secret: E2E_SECRET });
  });
});
