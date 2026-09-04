import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  e2eMutation,
  permissionMutation,
} from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { extractYouTubeId, fetchYouTubeViews } from "./youtubeApi";
import { recomputeLatestMetrics } from "./metricSnapshots";
import { syncBonusForPublication } from "./pricing";
import { TRACKING_WINDOW_DAYS } from "./syncScope";

/**
 * S — Tracking AUTO des vues YouTube. Un cron quotidien (convex/crons.ts) relève
 * les vues de tous les posts YouTube ACTIFS via l'API Data v3 (convex/youtubeApi)
 * et écrit un snapshot/jour/publication dans metricSnapshots. TikTok/Insta NE
 * sont PAS concernés (pas d'API simple) → saisie manuelle, flux inchangé.
 *
 * Tout est interne/admin : le cron tourne sans identité (internalAction), le
 * déclenchement manuel est gated admin (requestYouTubeSync). Aucune clé API ni
 * détail de sync ne fuit côté créateur (qui ne voit que SES vues, déjà géré).
 *
 * ⚠️ TS7022 — runDailySync appelle ctx.runQuery/runMutation(internal.*) : son
 * type de retour est ANNOTÉ (YouTubeSyncSummary) pour casser le cycle d'inférence.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * « Publication active » = publiée (postUrl) ET datePubli < N jours. Au-delà de
 * N, on arrête de tracker pour ne pas gonfler le quota inutilement (les vues
 * d'une vidéo de plus de 3 mois ne bougent quasiment plus, et les fenêtres
 * analytics vont jusqu'à J+90). N = 90 jours, défini une seule fois dans
 * `convex/syncScope.ts` et partagé avec le relevé Apify.
 *
 * ⚠️ Distinct du périmètre du relevé NOCTURNE, qui restreint en plus aux
 * COMPTES actifs (30 j) : ici c'est la vidéo qui sort du tracking, là c'est le
 * compte qui ne mérite plus un run.
 */
const ACTIVE_WINDOW_DAYS = TRACKING_WINDOW_DAYS;

export interface YouTubeSyncSummary {
  ok: boolean;
  /** Raison de l'arrêt précoce (ex. clé absente). */
  reason?: string;
  /** Publications YouTube actives scannées. */
  scanned: number;
  /** Publications dont l'URL a donné un videoId valide. */
  matched: number;
  /** Snapshots écrits (insérés ou mis à jour). */
  synced: number;
  /** Vidéos indisponibles (supprimées/privées). */
  unavailable: number;
  /** Lots API en erreur (non bloquant). */
  errors: number;
}

/**
 * Upsert IDEMPOTENT du snapshot YouTube du JOUR pour une publication. Si un
 * snapshot `source: "youtube"` existe déjà aujourd'hui (même jour UTC) pour
 * cette publication, on le MET À JOUR (relevé plus frais) au lieu d'en créer un
 * second → relancer la sync le même jour ne duplique pas. Maintient
 * `vuesLatest` (recomputeLatestMetrics) + l'indicateur `lastYouTubeSyncAt`.
 *
 * Partagé par recordYouTubeSnapshot (cron) et e2eRecordYouTubeSnapshot (test).
 */
async function upsertYouTubeSnapshot(
  ctx: MutationCtx,
  args: {
    publicationId: Id<"publications">;
    vues: number;
    likes: number | null;
    comments: number | null;
    title?: string | null;
    capturedAt: number;
  },
): Promise<{ action: "inserted" | "updated" | "skipped" }> {
  const pub = await ctx.db.get(args.publicationId);
  if (!pub) return { action: "skipped" };
  // Invariant metricSnapshots : capturedAt jamais antérieur à la publication.
  if (args.capturedAt < pub.datePubli) return { action: "skipped" };

  const dayStart = Math.floor(args.capturedAt / DAY_MS) * DAY_MS;
  const dayEnd = dayStart + DAY_MS;
  const todays = await ctx.db
    .query("metricSnapshots")
    .withIndex("by_publication_and_capturedAt", (q) =>
      q
        .eq("publicationId", args.publicationId)
        .gte("capturedAt", dayStart)
        .lt("capturedAt", dayEnd),
    )
    .collect();
  const existing = todays.find((s) => s.source === "youtube");

  const daysSincePublication = Math.floor(
    (args.capturedAt - pub.datePubli) / DAY_MS,
  );
  // likeCount masqué → on conserve le dernier like connu plutôt que d'écraser à 0.
  const likes = args.likes ?? pub.likesLatest ?? 0;
  // Commentaires : MÊME règle que likes (préserve le dernier connu si non fourni).
  const comments = args.comments ?? pub.commentsLatest ?? 0;
  // Patch publication : indicateur de sync + titre (snippet.title) si capturé.
  const pubPatch: { lastYouTubeSyncAt: number; postTitle?: string } = {
    lastYouTubeSyncAt: args.capturedAt,
  };
  if (typeof args.title === "string" && args.title.length > 0) {
    pubPatch.postTitle = args.title;
  }

  if (existing) {
    await ctx.db.patch(existing._id, {
      vues: args.vues,
      likes,
      comments,
      capturedAt: args.capturedAt,
      daysSincePublication,
    });
    await recomputeLatestMetrics(ctx, args.publicationId);
    await syncBonusForPublication(ctx, args.publicationId);
    await ctx.db.patch(args.publicationId, pubPatch);
    return { action: "updated" };
  }

  await ctx.db.insert("metricSnapshots", {
    projectId: pub.projectId,
    publicationId: args.publicationId,
    capturedAt: args.capturedAt,
    daysSincePublication,
    vues: args.vues,
    likes,
    comments,
    createdAt: Date.now(),
    source: "youtube",
  });
  await recomputeLatestMetrics(ctx, args.publicationId);
  await syncBonusForPublication(ctx, args.publicationId);
  await ctx.db.patch(args.publicationId, pubPatch);
  return { action: "inserted" };
}

/**
 * Publications YouTube actives (publiées + < ACTIVE_WINDOW_DAYS). `cutoff` est
 * passé par l'appelant (une query ne peut pas appeler Date.now()). `projectId`
 * optionnel : absent (cron) = tous les projets ; présent (sync manuelle) =
 * scopé à ce projet.
 *
 * Rend aussi `compte`, `projectId` et `lastSyncAt` (= `latestSnapshotAt`,
 * dernier snapshot toutes sources) : de quoi appliquer la politique du relevé
 * NOCTURNE sans deuxième scan, cf `convex/syncScope.ts`. Le chemin MANUEL
 * ignore ces champs.
 */
export const listActiveYouTubePublications = internalQuery({
  args: { cutoff: v.number(), projectId: v.optional(v.id("projects")) },
  handler: async (
    ctx,
    { cutoff, projectId },
  ): Promise<
    {
      _id: Id<"publications">;
      postUrl: string;
      compte: string;
      projectId: Id<"projects">;
      datePubli: number;
      lastSyncAt?: number;
    }[]
  > => {
    const pubs = projectId
      ? await ctx.db
          .query("publications")
          .withIndex("by_project_plateforme", (q) =>
            q.eq("projectId", projectId).eq("plateforme", "YouTube"),
          )
          .collect()
      : await ctx.db
          .query("publications")
          .withIndex("by_plateforme", (q) => q.eq("plateforme", "YouTube"))
          .collect();
    return pubs
      .filter(
        (p) =>
          typeof p.postUrl === "string" &&
          p.postUrl.length > 0 &&
          p.datePubli >= cutoff,
      )
      .map((p) => ({
        _id: p._id,
        postUrl: p.postUrl as string,
        compte: p.compte,
        projectId: p.projectId,
        datePubli: p.datePubli,
        lastSyncAt: p.latestSnapshotAt,
      }));
  },
});

/** Écrit (upsert idempotent) le snapshot YouTube du jour. Appelé par le cron. */
export const recordYouTubeSnapshot = internalMutation({
  args: {
    publicationId: v.id("publications"),
    vues: v.number(),
    likes: v.union(v.number(), v.null()),
    comments: v.union(v.number(), v.null()),
    title: v.optional(v.string()),
    capturedAt: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ action: "inserted" | "updated" | "skipped" }> =>
    upsertYouTubeSnapshot(ctx, args),
});

/**
 * Cœur du relevé. `projectId` absent = tous les projets (cron) ; présent =
 * scopé (sync manuelle d'un admin). Si YOUTUBE_API_KEY est absente du
 * deployment, log clair + rejet PROPRE (pas d'exception). Un lot API en erreur
 * n'empêche pas les autres ; une vidéo indisponible est ignorée sans crash.
 */
export const runDailySync = internalAction({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }): Promise<YouTubeSyncSummary> => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error(
        "[youtube-sync] YOUTUBE_API_KEY absente — relevé annulé. " +
          "Posez la clé : npx convex env set YOUTUBE_API_KEY <clé>.",
      );
      return {
        ok: false,
        reason: "missing-api-key",
        scanned: 0,
        matched: 0,
        synced: 0,
        unavailable: 0,
        errors: 0,
      };
    }

    const now = Date.now();
    const cutoff = now - ACTIVE_WINDOW_DAYS * DAY_MS;
    const pubs = await ctx.runQuery(
      internal.youtubeSync.listActiveYouTubePublications,
      projectId ? { cutoff, projectId } : { cutoff },
    );

    const targets: { publicationId: Id<"publications">; videoId: string }[] = [];
    for (const p of pubs) {
      const videoId = extractYouTubeId(p.postUrl);
      if (videoId) targets.push({ publicationId: p._id, videoId });
    }
    const uniqueIds = [...new Set(targets.map((t) => t.videoId))];
    if (uniqueIds.length === 0) {
      console.info("[youtube-sync] Aucune vidéo YouTube active à relever.");
      return {
        ok: true,
        scanned: pubs.length,
        matched: 0,
        synced: 0,
        unavailable: 0,
        errors: 0,
      };
    }

    const { stats, unavailable, errors } = await fetchYouTubeViews(
      uniqueIds,
      apiKey,
    );

    let synced = 0;
    for (const t of targets) {
      const stat = stats[t.videoId];
      if (!stat) continue; // indisponible ou lot en erreur → pas de snapshot
      const r = await ctx.runMutation(
        internal.youtubeSync.recordYouTubeSnapshot,
        {
          publicationId: t.publicationId,
          vues: stat.views,
          likes: stat.likes,
          comments: stat.comments,
          title: stat.title ?? undefined,
          capturedAt: now,
        },
      );
      if (r.action !== "skipped") synced += 1;
    }

    if (errors.length > 0) {
      console.error(`[youtube-sync] ${errors.length} lot(s) en erreur:`, errors);
    }
    if (unavailable.length > 0) {
      console.warn(
        `[youtube-sync] ${unavailable.length} vidéo(s) indisponible(s) (supprimée/privée).`,
      );
    }
    console.info(
      `[youtube-sync] OK — ${pubs.length} pub(s) active(s), ${targets.length} videoId, ${synced} snapshot(s).`,
    );

    return {
      ok: true,
      scanned: pubs.length,
      matched: targets.length,
      synced,
      unavailable: unavailable.length,
      errors: errors.length,
    };
  },
});

/**
 * Déclenchement MANUEL (admin) — « Synchroniser les vues YouTube maintenant ».
 * Planifie le même relevé, SCOPÉ au projet de l'admin (ctx.projectId), sans
 * attendre 8h. Asynchrone : les snapshots apparaissent dans la seconde
 * (réactivité Convex). Gated adminMutation → le créateur est rejeté.
 *
 * ⚠️ TS7022 — référence internal.youtubeSync.runDailySync via le scheduler :
 * type de retour annoté.
 */
export const requestYouTubeSync = permissionMutation("tracker.manage")({
  args: {},
  handler: async (ctx): Promise<{ scheduled: true }> => {
    await ctx.scheduler.runAfter(0, internal.youtubeSync.runDailySync, {
      projectId: ctx.projectId,
    });
    return { scheduled: true };
  },
});

/**
 * Test e2e — exerce l'upsert idempotent réel SANS dépendre de l'API (pas de clé
 * requise sur le deployment de test). Gated par le secret e2e.
 */
export const e2eRecordYouTubeSnapshot = e2eMutation({
  args: {
    publicationId: v.id("publications"),
    vues: v.number(),
    capturedAt: v.number(),
    likes: v.optional(v.union(v.number(), v.null())),
    comments: v.optional(v.union(v.number(), v.null())),
    title: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ action: "inserted" | "updated" | "skipped" }> =>
    upsertYouTubeSnapshot(ctx, {
      publicationId: args.publicationId,
      vues: args.vues,
      likes: args.likes ?? null,
      comments: args.comments ?? null,
      title: args.title,
      capturedAt: args.capturedAt,
    }),
});
