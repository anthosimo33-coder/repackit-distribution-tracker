import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
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
 * Correction d'UNE brique du combo : OK tant que le post n'est pas publié
 * (RÉPÉTABLE, plus de verrou "une seule fois"), re-fige le script (rendu
 * créateur), pricing intact ; rejets : publié (lien existant), mauvais kind,
 * autre campagne. Le verrou = existence d'un lien de publication, pas le statut.
 */
test.describe("Modifier une brique du combo", () => {
  test("édition répétable tant que non publié, re-fige, pricing intact, gardes", async () => {
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

    // ── ÉDITION OK (A, statut todo) : swap du hook vers un hook LIBRE (ni a0 ni
    // b0). Viser le combo de b0 serait refusé : unicité comboKey × créateur ×
    // plateforme (#59 — a0 et b0 sont du même créateur sur la même plateforme).
    const newHook = hooks.find(
      (h) =>
        h._id !== a0.scriptCombo!.hookBrickId &&
        h._id !== b0.scriptCombo!.hookBrickId,
    )!;
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

    // ── 2e ÉDITION (A) → SUCCÈS : plus de verrou "une seule fois" (on corrige
    // autant que nécessaire tant que le post n'est pas publié). On revient au hook
    // d'ORIGINE de A (libéré au 1er swap) → comboKey unique garanti.
    await admin.mutation(api.scripts.editScriptCombo, {
      id: a0._id,
      slot: "hook",
      newBrickId: a0.scriptCombo!.hookBrickId,
    });
    const aAfter2 = (await rowsFor()).find((x) => x._id === a0._id)!;
    expect(aAfter2.scriptCombo!.hookBrickId).toBe(a0.scriptCombo!.hookBrickId);
    expect(aAfter2.scriptCombo!.editedOnce).toBe(true); // traceur, plus un verrou

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

    // ── PUBLIÉ (B) : on publie POUR DE VRAI (lien) → l'édition est VERROUILLÉE.
    // Le verrou est désormais l'EXISTENCE D'UN LIEN de publication, pas le statut.
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: b0._id,
      urls: [
        { platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/${ts}` },
      ],
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
    ).rejects.toThrow(/publié/i);
  });
});
