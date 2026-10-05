/**
 * ARCHIVE DES VIDÉOS DE MISSIONS SUPPRIMÉES — cf convex/assignmentVideo.
 *
 * Supprimer une mission (bouton de l'écran, cascade d'une créatrice supprimée)
 * n'efface plus la vidéo envoyée : la mission part, ses fichiers restent, et la
 * mission entière est gardée ici en JSON. Récupérable
 * `DELETED_VIDEO_RETENTION_DAYS` jours (`list` : le lien du fichier, l'uid
 * Stream), puis purgée par le cron quotidien `purge-deleted-submitted-videos`.
 *
 * La purge de TEST (cleanupTestAssignments) et la suppression d'un PROJET
 * effacent toujours sur-le-champ : rien à protéger dans le premier cas, un
 * effacement total et voulu dans le second.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { e2eMutation } from "./functions";
import { DELETED_VIDEO_RETENTION_DAYS, hasSubmittedVideo } from "./assignmentVideo";
import { deleteStorageBestEffort } from "./storageCleanup";
import { missionAvecTexte } from "./assignmentScriptText";

const DAY_MS = 86_400_000;
/** Lignes purgées par passage : un passage reste léger, le suivant reprend. */
const PURGE_PAR_PASSAGE = 50;

/** Met en archive la vidéo d'une mission sur le point d'être supprimée (no-op sans vidéo). */
export async function archiveSubmittedVideo(ctx: MutationCtx, a: Doc<"assignments">): Promise<void> {
  if (!hasSubmittedVideo(a)) return;
  const now = Date.now();
  await ctx.db.insert("deletedSubmittedVideos", {
    projectId: a.projectId,
    assignmentId: a._id,
    creatorId: a.creatorId,
    ...(a.submittedVideoStorageId ? { storageId: a.submittedVideoStorageId } : {}),
    ...(a.submittedVideoStreamUid ? { streamUid: a.submittedVideoStreamUid } : {}),
    ...(a.submittedVideoMimeType ? { mimeType: a.submittedVideoMimeType } : {}),
    // La mission ENTIÈRE, texte du script compris (il vit hors du document) :
    // de quoi la reconstruire.
    mission: JSON.stringify(await missionAvecTexte(ctx, a)),
    deletedAt: now,
    purgeAfter: now + DELETED_VIDEO_RETENTION_DAYS * DAY_MS,
  });
}

/** Efface les FICHIERS d'une archive (Convex + Stream) — pas la ligne. */
export async function purgeDeletedVideoFiles(ctx: MutationCtx, d: Doc<"deletedSubmittedVideos">): Promise<void> {
  await deleteStorageBestEffort(ctx, d.storageId);
  if (d.streamUid) {
    await ctx.scheduler.runAfter(0, internal.cloudflareStream.deleteStreamAsset, { uid: d.streamUid });
  }
}

/** Le cron : purge les archives échues, par paquets ; se relance s'il en reste. */
export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const echues = await ctx.db
      .query("deletedSubmittedVideos")
      .withIndex("by_purgeAfter", (q) => q.lt("purgeAfter", Date.now()))
      .take(PURGE_PAR_PASSAGE);
    for (const d of echues) {
      await purgeDeletedVideoFiles(ctx, d);
      await ctx.db.delete(d._id);
    }
    if (echues.length === PURGE_PAR_PASSAGE) {
      await ctx.scheduler.runAfter(0, internal.deletedVideos.purgeExpired, {});
    }
    return { purgees: echues.length };
  },
});

/**
 * RÉCUPÉRER une vidéo : les archives d'un projet, la plus récente d'abord, avec
 * le lien du fichier et l'uid Stream. `npx convex run deletedVideos:list` (en
 * lecture), le temps qu'un écran existe.
 */
export const list = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const lignes = await ctx.db
      .query("deletedSubmittedVideos")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(100);
    return Promise.all(
      lignes.map(async (d) => ({
        assignmentId: d.assignmentId,
        creatorId: d.creatorId,
        deletedAt: d.deletedAt,
        purgeAfter: d.purgeAfter,
        streamUid: d.streamUid ?? null,
        url: d.storageId ? await ctx.storage.getUrl(d.storageId) : null,
      })),
    );
  },
});

/** E2E — l'archive d'une mission supprimée (null si aucune). */
export const e2eArchiveOf = e2eMutation({
  args: { assignmentId: v.string() },
  handler: async (ctx, { assignmentId }) => {
    const d = await ctx.db
      .query("deletedSubmittedVideos")
      .withIndex("by_assignment", (q) => q.eq("assignmentId", assignmentId))
      .unique();
    return d
      ? { streamUid: d.streamUid ?? null, hasFile: d.storageId !== undefined, purgeAfter: d.purgeAfter, deletedAt: d.deletedAt, mission: d.mission }
      : null;
  },
});
