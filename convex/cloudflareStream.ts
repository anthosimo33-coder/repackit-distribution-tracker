import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  cloudflareStreamConfig,
  copyVideoToStream,
  fetchStreamStatus,
  deleteStreamVideo,
  type StreamStatus,
} from "./cloudflareStreamApi";

/**
 * Orchestration Cloudflare Stream — transcoding HEVC de la vidéo SOUMISE.
 *
 * FLUX (hors chemin critique, comme convex/inspirationThumbnails.ts) :
 *   submitVideo (mutation) → scheduler.runAfter(0, startStreamCopy)
 *     → copy from URL (URL signée Convex) → setStreamFields(uid, "processing")
 *     → scheduler poll pollStreamStatus
 *   pollStreamStatus → fetchStreamStatus(uid) → ready/error (terminal) OU
 *     re-planifie tant que "processing" (borné par MAX_POLL_ATTEMPTS).
 *   La RÉACTIVITÉ Convex pousse l'état "ready" à l'écran Validation déjà ouvert :
 *     listVideoSubmitted re-tourne, le player Stream remplace le message
 *     « Transcoding en cours ». Pas de polling client.
 *
 * GATE : sans env Cloudflare (cloudflareStreamConfig() === null), startStreamCopy
 *   log + no-op → la soumission garde juste son blob Convex → l'UI retombe sur le
 *   <video> + bouton télécharger (#56). JAMAIS de crash, JAMAIS de blocage.
 *
 * ⚠️ TS7022 — startStreamCopy / pollStreamStatus / migrateSubmittedVideosToStream
 *   appellent ctx.runQuery/runMutation/runAction(internal.*) (et pollStreamStatus
 *   se re-planifie lui-même) : type de retour ANNOTÉ pour casser l'inférence
 *   cyclique. NE PAS retirer les annotations.
 */

/** Délai avant le 1er relevé d'état (laisse Cloudflare démarrer le transcoding). */
const POLL_INITIAL_DELAY_MS = 8_000;
/** Intervalle entre deux relevés tant que "processing". */
const POLL_INTERVAL_MS = 8_000;
/** Borne anti-boucle : ~5 min de transcoding pour une vidéo de validation. */
const MAX_POLL_ATTEMPTS = 40;

/** Migration : taille de lot, plafond, concurrence (Cloudflare est payant). */
const MIGRATE_BATCH = 25;
const MIGRATE_MAX_ROWS = 1000;
const MIGRATE_CONCURRENCY = 3;

// ─── Lecture/écriture internes (runtime query/mutation) ──────────────────────

interface StreamSource {
  storageId: Id<"_storage">;
  url: string;
  name: string;
}

/**
 * Source de copie d'une soumission : URL SIGNÉE Convex du blob + un nom lisible
 * (meta Cloudflare). null si l'assignment n'a pas (ou plus) de vidéo soumise, ou
 * si l'URL signée n'a pas pu être résolue.
 */
export const getStreamSource = internalQuery({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }): Promise<StreamSource | null> => {
    const a = await ctx.db.get(assignmentId);
    if (!a || !a.submittedVideoStorageId) return null;
    const url = await ctx.storage.getUrl(a.submittedVideoStorageId);
    if (!url) return null;
    const creator = await ctx.db.get(a.creatorId);
    const name = `${creator?.name ?? "créateur"} — ${assignmentId}`;
    return { storageId: a.submittedVideoStorageId, url, name };
  },
});

/**
 * Pose UID + état Stream sur la soumission. GUARD : ne patche QUE si le blob
 * Convex courant est toujours `expectedStorageId` — sinon une nouvelle
 * soumission a remplacé l'ancienne entre-temps, on ne doit pas écraser ses
 * champs Stream avec ceux d'une copie périmée. Renvoie true si patché.
 */
export const setStreamFields = internalMutation({
  args: {
    assignmentId: v.id("assignments"),
    expectedStorageId: v.id("_storage"),
    uid: v.string(),
    status: v.union(
      v.literal("processing"),
      v.literal("ready"),
      v.literal("error"),
    ),
  },
  handler: async (
    ctx,
    { assignmentId, expectedStorageId, uid, status },
  ): Promise<boolean> => {
    const a = await ctx.db.get(assignmentId);
    if (!a || a.submittedVideoStorageId !== expectedStorageId) return false;
    await ctx.db.patch(assignmentId, {
      submittedVideoStreamUid: uid,
      submittedVideoStreamStatus: status,
    });
    return true;
  },
});

/**
 * Met à jour l'état du transcoding. GUARD : ne patche QUE si le UID courant est
 * toujours celui qu'on relève (sinon copie périmée). Renvoie true si patché.
 */
export const setStreamStatus = internalMutation({
  args: {
    assignmentId: v.id("assignments"),
    uid: v.string(),
    status: v.union(
      v.literal("processing"),
      v.literal("ready"),
      v.literal("error"),
    ),
  },
  handler: async (ctx, { assignmentId, uid, status }): Promise<boolean> => {
    const a = await ctx.db.get(assignmentId);
    if (!a || a.submittedVideoStreamUid !== uid) return false;
    await ctx.db.patch(assignmentId, { submittedVideoStreamStatus: status });
    return true;
  },
});

/**
 * Candidats migration : soumissions AVEC un blob Convex MAIS sans UID Stream.
 * Tous projets confondus (admin one-shot). L'idempotence vit ICI : une fois le
 * UID posé, la row sort de la query → jamais ré-uploadée.
 */
export const listSubmissionsNeedingStream = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }): Promise<Id<"assignments">[]> => {
    const rows = await ctx.db.query("assignments").collect();
    const out: Id<"assignments">[] = [];
    for (const a of rows) {
      if (!a.submittedVideoStorageId) continue;
      if (a.submittedVideoStreamUid) continue;
      out.push(a._id);
      if (out.length >= limit) break;
    }
    return out;
  },
});

/** Soumissions encore "processing" (filet de réconciliation). */
export const listProcessingStreams = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ assignmentId: Id<"assignments">; uid: string }[]> => {
    const rows = await ctx.db.query("assignments").collect();
    const out: { assignmentId: Id<"assignments">; uid: string }[] = [];
    for (const a of rows) {
      if (
        a.submittedVideoStreamStatus === "processing" &&
        a.submittedVideoStreamUid
      ) {
        out.push({ assignmentId: a._id, uid: a.submittedVideoStreamUid });
      }
    }
    return out;
  },
});

// ─── Actions (runtime action — fetch + scheduler) ────────────────────────────

interface StartCopyResult {
  ok: boolean;
  reason?: "disabled" | "no-source" | "copy-failed";
  uid?: string;
  status?: StreamStatus;
}

/**
 * Lance la copie d'UNE soumission vers Cloudflare Stream. Idempotent à l'échelle
 * d'un blob (le guard setStreamFields). Sans env → no-op propre (fallback).
 */
export const startStreamCopy = internalAction({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }): Promise<StartCopyResult> => {
    const config = cloudflareStreamConfig();
    if (!config) {
      console.info(
        "[cloudflare-stream] env absent (CLOUDFLARE_ACCOUNT_ID / " +
          "CLOUDFLARE_STREAM_API_TOKEN) — transcoding ignoré, fallback Convex. " +
          "Posez-les : npx convex env set CLOUDFLARE_ACCOUNT_ID <id> ; " +
          "npx convex env set CLOUDFLARE_STREAM_API_TOKEN <token>.",
      );
      return { ok: false, reason: "disabled" };
    }

    const source = await ctx.runQuery(internal.cloudflareStream.getStreamSource, {
      assignmentId,
    });
    if (!source) {
      console.info(
        `[cloudflare-stream] pas de source pour ${assignmentId} (vidéo absente ou URL non résolue) — ignoré.`,
      );
      return { ok: false, reason: "no-source" };
    }

    let video;
    try {
      video = await copyVideoToStream(config, source.url, source.name);
    } catch (e) {
      console.error(
        `[cloudflare-stream] copy échouée pour ${assignmentId}: ${
          e instanceof Error ? e.message : String(e)
        } — fallback Convex.`,
      );
      return { ok: false, reason: "copy-failed" };
    }

    const patched = await ctx.runMutation(
      internal.cloudflareStream.setStreamFields,
      {
        assignmentId,
        expectedStorageId: source.storageId,
        uid: video.uid,
        status: video.status,
      },
    );

    // Soumission remplacée entre-temps → on a créé une copie Stream désormais
    // orpheline : on la supprime (best-effort) pour ne pas la payer.
    if (!patched) {
      await ctx.scheduler.runAfter(0, internal.cloudflareStream.deleteStreamAsset, {
        uid: video.uid,
      });
      return { ok: false, reason: "no-source", uid: video.uid };
    }

    if (video.status === "processing") {
      await ctx.scheduler.runAfter(
        POLL_INITIAL_DELAY_MS,
        internal.cloudflareStream.pollStreamStatus,
        { assignmentId, uid: video.uid, attempt: 1 },
      );
    }
    return { ok: true, uid: video.uid, status: video.status };
  },
});

interface PollResult {
  status: StreamStatus;
  attempts: number;
}

/**
 * Relève l'état d'un transcoding et se RE-PLANIFIE tant que "processing" (borné).
 * Le guard setStreamStatus évite d'écraser l'état d'une soumission plus récente.
 */
export const pollStreamStatus = internalAction({
  args: {
    assignmentId: v.id("assignments"),
    uid: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, { assignmentId, uid, attempt }): Promise<PollResult> => {
    const config = cloudflareStreamConfig();
    if (!config) return { status: "processing", attempts: attempt };

    let status: StreamStatus;
    try {
      status = await fetchStreamStatus(config, uid);
    } catch (e) {
      console.error(
        `[cloudflare-stream] relevé d'état échoué pour ${uid}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      status = "processing"; // erreur transitoire → on retentera
    }

    if (status !== "processing") {
      await ctx.runMutation(internal.cloudflareStream.setStreamStatus, {
        assignmentId,
        uid,
        status,
      });
      return { status, attempts: attempt };
    }

    if (attempt < MAX_POLL_ATTEMPTS) {
      await ctx.scheduler.runAfter(
        POLL_INTERVAL_MS,
        internal.cloudflareStream.pollStreamStatus,
        { assignmentId, uid, attempt: attempt + 1 },
      );
    } else {
      console.warn(
        `[cloudflare-stream] ${uid} toujours "processing" après ${attempt} relevés — abandon du polling (réconciliable plus tard).`,
      );
    }
    return { status, attempts: attempt };
  },
});

/** Supprime une vidéo Stream (best-effort : un échec est logué, jamais relancé). */
export const deleteStreamAsset = internalAction({
  args: { uid: v.string() },
  handler: async (ctx, { uid }): Promise<{ ok: boolean }> => {
    void ctx;
    const config = cloudflareStreamConfig();
    if (!config) return { ok: false };
    try {
      await deleteStreamVideo(config, uid);
      return { ok: true };
    } catch (e) {
      console.warn(
        `[cloudflare-stream] suppression de ${uid} échouée (orphelin toléré): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return { ok: false };
    }
  },
});

// ─── Migration & réconciliation (admin one-shot, runnable via convex run) ────

/**
 * MIGRATION idempotente — envoie vers Cloudflare Stream les vidéos DÉJÀ stockées
 * dans Convex (dont la soumission de Marielle en attente) qui n'ont pas encore
 * de UID. Réutilise startStreamCopy (même chemin que la nouvelle soumission :
 * copy from URL + polling). Concurrence bornée (Cloudflare payant). Après
 * transcoding, ces vidéos deviennent visionnables dans l'app via le player.
 *
 * Lancement prod :
 *   npx convex run cloudflareStream:migrateSubmittedVideosToStream --prod
 */
export const migrateSubmittedVideosToStream = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ ok: boolean; reason?: string; started: number; skipped: number }> => {
    if (!cloudflareStreamConfig()) {
      console.error(
        "[cloudflare-stream] migration annulée — env Cloudflare absent. " +
          "Posez CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_STREAM_API_TOKEN.",
      );
      return { ok: false, reason: "disabled", started: 0, skipped: 0 };
    }

    let started = 0;
    let skipped = 0;
    while (started < MIGRATE_MAX_ROWS) {
      const batch = await ctx.runQuery(
        internal.cloudflareStream.listSubmissionsNeedingStream,
        { limit: MIGRATE_BATCH },
      );
      if (batch.length === 0) break;

      for (let i = 0; i < batch.length; i += MIGRATE_CONCURRENCY) {
        const slice = batch.slice(i, i + MIGRATE_CONCURRENCY);
        const results = await Promise.all(
          slice.map((assignmentId) =>
            ctx.runAction(internal.cloudflareStream.startStreamCopy, {
              assignmentId,
            }),
          ),
        );
        for (const r of results) {
          if (r.ok) started += 1;
          else skipped += 1;
        }
      }
      // Sécurité : si AUCUN envoi n'a abouti et tout le lot a été "skip" (ex.
      // copies échouées), les rows gardent leur blob sans UID et reviendraient →
      // on s'arrête pour ne pas boucler indéfiniment sur des échecs.
      if (started === 0 && skipped >= batch.length) break;
    }

    console.info(
      `[cloudflare-stream] migration terminée — ${started} envoyée(s), ${skipped} ignorée(s).`,
    );
    return { ok: true, started, skipped };
  },
});

/**
 * RÉCONCILIATION manuelle — relance un relevé pour toute soumission restée
 * "processing" (chaîne de polling morte : redéploiement, etc.). Filet runnable :
 *   npx convex run cloudflareStream:reconcileProcessingStreams --prod
 */
export const reconcileProcessingStreams = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number }> => {
    const processing = await ctx.runQuery(
      internal.cloudflareStream.listProcessingStreams,
      {},
    );
    for (const { assignmentId, uid } of processing) {
      await ctx.scheduler.runAfter(0, internal.cloudflareStream.pollStreamStatus, {
        assignmentId,
        uid,
        attempt: 1,
      });
    }
    return { checked: processing.length };
  },
});
