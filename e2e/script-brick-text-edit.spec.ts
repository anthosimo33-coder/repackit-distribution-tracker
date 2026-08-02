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
 * Éditer le texte d'une brique = FORK une nouvelle brique (même kind+tier) et
 * l'applique. RÉPÉTABLE tant que le post n'est pas publié (plus de verrou "une
 * seule fois" ni de verrou partagé) ; le SEUL verrou est le lien de publication.
 * Pricing intact, original intact.
 */
test.describe("Éditer le texte d'une brique (fork)", () => {
  test("fork même kind+tier, original intact, répétable, publié rejeté, pricing intact", async () => {
    test.setTimeout(160_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] TextEdit ${ts}`,
      email: `e2e-creator-textedit-${ts}@repackit.test`,
      password: "textedit-12345",
    });
    const projectId = creator.projectId;

    // Campagne : 3 hooks (tier A) + 1 flux + 1 cta → 3 combos.
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] TextEdit ${ts}`,
    });
    const add = (
      kind: "hook" | "flux" | "cta",
      label: string,
      content: string,
      tier?: "A",
    ) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content,
        ...(tier ? { tier } : {}),
      });
    await add("hook", "H1", "HOOK UN", "A");
    await add("hook", "H2", "HOOK DEUX", "A");
    await add("hook", "H3", "HOOK TROIS", "A");
    await add("flux", "F1", "FLUX UNIQUE");
    await add("cta", "C1", "CTA UNIQUE");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingTE ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2ete${ts}`,
    });
    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 3,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r.created).toBe(3);

    const rowsFor = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (x) =>
          x.scriptCombo?.campaignId === campaignId &&
          x.creatorId === creator.creatorId,
      );
    const rows = await rowsFor();
    expect(rows.length).toBe(3);
    const [aRow, bRow, cRow] = rows;

    const campBefore = await admin.query(api.scripts.getCampaign, {
      id: campaignId,
    });
    const bricksCountBefore = campBefore!.bricks.length;
    const aOrigHookId = aRow.scriptCombo!.hookBrickId;
    const aOrigHook = campBefore!.bricks.find((b) => b._id === aOrigHookId)!;
    const pricingBefore = aRow.pricingSnapshot;

    // ── Texte vide rejeté (A pas encore édité → passe les gardes, échoue texte) ─
    await expect(
      admin.mutation(api.scripts.editScriptBrickText, {
        id: aRow._id,
        slot: "hook",
        newText: "   ",
      }),
    ).rejects.toThrow(/requis/i);

    // ── ÉDITION DE TEXTE (A) : fork du hook ──────────────────────────────────
    const newText = `HOOK ÉDITÉ ${ts}`;
    const res = await admin.mutation(api.scripts.editScriptBrickText, {
      id: aRow._id,
      slot: "hook",
      newText,
    });
    expect(res.forkedBrickId).toBeTruthy();

    const aAfter = (await rowsFor()).find((x) => x._id === aRow._id)!;
    // Le slot pointe la brique FORKÉE (≠ originale) ; verrou posé.
    expect(aAfter.scriptCombo!.hookBrickId).toBe(res.forkedBrickId);
    expect(aAfter.scriptCombo!.hookBrickId).not.toBe(aOrigHookId);
    expect(aAfter.scriptCombo!.fluxBrickId).toBe(aRow.scriptCombo!.fluxBrickId);
    expect(aAfter.scriptCombo!.editedOnce).toBe(true);
    // Script RE-FIGÉ : rendu créateur (sans ##), nouveau texte présent.
    expect(aAfter.scriptCombo!.assembledScript).toContain(newText);
    expect(aAfter.scriptCombo!.assembledScript).toContain("FLUX UNIQUE");
    expect(aAfter.scriptCombo!.assembledScript).not.toContain("## ");
    // PRICING strictement inchangé.
    expect(aAfter.pricingSnapshot).toEqual(pricingBefore);

    // Bibliothèque : +1 brique forkée (même kind+tier), original INTACT.
    const campAfter = await admin.query(api.scripts.getCampaign, {
      id: campaignId,
    });
    expect(campAfter!.bricks.length).toBe(bricksCountBefore + 1);
    const forked = campAfter!.bricks.find((b) => b._id === res.forkedBrickId)!;
    expect(forked.kind).toBe("hook");
    expect(forked.tier).toBe("A"); // hérite du tier
    expect(forked.content).toBe(newText);
    expect(forked.active).toBe(true);
    expect(forked.label).toContain("(variante)");
    const origStill = campAfter!.bricks.find((b) => b._id === aOrigHookId)!;
    expect(origStill.content).toBe(aOrigHook.content); // jamais écrasée

    // Créateur voit la version éditée.
    const mine = await creator.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: aRow._id,
    });
    expect(mine!.assembledScript).toContain(newText);

    // ── PLUS DE VERROU "une seule fois" : ré-éditer le texte de A fonctionne
    // (nouveau fork). On corrige autant que nécessaire tant que A n'est pas publié.
    const res2 = await admin.mutation(api.scripts.editScriptBrickText, {
      id: aRow._id,
      slot: "hook",
      newText: `HOOK RÉ-ÉDITÉ ${ts}`,
    });
    expect(res2.forkedBrickId).toBeTruthy();
    const aAfter2 = (await rowsFor()).find((x) => x._id === aRow._id)!;
    expect(aAfter2.scriptCombo!.assembledScript).toContain(`HOOK RÉ-ÉDITÉ ${ts}`);

    // ── PLUS DE VERROU PARTAGÉ : combo(B) PUIS texte(B) → les DEUX passent tant
    // que B n'est pas publié (le lien de publication est le seul verrou).
    const swapForB = campAfter!.bricks.find(
      (b) => b.kind === "hook" && b.active && b._id !== bRow.scriptCombo!.hookBrickId,
    )!;
    await admin.mutation(api.scripts.editScriptCombo, {
      id: bRow._id,
      slot: "hook",
      newBrickId: swapForB._id,
    });
    const resB = await admin.mutation(api.scripts.editScriptBrickText, {
      id: bRow._id,
      slot: "hook",
      newText: `B RÉ-ÉDITÉ ${ts}`,
    });
    expect(resB.forkedBrickId).toBeTruthy();

    // ── PUBLIÉ (C) : on publie POUR DE VRAI → édition de texte VERROUILLÉE.
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: cRow._id,
      urls: [
        { platform: "TikTok", url: `https://www.tiktok.com/@e2e/video/c${ts}` },
      ],
    });
    await expect(
      admin.mutation(api.scripts.editScriptBrickText, {
        id: cRow._id,
        slot: "hook",
        newText: "trop tard",
      }),
    ).rejects.toThrow(/publié/i);
  });
});
