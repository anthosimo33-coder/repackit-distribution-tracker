import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";
import { parisDayOf } from "../convex/managerCpm";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * POST POUSSÉ EN SPARK AD — preuve BOUT EN BOUT sur le moteur de paie réel.
 *
 * Une spark ad diffuse le post organique : les vues achetées montent sur SON
 * compteur. À partir du jour de lancement, l'assiette de paie est figée au
 * dernier relevé d'avant.
 *
 * ⚠️ BARÈME SOUS LE PLAFOND 150 $/VIDÉO (63 800 × 2 $/1000 = 127,60 $), sinon
 * le test mesurerait l'autre plafond.
 *
 * ⚠️ DEUX VIDÉOS, MÊMES RELEVÉS, CONDITIONS OPPOSÉES. La vidéo témoin, sans
 * pub, doit être payée sur son compteur courant — c'est ce qui distingue « gel
 * appliqué à la bonne vidéo » de « paie cassée pour tout le monde ».
 */
test.describe("Spark ad — les vues après le lancement de la pub ne sont pas rémunérées", () => {
  test("vidéo en pub figée au relevé d'avant, témoin payée au compteur, retrait = retour", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] SparkAd ${ts}`,
      email: `e2e-creator-sparkad-${ts}@repackit.test`,
      password: "creator-sparkad-12345",
    });
    const projectId = creator.projectId;

    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] SparkAd ${ts}`,
      montantFixe: 100,
      nbVideosCible: 60,
      tauxCPM: 2,
    });
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Format SparkAd ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });

    const publiAt = ts - 8 * DAY;

    async function publishVideo(
      suffix: string,
    ): Promise<{ assignmentId: Id<"assignments">; pubId: Id<"publications"> }> {
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: creator.creatorId,
        platform: "TikTok",
        handle: `@e2esparkad${suffix}${ts}`,
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
      const { publicationIds } = await admin.mutation(
        api.assignments.confirmPublicationAsAdmin,
        {
          id: assignmentId,
          urls: [
            {
              platform: "TikTok",
              url: `https://www.tiktok.com/@e2esparkad${suffix}${ts}/video/75${suffix.length}${ts % 100000}`,
            },
          ],
          publishedAt: publiAt,
          allowBackdate: true,
        },
      );
      expect(publicationIds.length).toBeGreaterThan(0);
      const pubId = publicationIds[0];
      // Relevés à la forme de la prod : J+3 (avant la pub), J+6 (après).
      for (const [day, vues] of [
        [3, 21_450],
        [6, 63_800],
      ] as const) {
        await admin.mutation(api.metricSnapshots.createSnapshot, {
          publicationId: pubId,
          capturedAt: publiAt + day * DAY,
          vues,
          likes: Math.round(vues / 20),
        });
      }
      return { assignmentId, pubId };
    }

    const enPub = await publishVideo("pub");
    const temoin = await publishVideo("temoin");

    // Refus : une pub ne peut pas précéder la publication du post.
    await expect(
      admin.mutation(api.publications.setPublicationSparkAd, {
        publicationId: enPub.pubId,
        day: parisDayOf(publiAt - 2 * DAY),
      }),
    ).rejects.toThrow(/ERR_SPARK_AD_DATE_INVALID/);

    // Lancement le jour J+5 (heure de Paris), entre les deux relevés.
    await admin.mutation(api.publications.setPublicationSparkAd, {
      publicationId: enPub.pubId,
      day: parisDayOf(publiAt + 5 * DAY),
    });

    const cpmOf = async (assignmentId: Id<"assignments">) => {
      const payments = await creator.client.query(api.payments.getMyPayments, {
        projectId,
      });
      for (const p of payments) {
        const row = p.pricingBreakdown.perAssignment.find(
          (a) => a.assignmentId === assignmentId,
        );
        if (row) return row;
      }
      throw new Error(`assignation ${assignmentId} absente des paiements`);
    };

    // GEL APPLIQUÉ : CPM sur 21 450 vues, pas 63 800.
    const gele = await cpmOf(enPub.assignmentId);
    expect(gele.totalViews).toBe(21_450);
    expect(gele.cpm).toBe(42.9);
    // CONTRÔLE OPPOSÉ : mêmes relevés, pas de pub → compteur courant.
    const libre = await cpmOf(temoin.assignmentId);
    expect(libre.totalViews).toBe(63_800);
    expect(libre.cpm).toBe(127.6);

    // Le panneau admin dit les MÊMES chiffres que le moteur.
    const flags = await admin.query(api.publications.getPublicationPayFlags, {
      publicationId: enPub.pubId,
    });
    expect(flags?.sparkAd).toMatchObject({
      day: parisDayOf(publiAt + 5 * DAY),
      effect: "frozen",
      frozenViews: 21_450,
      measuredViews: 63_800,
      viewsAfterLaunch: 42_350,
    });
    const flagsTemoin = await admin.query(api.publications.getPublicationPayFlags, {
      publicationId: temoin.pubId,
    });
    expect(flagsTemoin?.sparkAd).toBeNull();

    // Le SUIVI n'est pas touché : les vues mesurées restent 63 800.
    const pubs = await admin.query(api.publications.listPublications, {});
    expect(pubs.find((p) => p._id === enPub.pubId)?.vuesLatest).toBe(63_800);

    // RETRAIT : la paie suit de nouveau les vues.
    await admin.mutation(api.publications.setPublicationSparkAd, {
      publicationId: enPub.pubId,
      day: null,
    });
    const rendu = await cpmOf(enPub.assignmentId);
    expect(rendu.totalViews).toBe(63_800);
    expect(rendu.cpm).toBe(127.6);
  });
});
