/**
 * POSER UNE VIDÉO SOUMISE sur une mission — le cœur commun à la soumission
 * d'une créatrice ou d'un clippeur (convex/assignments submitVideoCore) et au
 * rattachement d'une vidéo archivée par l'équipe (convex/deletedVideos
 * attachToMission). Dans les deux cas la vidéo entre au même endroit du
 * circuit : « vidéo envoyée », en file de Validation.
 */

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { ERR, err } from "./errorCodes";
import { deleteStorageBestEffort } from "./storageCleanup";

/** Statuts depuis lesquels une vidéo s'envoie (re-soumission après refus comprise). */
export const VIDEO_SUBMITTABLE_STATUSES: ReadonlySet<string> = new Set([
  "todo",
  "in_progress",
  "video_rejected",
]);

/**
 * Autorisé depuis todo / in_progress / video_rejected. Un remplacement PURGE
 * l'ancien blob (refusé) et sa copie Cloudflare Stream ; la nouvelle vidéo
 * repart d'un transcoding neuf, planifié hors du chemin critique.
 */
export async function poserVideoSoumise(
  ctx: MutationCtx,
  a: Doc<"assignments">,
  storageId: Id<"_storage">,
  mimeType: string | undefined,
): Promise<void> {
  if (!VIDEO_SUBMITTABLE_STATUSES.has(a.status)) {
    throw err(ERR.VIDEO_SUBMIT_WRONG_STATE, "Soumission vidéo impossible dans cet état.");
  }
  // Remplacement : l'ancienne vidéo (refusée) est purgée du storage, et sa
  // copie Cloudflare Stream supprimée (best-effort, hygiène de coût).
  if (a.submittedVideoStorageId && a.submittedVideoStorageId !== storageId) {
    await deleteStorageBestEffort(ctx, a.submittedVideoStorageId);
  }
  if (a.submittedVideoStreamUid) {
    await ctx.scheduler.runAfter(0, internal.cloudflareStream.deleteStreamAsset, {
      uid: a.submittedVideoStreamUid,
    });
  }
  await ctx.db.patch(a._id, {
    status: "video_submitted",
    submittedVideoStorageId: storageId,
    submittedVideoMimeType: mimeType ?? "video/mp4",
    // Reset Stream : la nouvelle vidéo repart d'un transcoding neuf (l'UI
    // retombe sur le <video> Convex tant que le UID n'est pas reposé).
    submittedVideoStreamUid: undefined,
    submittedVideoStreamStatus: undefined,
    videoReviewFeedback: undefined,
  });
  // TRANSCODING HEVC (hors chemin critique) : Cloudflare Stream récupère la
  // vidéo depuis l'URL signée Convex et la transcode. Sans env Cloudflare,
  // l'action no-op proprement → fallback Convex. La soumission n'est JAMAIS
  // bloquée par Cloudflare.
  await ctx.scheduler.runAfter(0, internal.cloudflareStream.startStreamCopy, { assignmentId: a._id });
}
