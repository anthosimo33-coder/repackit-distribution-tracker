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

/** Médiane locale (mêmes règles que lib/scriptStats) pour calculer l'attendu. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Campagne 3 hooks (S/A/B) × 2 flux × 2 cta = 12 combos (refonte 3 briques). */
async function makeCampaign(ts: number) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Analytics ${ts}`,
  });
  const add = (
    kind: "hook" | "flux" | "cta",
    label: string,
    tier?: "S" | "A" | "B",
  ) =>
    admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind,
      label,
      content: `${label} contenu`,
      ...(tier ? { tier } : {}),
    });
  const hookS = await add("hook", "H-S", "S");
  const hookA = await add("hook", "H-A", "A");
  // 3e hook créé en "B" LEGACY : prouve que perfByTier le replie sur « Autre »
  // (A). Son tier EFFECTIF d'agrégation est donc "A".
  const hookB = await add("hook", "H-B", "B");
  await add("flux", "F1");
  await add("flux", "F2");
  await add("cta", "T1");
  await add("cta", "T2");
  const tierByHook: Record<string, "S" | "A"> = {
    [hookS]: "S",
    [hookA]: "A",
    [hookB]: "A", // ex-"B" → « Autre »
  };
  return { campaignId, tierByHook };
}

test.describe("S3 — analytics par variable de script", () => {
  test("raccord combo↔publication, médianes par tier/brique/combo, fenêtre, isolation", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] AnalyticsC ${ts}`,
      email: `e2e-creator-analytics-${ts}@repackit.test`,
      password: "analytics-12345",
    });
    const projectId = creator.projectId;
    const { campaignId, tierByHook } = await makeCampaign(ts);
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Pricing ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });

    const tAn = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2ean${ts}`,
    });
    // 9 vidéos → round-robin par hook → 3 par tier.
    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [tAn],
      videosPerCreator: 9,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r.created).toBe(9);

    const rows = (
      await admin.query(api.assignments.listAssignments, {})
    ).filter(
      (x) =>
        x.scriptCombo?.campaignId === campaignId &&
        x.creatorId === creator.creatorId,
    );
    expect(rows.length).toBe(9);

    // Valide chaque post → matérialise une publication PORTANT le combo.
    type Post = {
      tier: "S" | "A";
      hookBrickId: string;
      fluxBrickId: string;
      ctaBrickId: string;
      comboKey: string;
      publicationId: Id<"publications">;
      vues3: number;
      vues7: number;
    };
    const posts: Post[] = [];
    let i = 0;
    for (const row of rows) {
      const combo = row.scriptCombo!;
      // Machine MP4 : on saute la revue vidéo (pas d'upload en e2e) en forçant
      // to_publish, puis le créateur PUBLIE (confirmPublication = matérialise).
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: row._id,
        status: "to_publish",
      });
      const res = await creator.client.mutation(
        api.assignments.confirmPublication,
        {
          projectId,
          id: row._id,
          urls: [
            {
              platform: "TikTok",
              url: `https://www.tiktok.com/@c/video/an${ts}_${i}`,
            },
          ],
        },
      );
      // La publication d'un script matérialise bien une publication.
      expect(res.publicationIds[0]).toBeTruthy();
      posts.push({
        tier: tierByHook[combo.hookBrickId],
        hookBrickId: combo.hookBrickId,
        fluxBrickId: combo.fluxBrickId,
        ctaBrickId: combo.ctaBrickId,
        comboKey: row.comboKey!,
        publicationId: res.publicationIds[0],
        vues3: 100 * (i + 1),
        vues7: 1000 * (i + 1),
      });
      i++;
    }

    // 2 snapshots par post : J+3 et J+7 (valeurs distinctes → la fenêtre change
    // bien le résultat). datePubli = submittedAt ≈ maintenant ; on ancre les
    // captures sur une base postérieure à tous les submits.
    const base = Date.now();
    for (const p of posts) {
      await admin.mutation(api.metricSnapshots.createSnapshot, {
        publicationId: p.publicationId,
        capturedAt: base + 3 * DAY,
        vues: p.vues3,
        likes: 0,
      });
      await admin.mutation(api.metricSnapshots.createSnapshot, {
        publicationId: p.publicationId,
        capturedAt: base + 7 * DAY,
        vues: p.vues7,
        likes: 0,
      });
    }

    // ── perfByTier J+7 : 2 tiers (Argent/Autre), médianes correctes, tout "en
    // test" (< 50). « Autre » (A) cumule hookA + l'ex-"B" replié.
    const tier7 = await admin.query(api.scriptAnalytics.perfByTier, {
      campaignId,
      window: "j7",
    });
    expect(tier7.map((x) => x.tier).sort()).toEqual(["A", "S"]);
    for (const t of ["S", "A"] as const) {
      const inTier = posts.filter((p) => p.tier === t);
      const row = tier7.find((x) => x.tier === t)!;
      expect(row.viewsMedian).toBe(median(inTier.map((p) => p.vues7)));
      expect(row.postCount).toBe(inTier.length); // S=3, A=6 (3 + ex-B 3)
      expect(row.status).toBe("en_test"); // jamais "jugeable" sous 50
    }

    // ── Fenêtre J+3 ≠ J+7 (recalcule sur l'autre snapshot).
    const tier3 = await admin.query(api.scriptAnalytics.perfByTier, {
      campaignId,
      window: "j3",
    });
    for (const t of ["S", "A"] as const) {
      const expected = median(
        posts.filter((p) => p.tier === t).map((p) => p.vues3),
      );
      expect(tier3.find((x) => x.tier === t)!.viewsMedian).toBe(expected);
    }
    // Au moins un tier a une médiane différente entre J+3 et J+7.
    expect(
      (["S", "A"] as const).some(
        (t) =>
          tier3.find((x) => x.tier === t)!.viewsMedian !==
          tier7.find((x) => x.tier === t)!.viewsMedian,
      ),
    ).toBe(true);

    // ── perfByBrick J+7 : la brique hook de chaque tier a postCount 3 + médiane.
    const brick7 = await admin.query(api.scriptAnalytics.perfByBrick, {
      campaignId,
      window: "j7",
    });
    for (const p of posts) {
      const hookRow = brick7.find((b) => b.brickId === p.hookBrickId)!;
      expect(hookRow.kind).toBe("hook");
      expect(hookRow.postCount).toBe(3);
      const expected = median(
        posts.filter((x) => x.hookBrickId === p.hookBrickId).map((x) => x.vues7),
      );
      expect(hookRow.viewsMedian).toBe(expected);
      expect(hookRow.status).toBe("en_test");
    }

    // ── perfByCombo J+7 : 1 post/combo (anti-coord) → tous en test, aucun signal.
    const combo7 = await admin.query(api.scriptAnalytics.perfByCombo, {
      campaignId,
      window: "j7",
    });
    expect(combo7.length).toBe(9);
    for (const c of combo7) {
      expect(c.postCount).toBe(1);
      expect(c.status).toBe("en_test");
      expect(c.signal).toBe(false); // jamais "signal" sous le seuil
    }
    // Trié par médiane décroissante.
    for (let k = 1; k < combo7.length; k++) {
      expect(combo7[k - 1].viewsMedian! >= combo7[k].viewsMedian!).toBe(true);
    }

    // ── ISOLATION (Scope 3) : le créateur n'accède à AUCUNE stat de combo.
    await expect(
      creator.client.query(api.scriptAnalytics.perfByTier, {
        projectId,
        campaignId,
        window: "j7",
      }),
    ).rejects.toThrow();
    await expect(
      creator.client.query(api.scriptAnalytics.perfByBrick, {
        projectId,
        campaignId,
        window: "j7",
      }),
    ).rejects.toThrow();
    await expect(
      creator.client.query(api.scriptAnalytics.perfByCombo, {
        projectId,
        campaignId,
        window: "j7",
      }),
    ).rejects.toThrow();
  });
});
