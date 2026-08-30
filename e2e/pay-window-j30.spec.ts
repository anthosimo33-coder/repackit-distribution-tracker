import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * PLAFOND J+30 — preuve BOUT EN BOUT sur le moteur de paie réel.
 *
 * Le cas est calqué sur la prod : une vidéo dont les vues continuent de monter
 * après 30 jours (42 000 à J+30, 51 500 aujourd'hui — magnitudes réelles du
 * parc Snytch, pas des nombres ronds). Le CPM doit se calculer sur 42 000.
 *
 * ⚠️ LE BARÈME EST CHOISI POUR QUE LE PLAFOND 150 $/VIDÉO N'ABSORBE RIEN.
 * 42 000 vues × 2 $/1000 = 84 $ < 150 : sans cette précaution, le test passerait
 * au vert en mesurant l'AUTRE plafond (celui de #99), et ne prouverait rien du
 * tout. C'est exactement ce que la mesure sur données de prod a montré — 3 des
 * 12 vidéos du cycle payé de Kelly sont déjà à 150 $, le plafond J+30 n'y change
 * rien.
 *
 * ⚠️ DEUX VIDÉOS, DEUX CONDITIONS OPPOSÉES. Une seule vidéo plafonnée
 * prouverait « le montant est plus petit », ce qu'un bug de calcul produirait
 * aussi. La vidéo témoin, publiée aujourd'hui avec les MÊMES vues, doit être
 * payée sur son compteur COURANT — c'est le contrôle qui distingue « plafond
 * appliqué à la bonne vidéo » de « paie cassée pour tout le monde ».
 */
test.describe("Plafond J+30 — les vues au-delà de 30 j ne sont plus rémunérées", () => {
  test("vidéo mûre plafonnée au relevé de J+30, vidéo récente payée au compteur courant", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] PayWindow ${ts}`,
      email: `e2e-creator-paywindow-${ts}@repackit.test`,
      password: "creator-paywindow-12345",
    });
    const projectId = creator.projectId;

    // Barème : fixe 100 $/60 vidéos (1,67 $/vidéo) + CPM 2 $/1000.
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PayWindow ${ts}`,
      montantFixe: 100,
      nbVideosCible: 60,
      tauxCPM: 2,
    });
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Format PayWindow ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });

    /** Attribue une vidéo, la publie à `publishedAt`, renvoie sa publication. */
    async function publishVideo(
      suffix: string,
      publishedAt: number,
    ): Promise<{ assignmentId: Id<"assignments">; pubId: Id<"publications"> }> {
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: creator.creatorId,
        platform: "TikTok",
        handle: `@e2epaywindow${suffix}${ts}`,
      });
      await admin.mutation(api.assignments.assignFormat, {
        formatId,
        creatorId: creator.creatorId,
        targets: [target],
        postsPerCreator: 1,
        dueDate: ts + 5 * DAY,
        pricingId,
      });
      const mine = (
        await admin.query(api.assignments.listAssignments, {})
      ).filter(
        (a) =>
          a.formatId === formatId &&
          a.creatorId === creator.creatorId &&
          a.status !== "published" &&
          a.status !== "paid",
      );
      const assignmentId = mine[mine.length - 1]._id;
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: assignmentId,
        status: "to_publish",
      });
      // Publication par l'ADMIN avec la date RÉELLE : c'est le seul chemin qui
      // permet d'antidater (régularisation d'un post fait hors de l'app), donc
      // d'obtenir une vidéo dont la fenêtre est réellement close.
      const { publicationIds } = await admin.mutation(
        api.assignments.confirmPublicationAsAdmin,
        {
          id: assignmentId,
          urls: [
            {
              platform: "TikTok",
              url: `https://www.tiktok.com/@e2epaywindow${suffix}${ts}/video/74${suffix}${ts % 100000}`,
            },
          ],
          publishedAt,
          allowBackdate: true,
        },
      );
      expect(publicationIds.length).toBeGreaterThan(0);
      return { assignmentId, pubId: publicationIds[0] };
    }

    // ── Vidéo MÛRE : publiée il y a 60 jours ────────────────────────────────
    const murePubliAt = ts - 60 * DAY;
    const mure = await publishVideo("mure", murePubliAt);
    // Série de relevés : J+20, J+30 (le dernier de la fenêtre), J+45 (hors
    // fenêtre). La forme est celle de la prod : un relevé par jour, croissant.
    for (const [day, vues] of [
      [20, 27_250],
      [30, 42_000],
      [45, 51_500],
    ] as const) {
      await admin.mutation(api.metricSnapshots.createSnapshot, {
        publicationId: mure.pubId,
        capturedAt: murePubliAt + day * DAY,
        vues,
        likes: Math.round(vues / 20),
      });
    }

    // ── Vidéo TÉMOIN : publiée aujourd'hui, MÊMES vues ──────────────────────
    const temoin = await publishVideo("temoin", ts - 2 * DAY);
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: temoin.pubId,
      capturedAt: ts - DAY,
      vues: 51_500,
      likes: 2_575,
    });

    // ── Ce que la créatrice voit dans « Mes paiements » ─────────────────────
    // Chaque vidéo est retrouvée par SON assignation dans le breakdown, jamais
    // par un index de cycle calculé à la main : l'ancre est le 1er post de la
    // créatrice, et un test qui devine « cycle 2 » vert-il par hasard ou parce
    // que le montant est juste, on ne le saurait pas.
    const payments = await creator.client.query(api.payments.getMyPayments, {
      projectId,
    });
    const cycleOf = (assignmentId: Id<"assignments">) =>
      payments.find((p) =>
        p.pricingBreakdown.perAssignment.some(
          (a) => a.assignmentId === assignmentId,
        ),
      );
    const cycleMure = cycleOf(mure.assignmentId);
    const cycleTemoin = cycleOf(temoin.assignmentId);
    expect(cycleMure, "cycle de la vidéo mûre").toBeTruthy();
    expect(cycleTemoin, "cycle de la vidéo témoin").toBeTruthy();
    // Deux CYCLES DIFFÉRENTS : sinon les deux montants se mélangeraient dans un
    // même total et les assertions ci-dessous ne diraient plus rien.
    expect(cycleMure!.cycleIndex).not.toBe(cycleTemoin!.cycleIndex);

    // PLAFOND APPLIQUÉ : CPM sur les 42 000 vues de J+30, pas sur 51 500.
    expect(cycleMure!.pricingBreakdown.cpmTotal).toBe(84);
    expect(cycleMure!.pricingBreakdown.cpmTotal).not.toBe(103);
    // Le FIXE reste dû en entier : une vidéo plafonnée n'est pas une vidéo à
    // zéro. C'est la garde contre le « zéro fabriqué » côté montant.
    expect(cycleMure!.pricingBreakdown.fixedTotal).toBe(1.67);
    expect(cycleMure!.pricingBreakdown.total).toBe(85.67);

    // CONTRÔLE OPPOSÉ : la vidéo récente est payée sur son compteur COURANT.
    expect(cycleTemoin!.pricingBreakdown.cpmTotal).toBe(103);
    expect(cycleTemoin!.pricingBreakdown.total).toBe(104.67);

    // ── La ligne de paie DIT les vues retenues, pas les vues mesurées ───────
    const ligneCpm = cycleMure!.lineItems.find((li) => li.kind === "cpm");
    if (ligneCpm) expect(ligneCpm.detail?.views).toBe(42_000);

    // ── Le SUIVI, lui, n'est pas touché : les vues mesurées restent 51 500 ──
    // C'est la moitié de la règle qu'on oublierait le plus facilement : on
    // plafonne la rémunération, PAS la mesure.
    const pubs = await admin.query(api.publications.listPublications, {});
    const pub = pubs.find((p) => p._id === mure.pubId);
    expect(pub, "la publication mûre reste listée").toBeTruthy();
    expect(pub!.vuesLatest).toBe(51_500);
  });
});
