import { test, expect } from "@playwright/test";
import { createE2eClient } from "./helpers/authed-client";
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

/** Upload d'un blob vidéo minimal (octets bidons : on teste la mécanique du
 *  storage + la purge, pas la lecture). Renvoie le storageId. */
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
 * Parcours complet de la machine à états MP4 (vidéo-avant-publication) :
 *   in_progress → upload MP4 → video_submitted → [refus] video_rejected →
 *   re-upload (purge de l'ancien blob) → video_submitted → [validée] to_publish
 *   → URL → published.
 * Prouve : AUCUN paiement avant published ; à published la pub est matérialisée
 * + base créditée + MP4 PURGÉ ; idempotence ; isolation (MP4 + actions).
 */
test.describe("Workflow MP4 — validation avant publication", () => {
  test("upload → refus → re-upload → validation → publication (paiement + purge)", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] MP4 ${ts}`,
      email: `e2e-creator-mp4-${ts}@repackit.test`,
      password: "creator-mp4-12345",
    });
    const projectId = creator.projectId;

    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Format MP4 ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10, viewBonusPer1k: 2 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2emp4${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creator.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    const a = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.formatId === formatId && x.creatorId === creator.creatorId,
    )!;

    const statusOf = async () =>
      (
        await creator.client.query(api.assignments.getMyAssignment, {
          projectId,
          id: a._id,
        })
      )?.assignment.status;
    const myPayment = async () =>
      (await admin.query(api.payments.listPayments, {})).find(
        (p) => p.creatorId === creator.creatorId,
      );

    // ── 1. start → upload MP4 → video_submitted ──────────────────────────────
    await creator.client.mutation(api.assignments.startAssignment, {
      projectId,
      id: a._id,
    });
    const sid1 = await uploadFakeVideo(creator.client);
    await creator.client.mutation(api.assignments.submitVideo, {
      projectId,
      id: a._id,
      storageId: sid1,
      mimeType: "video/mp4",
    });
    expect(await statusOf()).toBe("video_submitted");

    // Le créateur voit SA vidéo (URL résolue) ; l'admin la voit dans la file.
    const mine1 = await creator.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: a._id,
    });
    expect(mine1?.submittedVideoUrl).toBeTruthy();
    const queue = await admin.query(api.assignments.listVideoSubmitted, {});
    expect(queue.some((q) => q._id === a._id && q.videoUrl !== null)).toBe(true);

    // AUCUN paiement à ce stade.
    expect(await myPayment()).toBeFalsy();

    // ── 2. refus (feedback) → video_rejected ─────────────────────────────────
    await admin.mutation(api.assignments.reviewVideoReject, {
      id: a._id,
      feedback: "Hook hors brief — refais.",
    });
    const mine2 = await creator.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: a._id,
    });
    expect(mine2?.assignment.status).toBe("video_rejected");
    expect(mine2?.assignment.videoReviewFeedback).toBe("Hook hors brief — refais.");
    expect(await myPayment()).toBeFalsy();

    // ── 3. re-upload → l'ancien blob est PURGÉ ───────────────────────────────
    const sid2 = await uploadFakeVideo(creator.client);
    await creator.client.mutation(api.assignments.submitVideo, {
      projectId,
      id: a._id,
      storageId: sid2,
      mimeType: "video/mp4",
    });
    expect(await statusOf()).toBe("video_submitted");
    // L'ancien MP4 refusé n'existe plus.
    expect(
      await creator.client.query(api.storage.getPreviewUrl, { storageId: sid1 }),
    ).toBeNull();

    // ── 4. validation vidéo → to_publish (toujours AUCUN paiement) ───────────
    const appr = await admin.mutation(api.assignments.reviewVideoApprove, {
      id: a._id,
    });
    expect(appr.alreadyApproved).toBe(false);
    expect(await statusOf()).toBe("to_publish");
    expect(await myPayment()).toBeFalsy();
    // Notif créateur : 1 vidéo à publier.
    expect(
      await creator.client.query(api.assignments.countMyToPublish, { projectId }),
    ).toBe(1);

    // ── 5. publication (URL) → published : matérialise + base + PURGE MP4 ─────
    const postUrl = `https://www.tiktok.com/@moi/video/${ts}`;
    const pub = await creator.client.mutation(
      api.assignments.confirmPublication,
      { projectId, id: a._id, urls: [{ platform: "TikTok", url: postUrl }] },
    );
    expect(pub.alreadyPublished).toBe(false);
    expect(pub.publicationIds.length).toBe(1);
    expect(await statusOf()).toBe("published");

    // Publication matérialisée (tracker).
    const materialized = (
      await admin.query(api.publications.listPublications, {})
    ).find((p) => p.postUrl === postUrl);
    expect(materialized).toBeTruthy();
    expect(materialized!.plateforme).toBe("TikTok");

    // Base créditée (= 10), une seule lineItem.
    const pay1 = await myPayment();
    expect(pay1).toBeTruthy();
    expect(
      pay1!.lineItems.filter(
        (li) => li.kind === "base" && li.assignmentId === a._id,
      ).length,
    ).toBe(1);
    expect(pay1!.totalDue).toBe(10);

    // MP4 de soumission PURGÉ.
    expect(
      await creator.client.query(api.storage.getPreviewUrl, { storageId: sid2 }),
    ).toBeNull();

    // ── 6. idempotence : re-confirmer ne double rien ─────────────────────────
    const again = await creator.client.mutation(
      api.assignments.confirmPublication,
      { projectId, id: a._id, urls: [{ platform: "TikTok", url: postUrl }] },
    );
    expect(again.alreadyPublished).toBe(true);
    const pubCount = (
      await admin.query(api.publications.listPublications, {})
    ).filter((p) => p.postUrl === postUrl).length;
    expect(pubCount).toBe(1);
    expect((await myPayment())!.totalDue).toBe(10); // inchangé

    // ── 7. isolation : un AUTRE créateur ne voit rien, ne peut pas valider ───
    const B = await createCreatorSession(url, {
      name: `[E2E_TEST] MP4 Other ${ts}`,
      email: `e2e-creator-mp4b-${ts}@repackit.test`,
      password: "creator-mp4b-12345",
    });
    expect(
      await B.client.query(api.assignments.getMyAssignment, {
        projectId: B.projectId,
        id: a._id,
      }),
    ).toBeNull();
    await expect(
      B.client.mutation(api.assignments.reviewVideoApprove, {
        projectId: B.projectId,
        id: a._id,
      }),
    ).rejects.toThrow();
  });
});
