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
 * Correction d'UNE brique du combo : OK avant publication (1 fois), re-fige le
 * script (rendu créateur), pricing intact ; rejets : 2e édition, publié,
 * mauvais kind, autre campagne.
 */
test.describe("Modifier une brique du combo", () => {
  test("édition unique avant publication, re-fige, pricing intact, gardes", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] ComboEdit ${ts}`,
      email: `e2e-creator-comboedit-${ts}@repackit.test`,
      password: "comboedit-12345",
    });

    // Campagne : 3 hooks (cible de swap) + 1 flux + 1 cta.
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] ComboEdit ${ts}`,
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
    await addBrick("hook", "H1", "HOOK UN", "S");
    await addBrick("hook", "H2", "HOOK DEUX", "S");
    await addBrick("hook", "H3", "HOOK TROIS", "S");
    await addBrick("flux", "F1", "FLUX UNIQUE");
    await addBrick("cta", "C1", "CTA UNIQUE");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingCE ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2ece${ts}`,
    });
    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 2,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r.created).toBe(2);

    const rowsFor = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) =>
          a.scriptCombo?.campaignId === campaignId &&
          a.creatorId === creator.creatorId,
      );
    const rows = await rowsFor();
    expect(rows.length).toBe(2);
    const a0 = rows[0];
    const b0 = rows[1];

    const campaign = await admin.query(api.scripts.getCampaign, {
      id: campaignId,
    });
    const hooks = campaign!.bricks.filter((b) => b.kind === "hook" && b.active);
    const fluxBrick = campaign!.bricks.find(
      (b) => b.kind === "flux" && b.active,
    )!;

    // ── ÉDITION OK (A, statut todo) : swap du hook.
    const newHook = hooks.find((h) => h._id !== a0.scriptCombo!.hookBrickId)!;
    const pricingBefore = a0.pricingSnapshot;
    await admin.mutation(api.scripts.editScriptCombo, {
      id: a0._id,
      slot: "hook",
      newBrickId: newHook._id,
    });

    const aAfter = (await rowsFor()).find((x) => x._id === a0._id)!;
    // Hook remplacé ; flux/cta inchangés ; verrou posé.
    expect(aAfter.scriptCombo!.hookBrickId).toBe(newHook._id);
    expect(aAfter.scriptCombo!.fluxBrickId).toBe(a0.scriptCombo!.fluxBrickId);
    expect(aAfter.scriptCombo!.ctaBrickId).toBe(a0.scriptCombo!.ctaBrickId);
    expect(aAfter.scriptCombo!.editedOnce).toBe(true);
    // Script RE-FIGÉ : rendu créateur (sans ##), nouveau hook présent.
    expect(aAfter.scriptCombo!.assembledScript).toContain("HOOK");
    expect(aAfter.scriptCombo!.assembledScript).toContain(newHook.content);
    expect(aAfter.scriptCombo!.assembledScript).toContain("FLUX UNIQUE");
    expect(aAfter.scriptCombo!.assembledScript).not.toContain("## ");
    // comboKey mis à jour (3 segments, nouveau hook en tête).
    expect(aAfter.comboKey!.split(":")).toEqual([
      newHook._id,
      a0.scriptCombo!.fluxBrickId,
      a0.scriptCombo!.ctaBrickId,
    ]);
    // PRICING strictement inchangé.
    expect(aAfter.pricingSnapshot).toEqual(pricingBefore);

    // CRÉATEUR voit la version corrigée.
    const mine = await creator.client.query(api.assignments.getMyAssignment, {
      projectId: creator.projectId,
      id: a0._id,
    });
    expect(mine!.assembledScript).toBe(aAfter.scriptCombo!.assembledScript);

    // ── 2e ÉDITION (A) → rejet "déjà modifié une fois".
    await expect(
      admin.mutation(api.scripts.editScriptCombo, {
        id: a0._id,
        slot: "flux",
        newBrickId: fluxBrick._id,
      }),
    ).rejects.toThrow(/déjà été modifié/i);

    // ── MAUVAIS KIND (B, todo) : flux dans le slot hook → rejet "type".
    await expect(
      admin.mutation(api.scripts.editScriptCombo, {
        id: b0._id,
        slot: "hook",
        newBrickId: fluxBrick._id,
      }),
    ).rejects.toThrow(/type/i);

    // ── AUTRE CAMPAGNE : hook d'une autre campagne → rejet "introuvable".
    const otherCampaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] ComboEditOther ${ts}`,
    });
    const otherHookId = await admin.mutation(api.scripts.createBrick, {
      campaignId: otherCampaignId,
      kind: "hook",
      label: "HX",
      content: "HOOK AILLEURS",
      tier: "S",
    });
    await expect(
      admin.mutation(api.scripts.editScriptCombo, {
        id: b0._id,
        slot: "hook",
        newBrickId: otherHookId,
      }),
    ).rejects.toThrow(/introuvable/i);

    // ── PUBLIÉ (B) : on force published → rejet "après publication".
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: b0._id,
      status: "published",
    });
    const newHookForB = hooks.find(
      (h) => h._id !== b0.scriptCombo!.hookBrickId,
    )!;
    await expect(
      admin.mutation(api.scripts.editScriptCombo, {
        id: b0._id,
        slot: "hook",
        newBrickId: newHookForB._id,
      }),
    ).rejects.toThrow(/après publication/i);
  });
});
