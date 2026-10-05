/**
 * ARCHIVE DES VIDÉOS DE MISSIONS SUPPRIMÉES — cf convex/assignmentVideo.
 *
 * Supprimer une mission (bouton de l'écran, cascade d'une créatrice supprimée,
 * suppression d'un défi) n'efface plus la vidéo envoyée : la mission part, ses
 * fichiers restent, et la mission entière est gardée ici en JSON. Récupérable
 * `DELETED_VIDEO_RETENTION_DAYS` jours depuis l'écran « Vidéos supprimées »
 * (Production) — télécharger, ou RATTACHER à une autre mission de la même
 * créatrice —, puis purgée par le cron quotidien `purge-deleted-submitted-videos`.
 *
 * La purge de TEST (cleanupTestAssignments) et la suppression d'un PROJET
 * effacent toujours sur-le-champ : rien à protéger dans le premier cas, un
 * effacement total et voulu dans le second.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { creatorScopeFor, e2eMutation, permissionMutation, permissionQuery, requireCreatorInScope } from "./functions";
import { filterByCreatorScope } from "./creatorScope";
import { DELETED_VIDEO_RETENTION_DAYS, hasSubmittedVideo, refusRattachement } from "./assignmentVideo";
import { ERR, err } from "./errorCodes";
import { deleteStorageBestEffort } from "./storageCleanup";
import { missionAvecTexte } from "./assignmentScriptText";
import { poserVideoSoumise } from "./videoSubmission";

const DAY_MS = 86_400_000;
/** Lignes purgées par passage : un passage reste léger, le suivant reprend. */
const PURGE_PAR_PASSAGE = 50;
/** Lignes lues par l'écran : 30 jours de suppressions, large. */
const LIGNES_ECRAN = 200;

/** Nom de campagne (script) ou de format d'une mission — le nom INTERNE, celui de l'équipe. */
async function campagneDe(ctx: Pick<QueryCtx, "db">, a: Pick<Doc<"assignments">, "scriptCombo" | "formatId">) {
  if (a.scriptCombo) return (await ctx.db.get(a.scriptCombo.campaignId))?.name ?? null;
  if (a.formatId) return (await ctx.db.get(a.formatId))?.name ?? null;
  return null;
}

/** Les comptes cibles d'une mission (plateforme + handle), ceux qui existent encore. */
async function comptesDe(ctx: Pick<QueryCtx, "db">, a: Pick<Doc<"assignments">, "targets">) {
  const out: { platform: string; handle: string }[] = [];
  for (const t of a.targets ?? []) {
    const c = t.accountId ? await ctx.db.get(t.accountId) : null;
    if (c) out.push({ platform: c.plateforme, handle: c.handle });
  }
  return out;
}

/**
 * Met en archive la vidéo d'une mission sur le point d'être supprimée (no-op
 * sans vidéo). Ce que l'écran affiche est FIGÉ ici : la cascade d'une créatrice
 * supprimée efface aussi sa fiche et ses comptes juste après.
 */
export async function archiveSubmittedVideo(
  ctx: MutationCtx,
  a: Doc<"assignments">,
  deletedBy?: Id<"users">,
): Promise<void> {
  if (!hasSubmittedVideo(a)) return;
  const now = Date.now();
  const creator = await ctx.db.get(a.creatorId);
  const campaignName = await campagneDe(ctx, a);
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
    ...(deletedBy ? { deletedBy } : {}),
    creatorName: creator?.name ?? a.creatorNameSnapshot ?? "",
    comptes: await comptesDe(ctx, a),
    ...(campaignName ? { campaignName } : {}),
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

/** La mission archivée (JSON) — ce qu'il en faut à l'écran. */
type MissionArchivee = Pick<Doc<"assignments">, "status" | "postDate" | "targets" | "scriptCombo" | "formatId"> & {
  submittedVideoStreamStatus?: Doc<"assignments">["submittedVideoStreamStatus"];
  creatorNameSnapshot?: string;
};

/**
 * L'écran « Vidéos supprimées » : les archives du projet encore récupérables, la
 * plus récente d'abord — dans le périmètre de la personne (ses créatrices).
 */
export const listDeletedVideos = permissionQuery("assignments.manage")({
  args: {},
  handler: async (ctx) => {
    const lignes = filterByCreatorScope(
      await ctx.db
        .query("deletedSubmittedVideos")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .order("desc")
        .take(LIGNES_ECRAN),
      (d) => d.creatorId,
      await creatorScopeFor(ctx, ctx.userId, ctx.projectId),
    ).filter((d) => d.reattachedTo === undefined);
    return Promise.all(
      lignes.map(async (d) => {
        const m = JSON.parse(d.mission) as MissionArchivee;
        // Archive d'avant les champs figés : relue en direct (ce qui existe encore).
        const creatorName =
          d.creatorName ??
          (await ctx.db.get(d.creatorId as Id<"creators">))?.name ??
          m.creatorNameSnapshot ??
          null;
        const auteur = d.deletedBy ? await ctx.db.get(d.deletedBy) : null;
        return {
          _id: d._id,
          assignmentId: d.assignmentId,
          creatorName,
          comptes: d.comptes ?? (await comptesDe(ctx, m)),
          campaignName: d.campaignName ?? (await campagneDe(ctx, m)),
          postDate: m.postDate ?? null,
          statusAtDeletion: m.status,
          deletedAt: d.deletedAt,
          deletedByName: auteur?.name?.trim() || auteur?.email || null,
          purgeAfter: d.purgeAfter,
          storageId: d.storageId ?? null,
          url: d.storageId ? await ctx.storage.getUrl(d.storageId) : null,
          mimeType: d.mimeType ?? null,
          streamUid: d.streamUid ?? null,
          streamStatus: m.submittedVideoStreamStatus ?? null,
        };
      }),
    );
  },
});

/** L'archive du projet, encore à rattacher — sinon le refus qui le dit. */
async function archiveRattachable(ctx: Pick<QueryCtx, "db"> & { projectId: Id<"projects"> }, id: Id<"deletedSubmittedVideos">) {
  const d = await ctx.db.get(id);
  if (!d || d.projectId !== ctx.projectId || d.reattachedTo !== undefined) {
    throw err(ERR.DELETED_VIDEO_NOT_FOUND, "Cette vidéo n'est plus dans les vidéos supprimées.");
  }
  return d;
}

/**
 * RATTACHER — les missions de la même créatrice qui peuvent recevoir la vidéo
 * (rien d'envoyé, « à faire » ou « en cours »), et de quoi expliquer pourquoi il
 * n'y en a pas : fichier d'origine absent, créatrice supprimée, ou ses missions
 * toutes déjà envoyées / terminées (comptées par raison).
 */
export const attachOptions = permissionQuery("assignments.manage")({
  args: { id: v.id("deletedSubmittedVideos") },
  handler: async (ctx, { id }) => {
    const d = await archiveRattachable(ctx, id);
    const creatorId = ctx.db.normalizeId("creators", d.creatorId);
    await requireCreatorInScope(ctx, ctx.userId, ctx.projectId, creatorId);
    if (!d.storageId) return { blocage: "fichier_absent" as const, missions: [], dejaUneVideo: 0, terminees: 0 };
    const creator = creatorId ? await ctx.db.get(creatorId) : null;
    if (!creator) return { blocage: "createatrice_absente" as const, missions: [], dejaUneVideo: 0, terminees: 0 };
    const siennes = (
      await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
        .collect()
    ).filter((a) => a.projectId === ctx.projectId);
    const missions = [];
    let dejaUneVideo = 0;
    let terminees = 0;
    for (const a of siennes) {
      const refus = refusRattachement(d, a);
      if (refus === "deja_une_video") dejaUneVideo++;
      else if (refus !== null) terminees++;
      else {
        missions.push({
          _id: a._id,
          campaignName: await campagneDe(ctx, a),
          postDate: a.postDate ?? null,
          dueDate: a.dueDate,
          status: a.status,
        });
      }
    }
    missions.sort((x, y) => (x.postDate ?? x.dueDate) - (y.postDate ?? y.dueDate));
    return { blocage: null, missions, dejaUneVideo, terminees };
  },
});

/**
 * Rattache la vidéo archivée à une mission de la même créatrice : elle y entre
 * comme si la créatrice venait de l'envoyer (`poserVideoSoumise`, le cœur de la
 * soumission) — « vidéo envoyée », en file de Validation, nouvelle copie Stream.
 * Sans la notification Telegram de soumission : c'est l'équipe qui fait le geste.
 *
 * L'archive garde la mission supprimée (JSON) jusqu'à sa purge, mais ne
 * référence PLUS le fichier : la purge à 30 jours ne peut pas effacer une vidéo
 * rattachée.
 */
export const attachToMission = permissionMutation("assignments.manage")({
  args: { id: v.id("deletedSubmittedVideos"), assignmentId: v.id("assignments") },
  handler: async (ctx, { id, assignmentId }) => {
    const d = await archiveRattachable(ctx, id);
    const m = await ctx.db.get(assignmentId);
    if (!m || m.projectId !== ctx.projectId) {
      throw err(ERR.ASSIGNMENT_NOT_FOUND, "Assignment introuvable.");
    }
    await requireCreatorInScope(ctx, ctx.userId, ctx.projectId, m.creatorId);
    switch (refusRattachement(d, m)) {
      case "fichier_absent":
        throw err(ERR.DELETED_VIDEO_NO_FILE, "Le fichier d'origine de cette vidéo n'existe plus.");
      case "autre_createatrice":
        throw err(ERR.DELETED_VIDEO_OTHER_CREATOR, "Cette mission est celle d'une autre créatrice.");
      case "deja_une_video":
        throw err(ERR.DELETED_VIDEO_TARGET_HAS_VIDEO, "Cette mission a déjà une vidéo envoyée.");
      case "statut":
        throw err(ERR.DELETED_VIDEO_TARGET_STATUS, "Cette mission n'attend plus de vidéo.");
      case null:
        break;
    }
    await poserVideoSoumise(ctx, m, d.storageId!, d.mimeType);
    // La nouvelle copie Stream (planifiée ci-dessus) remplace celle de l'archive.
    if (d.streamUid) {
      await ctx.scheduler.runAfter(0, internal.cloudflareStream.deleteStreamAsset, { uid: d.streamUid });
    }
    await ctx.db.patch(d._id, {
      storageId: undefined,
      streamUid: undefined,
      reattachedTo: m._id,
      reattachedAt: Date.now(),
      reattachedBy: ctx.userId,
    });
    return { ok: true as const };
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
      ? {
          _id: d._id,
          streamUid: d.streamUid ?? null,
          hasFile: d.storageId !== undefined,
          purgeAfter: d.purgeAfter,
          deletedAt: d.deletedAt,
          deletedBy: d.deletedBy ?? null,
          reattachedTo: d.reattachedTo ?? null,
          mission: d.mission,
        }
      : null;
  },
});
