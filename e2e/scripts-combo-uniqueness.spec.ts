import { test, expect } from "@playwright/test";
import { createE2eClient } from "./helpers/authed-client";
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
type Platform = "TikTok" | "Instagram" | "YouTube";
type Target = { platform: Platform; accountId: Id<"comptes"> };
const TT: Platform[] = ["TikTok"];
const YT: Platform[] = ["YouTube"];

/**
 * #59 — unicité d'un combo par (créateur, plateforme). Campagne minimale : 2
 * hooks × 1 flux × 1 cta = 2 combos. Prouve SERVEUR : doublon même créateur +
 * même plateforme exclu/refusé ; cross-plateforme autorisé ; autre créateur
 * autorisé ; manque de combos signalé ; garde editScriptCombo.
 */
async function makeCampaign(ts: number) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Uniq ${ts}`,
  });
  const add = (kind: "hook" | "flux" | "cta", label: string) =>
    admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind,
      label,
      content: `${label} contenu`,
      ...(kind === "hook" ? { tier: "S" as const } : {}),
    });
  const h1 = await add("hook", "H1");
  const h2 = await add("hook", "H2");
  await add("flux", "F1");
  await add("cta", "C1");
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] PricingUniq ${ts}`,
    montantFixe: 100,
    nbVideosCible: 10,
    tauxCPM: 2,
  });
  return { campaignId, h1, h2, pricingId };
}

const rowsFor = (campaignId: string, creatorId: string) =>
  admin
    .query(api.assignments.listAssignments, {})
    .then((all) =>
      all.filter(
        (a) =>
          a.scriptCombo?.campaignId === campaignId && a.creatorId === creatorId,
      ),
    );

test.describe("#59 — unicité combo × créateur × plateforme", () => {
  test("doublon même plateforme exclu ; cross-plateforme + autre créateur OK", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const a = await createCreatorSession(url, {
      name: `[E2E_TEST] UniqA ${ts}`,
      email: `e2e-uniq-a-${ts}@repackit.test`,
      password: "uniq-a-12345",
    });
    const b = await createCreatorSession(url, {
      name: `[E2E_TEST] UniqB ${ts}`,
      email: `e2e-uniq-b-${ts}@repackit.test`,
      password: "uniq-b-12345",
    });
    const { campaignId, pricingId } = await makeCampaign(ts);

    const aTikTok = await availableTarget({
      e2eClient: admin,
      creatorId: a.creatorId,
      platform: "TikTok",
      handle: `@uniqatt${ts}`,
    });
    const aYouTube = await availableTarget({
      e2eClient: admin,
      creatorId: a.creatorId,
      platform: "YouTube",
      handle: `@uniqayt${ts}`,
    });
    const bTikTok = await availableTarget({
      e2eClient: admin,
      creatorId: b.creatorId,
      platform: "TikTok",
      handle: `@uniqbtt${ts}`,
    });

    const assign = (
      creatorId: Id<"creators">,
      targets: Target[],
      videos: number,
    ) =>
      admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId,
        targets,
        videosPerCreator: videos,
        dueDate: ts + 7 * DAY,
        pricingId,
      });
    const avail = (creatorId: Id<"creators">, platforms: Platform[]) =>
      admin.query(api.scripts.availableCombosForAssignment, {
        campaignId,
        creatorId,
        platforms,
      });

    // A sur TikTok : 2 vidéos → les 2 combos pris sur TikTok.
    expect((await assign(a.creatorId, [aTikTok], 2)).created).toBe(2);

    // Query : 0 combo dispo sur TikTok pour A, mais 2 sur YouTube (cross-pf).
    expect(await avail(a.creatorId, TT)).toEqual({ total: 2, available: 0 });
    expect(await avail(a.creatorId, YT)).toEqual({ total: 2, available: 2 });

    // A sur TikTok encore : plus de combo unique → 0 assigné + shortage.
    const again = await assign(a.creatorId, [aTikTok], 1);
    expect(again.created).toBe(0);
    expect(again.shortages.length).toBe(1);
    expect(again.shortages[0].assigned).toBe(0);

    // A sur YOUTUBE : cross-plateforme AUTORISÉ → 2 assignés.
    expect((await assign(a.creatorId, [aYouTube], 2)).created).toBe(2);
    expect((await avail(a.creatorId, YT)).available).toBe(0);

    // AUTRE créateur (B) sur TikTok : mêmes combos dispo → 2 assignés.
    expect((await assign(b.creatorId, [bTikTok], 2)).created).toBe(2);

    // A : mêmes comboKeys présents sur TikTok ET YouTube (cross-pf réutilisé).
    const aRows = await rowsFor(campaignId, a.creatorId);
    const keysOn = (platform: string) =>
      new Set(
        aRows
          .filter((r) => (r.targets ?? []).some((t) => t.platform === platform))
          .map((r) => r.comboKey),
      );
    const ttKeys = keysOn("TikTok");
    const ytKeys = keysOn("YouTube");
    expect(ttKeys.size).toBe(2);
    expect([...ytKeys].sort()).toEqual([...ttKeys].sort());

    // B (TikTok) partage les mêmes combos que A (TikTok) — autre créateur OK.
    const bRows = await rowsFor(campaignId, b.creatorId);
    expect(new Set(bRows.map((r) => r.comboKey))).toEqual(ttKeys);
  });

  test("editScriptCombo refuse un (combo, créateur, plateforme) en doublon", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const c = await createCreatorSession(url, {
      name: `[E2E_TEST] UniqEdit ${ts}`,
      email: `e2e-uniq-edit-${ts}@repackit.test`,
      password: "uniq-edit-123",
    });
    const { campaignId, h1, h2, pricingId } = await makeCampaign(ts);
    const tTikTok = await availableTarget({
      e2eClient: admin,
      creatorId: c.creatorId,
      platform: "TikTok",
      handle: `@uniqedit${ts}`,
    });
    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: c.creatorId,
      targets: [tTikTok],
      videosPerCreator: 2,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r.created).toBe(2); // combos H1.. et H2.. pris sur TikTok

    // Éditer l'assignment du hook H1 vers H2 ⇒ son comboKey deviendrait celui
    // de l'autre assignment (même créateur, même plateforme) ⇒ REFUS.
    const rows = await rowsFor(campaignId, c.creatorId);
    const onH1 = rows.find((x) => x.scriptCombo?.hookBrickId === h1)!;
    await expect(
      admin.mutation(api.scripts.editScriptCombo, {
        id: onH1._id,
        slot: "hook",
        newBrickId: h2,
      }),
    ).rejects.toThrow(/déjà utilisé.*TikTok/i);

    // Garde-fou : l'assignment n'a pas changé (toujours sur H1, pas de verrou).
    const after = (await rowsFor(campaignId, c.creatorId)).find(
      (x) => x._id === onH1._id,
    )!;
    expect(after.scriptCombo?.hookBrickId).toBe(h1);
    expect(after.scriptCombo?.editedOnce ?? false).toBe(false);
  });
});
