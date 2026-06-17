import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/** Médiane locale (mêmes règles que lib/scriptStats) pour l'attendu. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Campagne 3 hooks (S/A/B) × 3 corps × 2 flux × 2 cta. */
async function makeCampaign(ts: number) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Decision ${ts}`,
    demoBlock: "SOCLE DEMO DECISION",
  });
  const add = (
    kind: "hook" | "corps" | "flux" | "cta",
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
  const hookB = await add("hook", "H-B", "B");
  await add("corps", "C1");
  await add("corps", "C2");
  await add("corps", "C3");
  await add("flux", "F1");
  await add("flux", "F2");
  await add("cta", "T1");
  await add("cta", "T2");
  const tierByHook: Record<string, "S" | "A" | "B"> = {
    [hookS]: "S",
    [hookA]: "A",
    [hookB]: "B",
  };
  return { campaignId, tierByHook };
}

test.describe("S4 — moteur de décision (campaignDecisions)", () => {
  test("verdicts cohérents avec S3, fenêtre recalcule, isolation créateur", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] DecisionC ${ts}`,
      email: `e2e-creator-decision-${ts}@repackit.test`,
      password: "decision-12345",
    });
    const projectId = creator.projectId;
    const { campaignId, tierByHook } = await makeCampaign(ts);

    // 9 vidéos → round-robin par hook → 3 par tier, 1 post / combo (anti-coord).
    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorIds: [creator.creatorId],
      videosPerCreator: 9,
      dueDate: ts + 7 * DAY,
      rateModel: { basePerPost: 5 },
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

    type Post = {
      tier: "S" | "A" | "B";
      hookBrickId: string;
      corpsBrickId: string;
      fluxBrickId: string;
      ctaBrickId: string;
      publicationId: Id<"publications">;
      vues3: number;
      vues7: number;
    };
    const posts: Post[] = [];
    let i = 0;
    for (const row of rows) {
      const combo = row.scriptCombo!;
      await creator.client.mutation(api.assignments.startAssignment, {
        projectId,
        id: row._id,
      });
      await creator.client.mutation(api.assignments.submitAssignment, {
        projectId,
        id: row._id,
        url: `https://www.tiktok.com/@c/video/dec${ts}_${i}`,
      });
      const res = await admin.mutation(api.assignments.validateAssignment, {
        id: row._id,
      });
      expect(res.publicationId).toBeTruthy();
      posts.push({
        tier: tierByHook[combo.hookBrickId],
        hookBrickId: combo.hookBrickId,
        corpsBrickId: combo.corpsBrickId,
        fluxBrickId: combo.fluxBrickId,
        ctaBrickId: combo.ctaBrickId,
        publicationId: res.publicationId as Id<"publications">,
        vues3: 100 * (i + 1),
        vues7: 1000 * (i + 1), // J+7 ≠ J+3 → la fenêtre change le résultat
      });
      i++;
    }

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

    // ── campaignDecisions J+7 ────────────────────────────────────────────────
    const dec7 = await admin.query(api.scriptDecision.campaignDecisions, {
      campaignId,
      window: "j7",
    });
    expect(dec7.found).toBe(true);
    expect(dec7.totalPosts).toBe(9);
    // 9 < 50 → AUCUN verdict, tout en_test, rien de jugeable.
    expect(dec7.anyJudgeable).toBe(false);
    expect(dec7.dimensions.map((d) => d.kind)).toEqual([
      "tier",
      "corps",
      "flux",
      "cta",
    ]);
    for (const dim of dec7.dimensions) {
      for (const d of dim.decisions) {
        expect(d.verdict).toBe("en_test");
        expect(d.deltaVsPeerMedian).toBeNull();
        expect(d.peerMedian).toBeNull();
      }
    }

    // ── Cohérence : les décisions COMPOSENT sur les agrégats S3 (mêmes
    //    postCount + médianes, pas de recalcul divergent). ───────────────────
    const tier7 = await admin.query(api.scriptAnalytics.perfByTier, {
      campaignId,
      window: "j7",
    });
    const tierDim = dec7.dimensions.find((d) => d.kind === "tier")!;
    expect(tierDim.decisions.length).toBe(3);
    for (const t of ["S", "A", "B"] as const) {
      const s3 = tier7.find((x) => x.tier === t)!;
      const dec = tierDim.decisions.find((x) => x.key === t)!;
      expect(dec.postCount).toBe(s3.postCount);
      expect(dec.viewsMedian).toBe(s3.viewsMedian);
      // Recoupe l'attendu local.
      expect(dec.viewsMedian).toBe(
        median(posts.filter((p) => p.tier === t).map((p) => p.vues7)),
      );
    }

    const brick7 = await admin.query(api.scriptAnalytics.perfByBrick, {
      campaignId,
      window: "j7",
    });
    for (const kind of ["corps", "flux", "cta"] as const) {
      const dim = dec7.dimensions.find((d) => d.kind === kind)!;
      expect(dim.decisions.length).toBeGreaterThan(0);
      for (const dec of dim.decisions) {
        const s3 = brick7.find((b) => b.brickId === dec.key)!;
        expect(dec.postCount).toBe(s3.postCount);
        expect(dec.viewsMedian).toBe(s3.viewsMedian);
      }
    }

    // ── Contrat des signaux forts : aucun n'est jugeable (< 50), tous ≥ 2× la
    //    médiane de campagne, et la sortie est purement descriptive (jamais
    //    d'auto-action). La détection fine est testée en unitaire (Vitest). ──
    expect(Array.isArray(dec7.strongSignals)).toBe(true);
    for (const s of dec7.strongSignals) {
      expect(s.postCount).toBeGreaterThanOrEqual(3);
      expect(s.postCount).toBeLessThan(50);
      expect(s.multipleOfGlobal).toBeGreaterThanOrEqual(2);
      expect(s.reason.toLowerCase()).toContain("manuellement");
    }

    // ── Fenêtre J+3 ≠ J+7 : changer la fenêtre recalcule les médianes. ───────
    const dec3 = await admin.query(api.scriptDecision.campaignDecisions, {
      campaignId,
      window: "j3",
    });
    const tDim3 = dec3.dimensions.find((d) => d.kind === "tier")!;
    expect(
      (["S", "A", "B"] as const).some(
        (t) =>
          tDim3.decisions.find((x) => x.key === t)!.viewsMedian !==
          tierDim.decisions.find((x) => x.key === t)!.viewsMedian,
      ),
    ).toBe(true);

    // ── ISOLATION (Scope 5) : le créateur n'accède à AUCUNE décision. ────────
    await expect(
      creator.client.query(api.scriptDecision.campaignDecisions, {
        projectId,
        campaignId,
        window: "j7",
      }),
    ).rejects.toThrow();

    // ── UI : la page analytics affiche la section Décisions EN HAUT et, sous
    //    50 posts, l'état de collecte soigné (réaliste tant qu'il n'y a pas de
    //    volume). Les chiffres bruts S3 restent en dessous. ───────────────────
    // (La campagne vit dans le projet e2e-test, dont l'admin e2e est connecté.)
    await page.goto(adminPath(`/scripts/${campaignId}/analytics`));
    await expect(
      page.getByRole("heading", { name: "Décisions", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Encore en collecte de données."),
    ).toBeVisible();
    await expect(
      page.getByText(`atteint 50 posts publiés`, { exact: false }),
    ).toBeVisible();
    // Les chiffres bruts S3 restent rendus sous les décisions.
    await expect(
      page.getByRole("heading", { name: "Détail des chiffres" }),
    ).toBeVisible();
  });
});
