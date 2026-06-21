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
 * Vidéos modèles (LIENS à reproduire) attachées à un assignment : ajout/retrait
 * admin à chaud APRÈS l'assignation, visibilité côté créateur, validation d'URL,
 * et garde d'autorisation (un créateur ne gère pas les vidéos modèles).
 */
test.describe("Vidéos modèles liées à un assignment", () => {
  test("ajout/suppression admin, visibilité créateur, validation, auth", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] ModelVidC ${ts}`,
      email: `e2e-creator-modelvid-${ts}@repackit.test`,
      password: "modelvid-12345",
    });
    const projectId = creator.projectId;

    // Campagne minimale (1 hook/flux/cta) + pricing obligatoire + cible.
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] ModelVid ${ts}`,
    });
    const addBrick = (
      kind: "hook" | "flux" | "cta",
      label: string,
      tier?: "S",
    ) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} contenu`,
        ...(tier ? { tier } : {}),
      });
    await addBrick("hook", "H", "S");
    await addBrick("flux", "F");
    await addBrick("cta", "C");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingMV ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2emv${ts}`,
    });
    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r.created).toBe(1);

    const findRow = async () =>
      (await admin.query(api.assignments.listAssignments, {})).find(
        (a) =>
          a.scriptCombo?.campaignId === campaignId &&
          a.creatorId === creator.creatorId,
      )!;
    const row0 = await findRow();
    expect(row0.modelVideos ?? []).toHaveLength(0);
    const assignmentId = row0._id;

    // AUTORISATION : un créateur ne peut PAS gérer les vidéos modèles (adminMutation).
    await expect(
      creator.client.mutation(api.assignments.addModelVideoToAssignment, {
        projectId,
        id: assignmentId,
        url: "https://www.tiktok.com/@x/video/1",
      }),
    ).rejects.toThrow();

    // VALIDATION URL : vide / non-http → rejet lisible.
    await expect(
      admin.mutation(api.assignments.addModelVideoToAssignment, {
        id: assignmentId,
        url: "   ",
      }),
    ).rejects.toThrow(/invalide/i);
    await expect(
      admin.mutation(api.assignments.addModelVideoToAssignment, {
        id: assignmentId,
        url: "tiktok.com/@x",
      }),
    ).rejects.toThrow(/invalide/i);

    // AJOUT (à chaud, APRÈS l'assignation) de 2 vidéos modèles.
    const v1 = await admin.mutation(api.assignments.addModelVideoToAssignment, {
      id: assignmentId,
      url: "https://www.tiktok.com/@x/video/123",
      title: "Ref TikTok",
      note: "Reproduis le hook",
    });
    await admin.mutation(api.assignments.addModelVideoToAssignment, {
      id: assignmentId,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });

    // ADMIN : la liste porte les 2 vidéos modèles (url/titre/note conservés).
    const row1 = await findRow();
    expect(row1.modelVideos ?? []).toHaveLength(2);
    const tiktok = row1.modelVideos!.find((m) => m.id === v1.id)!;
    expect(tiktok.url).toContain("tiktok.com");
    expect(tiktok.title).toBe("Ref TikTok");
    expect(tiktok.note).toBe("Reproduis le hook");

    // CRÉATEUR : visibilité dans son brief (getMyAssignment), isolation OK.
    const mine = await creator.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: assignmentId,
    });
    expect(mine).toBeTruthy();
    expect(mine!.assignment.modelVideos ?? []).toHaveLength(2);

    // SUPPRESSION à l'unité (admin) → créateur ne voit plus que 1.
    await admin.mutation(api.assignments.removeModelVideoFromAssignment, {
      id: assignmentId,
      videoId: v1.id,
    });
    const row2 = await findRow();
    expect(row2.modelVideos ?? []).toHaveLength(1);
    expect(row2.modelVideos!.some((m) => m.id === v1.id)).toBe(false);
    const mine2 = await creator.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: assignmentId,
    });
    expect(mine2!.assignment.modelVideos ?? []).toHaveLength(1);
  });
});
