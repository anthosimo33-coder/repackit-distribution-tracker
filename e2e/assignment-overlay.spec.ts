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
 * Texte OVERLAY à incruster en haut de la vidéo — au niveau de l'assignment :
 *  - saisi à la création (assignScriptCampaign) ;
 *  - édité après coup (setAssignmentOverlayText : ajout / modif / effacement) ;
 *  - normalisé (trim + tronqué à 200) ;
 *  - vu par le créateur (getMyAssignment) ET en view-as (getAssignmentDetailAsAdmin) ;
 *  - absent = undefined (comportement inchangé) ;
 *  - un créateur ne peut PAS l'éditer (adminMutation).
 */
test.describe("Texte overlay d'un assignment", () => {
  test("création + édition + normalisation + view-as + auth", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] OverlayC ${ts}`,
      email: `e2e-creator-overlay-${ts}@repackit.test`,
      password: "overlay-12345",
    });
    const projectId = creator.projectId;

    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Overlay ${ts}`,
    });
    const addBrick = (kind: "hook" | "flux" | "cta", label: string, tier?: "S") =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} contenu`,
        ...(tier ? { tier } : {}),
      });
    // 2 hooks → 2 combos (permet 2 assignments distincts pour le même créateur).
    await addBrick("hook", "H1", "S");
    await addBrick("hook", "H2", "S");
    await addBrick("flux", "F");
    await addBrick("cta", "C");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingOv ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2eov${ts}`,
    });

    // ── Création AVEC overlayText (trim appliqué) ────────────────────────────
    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      overlayText: "  Réservé aux 100 premiers  ",
    });
    expect(r.created).toBe(1);

    const rowsForCampaign = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) =>
          a.scriptCombo?.campaignId === campaignId &&
          a.creatorId === creator.creatorId,
      );
    const getRow = async (id: string) =>
      (await rowsForCampaign()).find((a) => a._id === id)!;
    const row0 = (await rowsForCampaign())[0];
    const assignmentId = row0._id;
    expect(row0.overlayText).toBe("Réservé aux 100 premiers"); // trimmé

    // CRÉATEUR : voit l'overlay dans son brief.
    const mine = await creator.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: assignmentId,
    });
    expect(mine!.assignment.overlayText).toBe("Réservé aux 100 premiers");

    // VIEW-AS admin : même donnée via getAssignmentDetailAsAdmin.
    const asAdmin = await admin.query(
      api.assignments.getAssignmentDetailAsAdmin,
      { creatorId: creator.creatorId, id: assignmentId },
    );
    expect(asAdmin!.assignment.overlayText).toBe("Réservé aux 100 premiers");

    // ── Édition : modification ───────────────────────────────────────────────
    await admin.mutation(api.assignments.setAssignmentOverlayText, {
      id: assignmentId,
      overlayText: "Nouvelle consigne",
    });
    const mine2 = await creator.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: assignmentId,
    });
    expect(mine2!.assignment.overlayText).toBe("Nouvelle consigne");

    // ── Édition : effacement (chaîne d'espaces → undefined) ──────────────────
    await admin.mutation(api.assignments.setAssignmentOverlayText, {
      id: assignmentId,
      overlayText: "   ",
    });
    expect((await getRow(assignmentId)).overlayText).toBeUndefined();

    // ── Normalisation : tronqué à 200 caractères ─────────────────────────────
    await admin.mutation(api.assignments.setAssignmentOverlayText, {
      id: assignmentId,
      overlayText: "x".repeat(500),
    });
    expect((await getRow(assignmentId)).overlayText).toHaveLength(200);

    // ── AUTORISATION : un créateur ne peut PAS éditer l'overlay (adminMutation).
    await expect(
      creator.client.mutation(api.assignments.setAssignmentOverlayText, {
        projectId,
        id: assignmentId,
        overlayText: "hack",
      }),
    ).rejects.toThrow();

    // ── Un assignment SANS overlay → undefined (comportement inchangé) ───────
    const r2 = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r2.created).toBe(1);
    const rowNoOverlay = (await rowsForCampaign()).find(
      (a) => a._id !== assignmentId,
    )!;
    expect(rowNoOverlay.overlayText).toBeUndefined();
  });
});
