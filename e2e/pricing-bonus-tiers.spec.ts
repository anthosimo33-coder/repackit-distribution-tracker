import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * Pricing v2 — paliers de bonus sur le CUMUL des vues (cash/nature), serveur.
 * Paliers [2M → iPhone (nature), 5M → 500€ (cash)]. Cumul 2,3M → iPhone seul
 * (hors total €). Cumul 5,1M → +500€ au total €, iPhone toujours là. Re-sync →
 * pas de double unlock. Isolation : un autre créateur ne voit rien.
 */
test.describe("Pricing v2 — paliers de bonus (cumul, cash/nature)", () => {
  test("cumul → paliers cash/nature + idempotence + isolation", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Tiers ${ts}`,
      email: `e2e-creator-tiers-${ts}@repackit.test`,
      password: "creator-tiers-12345",
    });
    const projectId = creator.projectId;

    // 1. Pricing (fixe/CPM 0 pour isoler le bonus) + paliers ; sert AUSSI de
    //    grille de bonus du créateur (bonusPricingId).
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Tiers ${ts}`,
      montantFixe: 0,
      nbVideosCible: 1,
      tauxCPM: 0,
      bonusTiers: [
        { seuilVues: 2_000_000, rewardType: "nature", libelle: "iPhone" },
        { seuilVues: 5_000_000, rewardType: "cash", montant: 500 },
      ],
    });
    await admin.mutation(api.creators.updateCreator, {
      id: creator.creatorId,
      bonusPricingId: pricingId,
    });

    // 2. 1 vidéo attribuée (pricingSnapshot) + publiée → entre dans le cumul.
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Format Tiers ${ts}`,
      type: "short",
      rateModel: { basePerPost: 0 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2etiers${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creator.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 5 * DAY,
      pricingId,
    });
    const assignmentId = (
      await admin.query(api.assignments.listAssignments, {})
    ).find((a) => a.formatId === formatId && a.creatorId === creator.creatorId)!._id;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignmentId,
      status: "to_publish",
    });
    const { publicationIds } = await creator.client.mutation(
      api.assignments.confirmPublication,
      {
        projectId,
        id: assignmentId,
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@e2etiers${ts}/video/730000${ts % 100000}` }],
      },
    );
    const publicationId = publicationIds[0];

    // 3. Cumul 2,3M → iPhone débloqué (nature, HORS total €), 5M non atteint.
    const t1 = Date.now();
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId,
      capturedAt: t1,
      vues: 2_300_000,
      likes: 50_000,
    });
    let status = await creator.client.query(api.pricing.getMyBonusStatus, {
      projectId,
    });
    expect(status!.cumulViews).toBe(2_300_000);
    expect(status!.cashUnlockedTotal).toBe(0); // iPhone ne compte pas en €
    expect(status!.natureUnlocked.map((r) => r.libelle)).toEqual(["iPhone"]);
    expect(status!.nextTier?.montant).toBe(500);
    expect(status!.viewsToNext).toBe(2_700_000);

    // 4. Cumul 5,1M → 500€ débloqués (cash), iPhone toujours là.
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId,
      capturedAt: t1 + 3_600_000,
      vues: 5_100_000,
      likes: 100_000,
    });
    status = await creator.client.query(api.pricing.getMyBonusStatus, {
      projectId,
    });
    expect(status!.cumulViews).toBe(5_100_000);
    expect(status!.cashUnlockedTotal).toBe(500);
    expect(status!.natureUnlocked.map((r) => r.libelle)).toEqual(["iPhone"]);

    // Le 500€ entre dans le total € du CYCLE COURANT (via bonusTierCashTotal) :
    // débloqué « maintenant » → cycle 0 du créateur (ex-« période du mois »).
    const pay = (
      await creator.client.query(api.payments.getMyPayments, { projectId })
    ).find((p) => p.cycleIndex === 0);
    expect(pay!.pricingBreakdown.bonusTierCashTotal).toBe(500);

    // 5. IDEMPOTENCE : re-sync (même cumul) → pas de double unlock.
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId,
      capturedAt: t1 + 7_200_000,
      vues: 5_100_000,
      likes: 100_000,
    });
    status = await creator.client.query(api.pricing.getMyBonusStatus, {
      projectId,
    });
    expect(status!.cashUnlockedTotal).toBe(500); // toujours 500, pas 1000
    expect(status!.natureUnlocked).toHaveLength(1);

    // 6. ISOLATION : un autre créateur (sans grille) ne voit aucun palier.
    const other = await createCreatorSession(url, {
      name: `[E2E_TEST] Tiers Other ${ts}`,
      email: `e2e-creator-tiers-other-${ts}@repackit.test`,
      password: "creator-tiers-other-12345",
    });
    const otherStatus = await other.client.query(api.pricing.getMyBonusStatus, {
      projectId: other.projectId,
    });
    expect(
      otherStatus === null || otherStatus.natureUnlocked.length === 0,
    ).toBe(true);

    // Cleanup.
    await admin.mutation(api.assignments.cleanupTestAssignments, { secret: E2E_SECRET });
    await admin.mutation(api.payments.cleanupTestPayments, { secret: E2E_SECRET });
    await admin.mutation(api.creators.cleanupTestCreators, { secret: E2E_SECRET });
    await admin.mutation(api.pricing.cleanupTestPricings, { secret: E2E_SECRET });
  });
});
