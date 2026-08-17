import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { adminMutation, e2eMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  fetchApifyViewsForPlatform,
  tiktokPostId,
  instagramShortcode,
  type ApifyPlatform,
} from "./apifyApi";
import { recomputeLatestMetrics } from "./metricSnapshots";
import { TRACKING_WINDOW_DAYS } from "./syncScope";
import { syncBonusForPublication } from "./pricing";

/**
 * S — Tracking AUTO des vues TikTok/Instagram via Apify. CALQUÉ sur le tracking
 * YouTube (convex/youtubeSync.ts) : un cron quotidien (convex/crons.ts) relève
 * les vues de tous les posts TikTok/Insta ACTIFS via Apify (convex/apifyApi) et
 * écrit un snapshot/jour/publication dans metricSnapshots → CPM, cumul et paliers
 * s'alimentent EXACTEMENT comme pour YouTube (recompute + syncBonus).
 *
 * Tout est interne/admin : le cron tourne sans identité (internalAction), le
 * déclenchement manuel est gated admin (requestApifySync). Aucun token Apify ne
 * fuit côté créateur.
 *
 * SANS APIFY_API_TOKEN → désactivation PROPRE (log + skip, pas de crash), comme
 * le fallback YouTube sans clé.
 *
 * ⚠️ TS7022 — runDailySync appelle ctx.runQuery/runMutation(internal.*) : type
 * de retour ANNOTÉ (ApifySyncSummary) pour casser le cycle d'inférence.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fenêtre de tracking partagée avec YouTube — définition unique dans
 *  convex/syncScope.ts (plus deux constantes « à garder synchrones »). */
const ACTIVE_WINDOW_DAYS = TRACKING_WINDOW_DAYS;

/** Plateformes Apify + la `source` du snapshot correspondant. */
const APIFY_PLATFORMS: { plateforme: ApifyPlatform; source: ApifySource }[] = [
  { plateforme: "TikTok", source: "tiktok" },
  { plateforme: "Instagram", source: "instagram" },
];

type ApifySource = "tiktok" | "instagram";

const apifySourceValidator = v.union(
  v.literal("tiktok"),
  v.literal("instagram"),
);

export interface ApifySyncSummary {
  ok: boolean;
  /** Raison de l'arrêt précoce (ex. token absent). */
  reason?: string;
  /** Publications TikTok/Insta actives scannées (toutes plateformes). */
  scanned: number;
  /** Publications dont l'URL a donné une clé de post valide. */
  matched: number;
  /** Snapshots écrits (insérés ou mis à jour). */
  synced: number;
  /** Posts indisponibles (privés/supprimés/image Insta sans vues). */
  unavailable: number;
  /** Lots Apify en erreur (non bloquant). */
  errors: number;
  /** Runs Apify lancés (≈ unité de coût). */
  runs: number;
}

/**
 * Upsert IDEMPOTENT du snapshot Apify du JOUR pour une publication. Si un
 * snapshot de MÊME `source` (tiktok/instagram) existe déjà aujourd'hui (même jour
 * UTC) pour cette publication, on le MET À JOUR au lieu d'en créer un second →
 * relancer la sync le même jour ne duplique pas. Maintient `vuesLatest`
 * (recomputeLatestMetrics), les paliers de bonus (syncBonusForPublication) et
 * l'indicateur `lastApifySyncAt`. Même mécanisme d'écriture que YouTube.
 *
 * Likes : on écrit le like Apify (diggCount TikTok / likesCount Instagram) quand
 * il est fourni ; sinon on PRÉSERVE le dernier like connu (likesLatest) plutôt
 * que d'écraser à 0 (comme YouTube quand likeCount est masqué).
 *
 * Titre : si fourni (légende du post), patché sur la publication (postTitle) —
 * propriété du post, pas une série temporelle, donc hors snapshot.
 *
 * Partagé par recordApifySnapshot (cron) et e2eRecordApifySnapshot (test).
 */
async function upsertApifySnapshot(
  ctx: MutationCtx,
  args: {
    publicationId: Id<"publications">;
    vues: number;
    likes?: number | null;
    comments?: number | null;
    title?: string | null;
    capturedAt: number;
    source: ApifySource;
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
  const existing = todays.find((s) => s.source === args.source);

  const daysSincePublication = Math.floor(
    (args.capturedAt - pub.datePubli) / DAY_MS,
  );
  // Like Apify s'il est fourni, sinon dernier like connu (jamais d'écrasement à 0).
  const likes = args.likes ?? pub.likesLatest ?? 0;
  // Commentaires : MÊME règle que likes (préserve le dernier connu si non fourni).
  const comments = args.comments ?? pub.commentsLatest ?? 0;
  // Patch publication : indicateur de sync + titre (légende) si capturé.
  const pubPatch: { lastApifySyncAt: number; postTitle?: string } = {
    lastApifySyncAt: args.capturedAt,
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
    source: args.source,
  });
  await recomputeLatestMetrics(ctx, args.publicationId);
  await syncBonusForPublication(ctx, args.publicationId);
  await ctx.db.patch(args.publicationId, pubPatch);
  return { action: "inserted" };
}

/**
 * Publications actives (publiées + < ACTIVE_WINDOW_DAYS) d'UNE plateforme
 * (TikTok ou Instagram). `cutoff` passé par l'appelant (une query ne peut pas
 * appeler Date.now()). `projectId` optionnel : absent (cron) = tous les projets ;
 * présent (sync manuelle) = scopé.
 *
 * Rend aussi `compte`, `projectId` et `lastSyncAt` — de quoi appliquer la
 * politique du relevé NOCTURNE (comptes actifs, garde des 2 h, imputation des
 * échecs par projet, cf `convex/syncScope.ts`) sans deuxième scan. Le chemin
 * MANUEL ignore simplement ces champs : son périmètre reste inchangé.
 *
 * `lastSyncAt` = `latestSnapshotAt` (dernier snapshot TOUTES sources) et non
 * `lastApifySyncAt` : c'est le signal « il existe déjà un point de mesure
 * frais », qui est ce que la garde des 2 h veut vraiment savoir, et il vaut pour
 * YouTube comme pour Apify.
 */
export const listActiveApifyPublications = internalQuery({
  args: {
    cutoff: v.number(),
    plateforme: v.union(v.literal("TikTok"), v.literal("Instagram")),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (
    ctx,
    { cutoff, plateforme, projectId },
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
            q.eq("projectId", projectId).eq("plateforme", plateforme),
          )
          .collect()
      : await ctx.db
          .query("publications")
          .withIndex("by_plateforme", (q) => q.eq("plateforme", plateforme))
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

/** Écrit (upsert idempotent) le snapshot Apify du jour. Appelé par le cron. */
export const recordApifySnapshot = internalMutation({
  args: {
    publicationId: v.id("publications"),
    vues: v.number(),
    likes: v.union(v.number(), v.null()),
    comments: v.union(v.number(), v.null()),
    title: v.optional(v.string()),
    capturedAt: v.number(),
    source: apifySourceValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ action: "inserted" | "updated" | "skipped" }> =>
    upsertApifySnapshot(ctx, args),
});

/**
 * Cœur du relevé Apify. `projectId` absent = tous les projets (cron) ; présent =
 * scopé (sync manuelle d'un admin). Si APIFY_API_TOKEN est absent du deployment,
 * log clair + rejet PROPRE (pas d'exception). Un lot Apify en erreur n'empêche
 * pas les autres ; un post indisponible (privé/supprimé/image Insta) est ignoré
 * sans crash. Traite TikTok puis Instagram (1 run par lot par plateforme).
 */
export const runDailySync = internalAction({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }): Promise<ApifySyncSummary> => {
    const apiToken = process.env.APIFY_API_TOKEN;
    if (!apiToken) {
      console.error(
        "[apify-sync] APIFY_API_TOKEN absent — relevé TikTok/Insta annulé. " +
          "Posez le token : npx convex env set APIFY_API_TOKEN <token>.",
      );
      return {
        ok: false,
        reason: "missing-api-token",
        scanned: 0,
        matched: 0,
        synced: 0,
        unavailable: 0,
        errors: 0,
        runs: 0,
      };
    }

    const now = Date.now();
    const cutoff = now - ACTIVE_WINDOW_DAYS * DAY_MS;
    const summary: ApifySyncSummary = {
      ok: true,
      scanned: 0,
      matched: 0,
      synced: 0,
      unavailable: 0,
      errors: 0,
      runs: 0,
    };

    for (const { plateforme, source } of APIFY_PLATFORMS) {
      const pubs = await ctx.runQuery(
        internal.apifySync.listActiveApifyPublications,
        projectId ? { cutoff, plateforme, projectId } : { cutoff, plateforme },
      );
      summary.scanned += pubs.length;

      // Clé de post par publication (id TikTok / shortcode Insta).
      const keyFor = (url: string): string | null =>
        plateforme === "TikTok" ? tiktokPostId(url) : instagramShortcode(url);
      const targets: { publicationId: Id<"publications">; key: string }[] = [];
      const urls: string[] = [];
      for (const p of pubs) {
        const key = keyFor(p.postUrl);
        if (!key) continue; // shortlink / URL non rapprochable → loggué via matched
        targets.push({ publicationId: p._id, key });
        urls.push(p.postUrl);
      }
      summary.matched += targets.length;
      if (targets.length === 0) continue;

      const { stats, unavailable, errors, runs } =
        await fetchApifyViewsForPlatform(plateforme, urls, apiToken);
      summary.unavailable += unavailable.length;
      summary.errors += errors.length;
      summary.runs += runs;

      for (const t of targets) {
        const stat = stats[t.key];
        if (stat === undefined) continue; // indisponible ou lot en erreur
        const r = await ctx.runMutation(internal.apifySync.recordApifySnapshot, {
          publicationId: t.publicationId,
          vues: stat.views,
          likes: stat.likes,
          comments: stat.comments,
          title: stat.title ?? undefined,
          capturedAt: now,
          source,
        });
        if (r.action !== "skipped") summary.synced += 1;
      }

      if (errors.length > 0) {
        console.error(
          `[apify-sync] ${plateforme} — ${errors.length} lot(s) en erreur:`,
          errors,
        );
      }
      if (unavailable.length > 0) {
        console.warn(
          `[apify-sync] ${plateforme} — ${unavailable.length} post(s) indisponible(s) (privé/supprimé/image).`,
        );
      }
      console.info(
        `[apify-sync] ${plateforme} OK — ${pubs.length} pub(s) active(s), ${targets.length} post(s), ${runs} run(s) Apify.`,
      );
    }

    console.info(
      `[apify-sync] Terminé — ${summary.synced} snapshot(s), ${summary.runs} run(s) Apify au total (~coût).`,
    );
    return summary;
  },
});

/**
 * Déclenchement MANUEL (admin) — « Synchroniser TikTok/Insta maintenant ».
 * Planifie le même relevé, SCOPÉ au projet de l'admin (ctx.projectId), sans
 * attendre le cron. Asynchrone : les snapshots apparaissent dans la seconde
 * (réactivité Convex). Gated adminMutation → le créateur est rejeté.
 *
 * ⚠️ TS7022 — référence internal.apifySync.runDailySync via le scheduler : type
 * de retour annoté.
 */
export const requestApifySync = adminMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: true }> => {
    await ctx.scheduler.runAfter(0, internal.apifySync.runDailySync, {
      projectId: ctx.projectId,
    });
    return { scheduled: true };
  },
});

/**
 * Test e2e — exerce l'upsert idempotent réel SANS dépendre d'Apify (pas de token
 * requis sur le deployment de test). Gated par le secret e2e.
 */
export const e2eRecordApifySnapshot = e2eMutation({
  args: {
    publicationId: v.id("publications"),
    vues: v.number(),
    likes: v.optional(v.union(v.number(), v.null())),
    comments: v.optional(v.union(v.number(), v.null())),
    title: v.optional(v.string()),
    capturedAt: v.number(),
    source: apifySourceValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ action: "inserted" | "updated" | "skipped" }> =>
    upsertApifySnapshot(ctx, args),
});
