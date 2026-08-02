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
 * INSTRUCTIONS libres de l'admin POUR la créatrice — au niveau de l'assignment
 * (setAssignmentInstructions) :
 *  - édition après coup (ajout / modif / effacement), multi-ligne préservé ;
 *  - PROPRE À CETTE assignation : éditer l'une NE touche PAS l'autre (isolation) ;
 *  - normalisée (trim + tronqué à 1000) ;
 *  - vue par le créateur (getMyAssignment) ET en view-as (getAssignmentDetailAsAdmin) ;
 *  - absent = undefined (aucun bloc) ;
 *  - un créateur ne peut PAS l'éditer (adminMutation).
 */
test.describe("Instructions d'un assignment", () => {
  test("édition + isolation par assignation + multi-ligne + normalisation + view-as + auth", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] InstrC ${ts}`,
      email: `e2e-creator-instr-${ts}@repackit.test`,
      password: "instr-12345",
    });
    const projectId = creator.projectId;

    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Instr ${ts}`,
    });
    const addBrick = (kind: "hook" | "flux" | "cta", label: string, tier?: "S") =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} contenu`,
        ...(tier ? { tier } : {}),
      });
    // 2 hooks → 2 combos → 2 assignments distincts pour le même créateur
    // (nécessaire pour prouver l'isolation par assignation).
    await addBrick("hook", "H1", "S");
    await addBrick("hook", "H2", "S");
    await addBrick("flux", "F");
    await addBrick("cta", "C");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingInstr ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2einstr${ts}`,
    });

    // Deux assignations (combos distincts) — aucune instruction au départ.
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });

    const rowsForCampaign = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) =>
          a.scriptCombo?.campaignId === campaignId &&
          a.creatorId === creator.creatorId,
      );
    const getRow = async (id: string) =>
      (await rowsForCampaign()).find((a) => a._id === id)!;

    const rows0 = await rowsForCampaign();
    expect(rows0).toHaveLength(2);
    const [A, B] = rows0;
    // Au départ : aucune instruction (comportement inchangé).
    expect(A.instructions).toBeUndefined();
    expect(B.instructions).toBeUndefined();

    // ── Ajout sur A UNIQUEMENT (multi-ligne + trim) ──────────────────────────
    const multiline = "  Filme en extérieur.\nAccent sur le hook.  ";
    await admin.mutation(api.assignments.setAssignmentInstructions, {
      id: A._id,
      instructions: multiline,
    });
    // Trim des bords, retour à la ligne INTERNE conservé.
    const expected = "Filme en extérieur.\nAccent sur le hook.";
    expect((await getRow(A._id)).instructions).toBe(expected);

    // ── ISOLATION : B n'a PAS bougé (éditer Kelly ≠ éditer Sarah) ────────────
    expect((await getRow(B._id)).instructions).toBeUndefined();

    // CRÉATEUR : voit les instructions de A dans son brief.
    const mineA = await creator.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: A._id,
    });
    expect(mineA!.assignment.instructions).toBe(expected);
    // …et rien sur B.
    const mineB = await creator.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: B._id,
    });
    expect(mineB!.assignment.instructions).toBeUndefined();

    // VIEW-AS admin : même donnée via getAssignmentDetailAsAdmin.
    const asAdmin = await admin.query(
      api.assignments.getAssignmentDetailAsAdmin,
      { creatorId: creator.creatorId, id: A._id },
    );
    expect(asAdmin!.assignment.instructions).toBe(expected);

    // ── Modification ─────────────────────────────────────────────────────────
    await admin.mutation(api.assignments.setAssignmentInstructions, {
      id: A._id,
      instructions: "Mets le produit à la fin.",
    });
    expect((await getRow(A._id)).instructions).toBe("Mets le produit à la fin.");

    // ── Effacement (chaîne d'espaces → undefined, aucun bloc créatrice) ──────
    await admin.mutation(api.assignments.setAssignmentInstructions, {
      id: A._id,
      instructions: "   ",
    });
    expect((await getRow(A._id)).instructions).toBeUndefined();

    // ── Normalisation : tronqué à 1000 caractères ────────────────────────────
    await admin.mutation(api.assignments.setAssignmentInstructions, {
      id: A._id,
      instructions: "x".repeat(1500),
    });
    expect((await getRow(A._id)).instructions).toHaveLength(1000);

    // ── AUTORISATION : un créateur ne peut PAS éditer (adminMutation) ────────
    await expect(
      creator.client.mutation(api.assignments.setAssignmentInstructions, {
        projectId,
        id: A._id,
        instructions: "hack",
      }),
    ).rejects.toThrow();
  });
});
