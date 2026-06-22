import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { ConvexHttpClient } from "convex/browser";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/** Upload d'un blob vidéo minimal → storageId (mécanique storage, pas lecture). */
async function uploadFakeVideo(client: ConvexHttpClient): Promise<Id<"_storage">> {
  const uploadUrl = await client.mutation(api.storage.generateUploadUrl, {});
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "video/mp4" },
    body: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]),
  });
  if (!res.ok) throw new Error(`upload échoué (HTTP ${res.status})`);
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  return storageId;
}

/**
 * Écran Validation : sur une vidéo de type SCRIPT en attente, l'admin voit le
 * SCRIPT MONTÉ figé (Hook→Flux→CTA, rendu créateur sans ##) pour comparer la
 * vidéo au script attendu. Pas d'encart script pour une soumission de FORMAT.
 * Valider reste accessible.
 */
test.describe("Validation — script monté à côté de la vidéo", () => {
  test("script visible (origine script) ; absent (origine format) ; Valider OK", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] ValScript ${ts}`,
      email: `e2e-creator-valscript-${ts}@repackit.test`,
      password: "valscript-12345",
    });
    const projectId = creator.projectId;

    // ─── Assignment SCRIPT : campagne minimale (1 hook/flux/cta) + assignation ──
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] ValScript ${ts}`,
    });
    const addBrick = (
      kind: "hook" | "flux" | "cta",
      label: string,
      content: string,
      tier?: "S",
    ) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content,
        ...(tier ? { tier } : {}),
      });
    await addBrick("hook", "H", "HOOK ACCROCHE VALSCRIPT", "S");
    await addBrick("flux", "F", "FLUX CORPS VALSCRIPT UNIQUE");
    await addBrick("cta", "C", "CTA ABONNE VALSCRIPT");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingVS ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const tScript = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2evs${ts}`,
    });
    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [tScript],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r.created).toBe(1);
    const scriptRow = (
      await admin.query(api.assignments.listAssignments, {})
    ).find(
      (a) =>
        a.scriptCombo?.campaignId === campaignId &&
        a.creatorId === creator.creatorId,
    )!;
    const scriptId = scriptRow._id;

    // Soumission : le créateur poste une vidéo → video_submitted (script figé
    // déjà attaché au combo de l'assignment).
    const sid = await uploadFakeVideo(creator.client);
    await creator.client.mutation(api.assignments.submitVideo, {
      projectId,
      id: scriptId,
      storageId: sid,
      mimeType: "video/mp4",
    });

    // L'écran Validation expose bien l'assembledScript FIGÉ (non re-dérivé).
    const vrow = (
      await admin.query(api.assignments.listVideoSubmitted, {})
    ).find((x) => x._id === scriptId)!;
    expect(vrow.assembledScript).toContain("HOOK ACCROCHE VALSCRIPT");
    expect(vrow.assembledScript).toContain("FLUX CORPS VALSCRIPT UNIQUE");
    expect(vrow.assembledScript).not.toContain("## ");

    // ─── Assignment FORMAT (pas de script) en attente de validation ──────────
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Format VS ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });
    const tFormat = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2evsf${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creator.creatorId,
      targets: [tFormat],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    const formatAssignmentId = (
      await admin.query(api.assignments.listAssignments, {})
    ).find(
      (x) => x.formatId === formatId && x.creatorId === creator.creatorId,
    )!._id;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: formatAssignmentId,
      status: "video_submitted",
    });

    // ─── UI ──────────────────────────────────────────────────────────────────
    await page.goto(adminPath("/validation"));

    // Carte SCRIPT : encart « Script à suivre » déplié, contenu figé visible.
    await expect(page.getByTestId(`script-toggle-${scriptId}`)).toBeVisible({
      timeout: 15_000,
    });
    const scriptContent = page.getByTestId(`script-content-${scriptId}`);
    await expect(scriptContent).toBeVisible();
    await expect(scriptContent).toContainText("HOOK ACCROCHE VALSCRIPT");
    await expect(scriptContent).toContainText("FLUX CORPS VALSCRIPT UNIQUE");
    // Valider reste accessible.
    await expect(page.getByTestId(`approve-${scriptId}`)).toBeVisible();

    // Carte FORMAT : aucun encart script, mais Valider présent.
    await expect(page.getByTestId(`approve-${formatAssignmentId}`)).toBeVisible();
    await expect(
      page.getByTestId(`script-toggle-${formatAssignmentId}`),
    ).toHaveCount(0);
  });
});
