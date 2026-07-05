/**
 * RADAR — veille TikTok, Brique 1 (comptes favoris + suivi de leurs vidéos).
 * Module ADMIN UNIQUEMENT, SILO séparé : ne touche NI creators NI publications NI
 * comptes (tracking créateurs = autre module). Toutes les fonctions publiques
 * passent par adminQuery/adminMutation → un créateur n'atteint AUCUNE fonction
 * Radar (rejet serveur). Scopé projet (ctx.projectId injecté par le wrapper).
 *
 * Source de données : Apify clockworks/tiktok-scraper en input PROFIL, via un
 * COMPTE Apify DISTINCT (clé process.env.APIFY_RADAR_TOKEN) pour isoler les
 * quotas du tracking créateurs. La clé n'est JAMAIS loguée, JAMAIS renvoyée au
 * client. Sync INCRÉMENTAL : filtre date = dernier sync du compte (coût quasi
 * nul si rien de neuf). Upsert idempotent par (radarAccountId, tiktokId).
 */

import { ConvexError, v } from "convex/values";
import { customAction } from "convex-helpers/server/customFunctions";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { adminMutation, adminQuery } from "./functions";
import {
  apiFetchHashtagVideos,
  apiFetchSearchVideos,
  apiFetchTrendHashtags,
  computeEngagement,
  fetchRadarProfileVideos,
  mergeRadarBuckets,
  normalizeSearchKeyword,
  normalizeTikTokHandle,
  rankSearchVideos,
  toRadarDateFilter,
} from "./radarApi";
// Pays supportés + validation = SOURCE UNIQUE partagée (cf convex/countries),
// réutilisée aussi par comptes.targetCountry (aucune duplication de la liste).
import { SUPPORTED_COUNTRIES as SUPPORTED_TREND_COUNTRIES, assertCountry } from "./countries";

/**
 * Limite douce de comptes favoris (garde-fou quota Apify). NON bloquante : à
 * l'ajout au-delà, on AVERTIT mais on n'empêche pas (cf brief : prévenir, pas
 * bloquer dur). Le compteur « X / LIMIT » de l'UI lit cette valeur. Abaissée de
 * 25 → 8 : chaque compte coûte désormais ~4× plus (15 récentes + 10 populaires,
 * 2 appels Apify/sync) qu'avec l'unique appel de 6 vidéos d'origine.
 */
const RADAR_ACCOUNT_LIMIT = 8;

/** Dernières vidéos récupérées par compte (sorting "latest", incrémental). */
const RECENT_RESULTS = 15;

/** Top vues récupérées par compte (sorting "popular", re-checké chaque sync). */
const POPULAR_RESULTS = 10;

/** Note libre : trim + borne. */
function cleanNote(note: string | undefined): string | undefined {
  if (typeof note !== "string") return undefined;
  const t = note.trim();
  return t === "" ? undefined : t.slice(0, 200);
}

// ─── Tendances (Brique 2) — constantes + wrapper action admin ────────────────

/** Âge max d'une vidéo de tendance (clockworks hashtag = top non trié par date). */
const TREND_VIDEO_MAX_AGE_DAYS = 14;

/** Vidéos récupérées par hashtag cliqué. */
const TREND_HASHTAG_VIDEOS = 15;


/**
 * Vérifie le rôle admin DEPUIS UNE ACTION (qui n'a pas d'accès db direct). Interne,
 * appelée par le wrapper adminAction via runQuery. Même règle que requireProjectAdmin.
 */
export const requireAdminForRadarAction = internalQuery({
  args: { userId: v.id("users"), projectId: v.id("projects") },
  handler: async (ctx, { userId, projectId }): Promise<boolean> => {
    const project = await ctx.db.get(projectId);
    if (project === null) return false;
    const user = await ctx.db.get(userId);
    if (user?.role === "superadmin") return true;
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", userId).eq("projectId", projectId),
      )
      .first();
    return membership?.role === "admin";
  },
});

/**
 * Wrapper ACTION admin-only, LOCAL au module Radar (functions.ts non touché). Même
 * contrat que adminMutation (arg `projectId`, ctx.userId/projectId injectés) mais
 * pour les actions (I/O Apify) appelables directement et AWAITables côté client →
 * chargement « à la demande » propre. Gating via requireAdminForRadarAction.
 */
const adminAction = customAction(action, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Non authentifié.");
    const ok: boolean = await ctx.runQuery(
      internal.radar.requireAdminForRadarAction,
      { userId, projectId },
    );
    if (!ok) throw new ConvexError("Réservé aux administrateurs du projet.");
    return { ctx: { userId, projectId }, args: {} };
  },
});

// ─── Queries admin (lecture) ─────────────────────────────────────────────────

/**
 * Comptes favoris suivis du projet + la limite douce (pour le compteur UI).
 * Chaque compte porte son nb de vidéos connues (pour l'affichage des cartes).
 */
export const listRadarAccounts = adminQuery({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db
      .query("radarAccounts")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    accounts.sort((a, b) => b.addedAt - a.addedAt);
    const withCounts = await Promise.all(
      accounts.map(async (a) => {
        const videos = await ctx.db
          .query("radarVideos")
          .withIndex("by_radarAccount", (q) => q.eq("radarAccountId", a._id))
          .collect();
        return {
          _id: a._id,
          handle: a.handle,
          note: a.note ?? null,
          authorFansSnapshot: a.authorFansSnapshot ?? null,
          lastSyncAt: a.lastSyncAt ?? null,
          addedAt: a.addedAt,
          videoCount: videos.length,
        };
      }),
    );
    return { accounts: withCounts, limit: RADAR_ACCOUNT_LIMIT };
  },
});

/**
 * Mur de vidéos en DEUX buckets, par compte (ou tous les comptes du projet) :
 *   - "popular" : vidéos marquées isPopular au dernier sync (top vues), cap
 *     POPULAR_RESULTS, triées par vues décroissantes ;
 *   - "recent"  : vidéos NON populaires et NON épinglées, triées par date
 *     décroissante, cap RECENT_RESULTS.
 * La dédup populaire-prioritaire est garantie en amont (un id n'est jamais
 * simultanément populaire et récent). Engagement calculé serveur. Le tri/filtre
 * fin reste en JS côté client. Un accountId d'un AUTRE projet est rejeté.
 */
export const listRadarVideos = adminQuery({
  args: { accountId: v.optional(v.id("radarAccounts")) },
  handler: async (ctx, { accountId }) => {
    const accounts = await ctx.db
      .query("radarAccounts")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const accountById = new Map(accounts.map((a) => [a._id, a]));

    let targetIds: Id<"radarAccounts">[];
    if (accountId !== undefined) {
      if (!accountById.has(accountId)) {
        throw new ConvexError("Compte Radar introuvable dans ce projet.");
      }
      targetIds = [accountId];
    } else {
      targetIds = accounts.map((a) => a._id);
    }

    const toView = (
      video: Doc<"radarVideos">,
      bucket: "recent" | "popular",
    ) => {
      const account = accountById.get(video.radarAccountId);
      return {
        ...video,
        bucket,
        engagement: computeEngagement(
          video.views,
          video.likes,
          video.comments,
          video.shares,
        ),
        accountHandle: account?.handle ?? video.authorHandle ?? null,
        accountNote: account?.note ?? null,
      };
    };

    const out: ReturnType<typeof toView>[] = [];
    for (const id of targetIds) {
      const vids = await ctx.db
        .query("radarVideos")
        .withIndex("by_radarAccount", (q) => q.eq("radarAccountId", id))
        .collect();
      const popular = vids
        .filter((v) => v.isPopular === true)
        .sort((a, b) => b.views - a.views)
        .slice(0, POPULAR_RESULTS);
      const recent = vids
        .filter((v) => v.isPopular !== true && !v.isPinned)
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, RECENT_RESULTS);
      for (const v of popular) out.push(toView(v, "popular"));
      for (const v of recent) out.push(toView(v, "recent"));
    }
    return out;
  },
});

// ─── Mutations admin (écriture) ──────────────────────────────────────────────

/**
 * Ajoute un compte favori. `input` = @handle, handle nu, ou URL de profil
 * tiktok.com/@x → handle normalisé. Refuse un handle invalide ou un doublon.
 * NON bloquant sur la limite : si on l'atteint, on ajoute quand même et on
 * renvoie un `warning`. Déclenche un 1er sync immédiat du compte.
 */
export const addRadarAccount = adminMutation({
  args: { input: v.string(), note: v.optional(v.string()) },
  handler: async (
    ctx,
    { input, note },
  ): Promise<{ accountId: Id<"radarAccounts">; warning: string | null }> => {
    const handle = normalizeTikTokHandle(input);
    if (handle === null) {
      throw new ConvexError(
        "Handle TikTok invalide. Colle un @, un handle, ou une URL de profil (tiktok.com/@compte).",
      );
    }
    const existing = await ctx.db
      .query("radarAccounts")
      .withIndex("by_project_handle", (q) =>
        q.eq("projectId", ctx.projectId).eq("handle", handle),
      )
      .first();
    if (existing !== null) {
      throw new ConvexError(`@${handle} est déjà suivi.`);
    }

    const current = await ctx.db
      .query("radarAccounts")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();

    const accountId = await ctx.db.insert("radarAccounts", {
      projectId: ctx.projectId,
      handle,
      platform: "tiktok",
      note: cleanNote(note),
      addedAt: Date.now(),
    });

    // 1er sync immédiat (clé RADAR) → les vidéos apparaissent dans la foulée.
    await ctx.scheduler.runAfter(0, internal.radar.runRadarSync, {
      projectId: ctx.projectId,
      accountId,
    });

    const nextCount = current.length + 1;
    const warning =
      nextCount >= RADAR_ACCOUNT_LIMIT
        ? `Tu suis ${nextCount} comptes (limite conseillée ${RADAR_ACCOUNT_LIMIT}). Avec 15 récentes + 10 top vues par compte, au-delà le quota Apify gratuit risque d'être dépassé.`
        : null;
    return { accountId, warning };
  },
});

/** Met à jour la note/tag libre d'un compte favori. */
export const updateRadarAccountNote = adminMutation({
  args: { accountId: v.id("radarAccounts"), note: v.optional(v.string()) },
  handler: async (ctx, { accountId, note }): Promise<null> => {
    const account = await ctx.db.get(accountId);
    if (account === null || account.projectId !== ctx.projectId) {
      throw new ConvexError("Compte Radar introuvable dans ce projet.");
    }
    await ctx.db.patch(accountId, { note: cleanNote(note) });
    return null;
  },
});

/** Retire un compte favori ET toutes ses vidéos (silo, pas de lien externe). */
export const removeRadarAccount = adminMutation({
  args: { accountId: v.id("radarAccounts") },
  handler: async (ctx, { accountId }): Promise<null> => {
    const account = await ctx.db.get(accountId);
    if (account === null || account.projectId !== ctx.projectId) {
      throw new ConvexError("Compte Radar introuvable dans ce projet.");
    }
    const videos = await ctx.db
      .query("radarVideos")
      .withIndex("by_radarAccount", (q) => q.eq("radarAccountId", accountId))
      .collect();
    for (const video of videos) {
      await ctx.db.delete(video._id);
    }
    await ctx.db.delete(accountId);
    return null;
  },
});

/** Bouton « Synchroniser » : planifie le sync de TOUS les comptes du projet. */
export const requestRadarSync = adminMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: true }> => {
    await ctx.scheduler.runAfter(0, internal.radar.runRadarSync, {
      projectId: ctx.projectId,
    });
    return { scheduled: true };
  },
});

/** Re-sync ciblé d'UN compte (bouton par carte). */
export const requestRadarAccountSync = adminMutation({
  args: { accountId: v.id("radarAccounts") },
  handler: async (ctx, { accountId }): Promise<{ scheduled: true }> => {
    const account = await ctx.db.get(accountId);
    if (account === null || account.projectId !== ctx.projectId) {
      throw new ConvexError("Compte Radar introuvable dans ce projet.");
    }
    await ctx.scheduler.runAfter(0, internal.radar.runRadarSync, {
      projectId: ctx.projectId,
      accountId,
    });
    return { scheduled: true };
  },
});

// ─── Interne : sync Apify (action) + persistance (mutation) ───────────────────

type RadarAccountForSync = {
  _id: Id<"radarAccounts">;
  projectId: Id<"projects">;
  handle: string;
  lastSyncAt: number | null;
};

/**
 * Comptes à synchroniser : un seul (accountId), tous ceux d'un projet
 * (projectId), ou TOUS (cron, aucun arg). Toujours scopé au projet de l'accountId
 * quand les deux sont fournis.
 */
export const listAccountsForSync = internalQuery({
  args: {
    projectId: v.optional(v.id("projects")),
    accountId: v.optional(v.id("radarAccounts")),
  },
  handler: async (ctx, { projectId, accountId }): Promise<RadarAccountForSync[]> => {
    let accounts: Doc<"radarAccounts">[];
    if (accountId !== undefined) {
      const account = await ctx.db.get(accountId);
      accounts = account === null ? [] : [account];
    } else if (projectId !== undefined) {
      accounts = await ctx.db
        .query("radarAccounts")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect();
    } else {
      accounts = await ctx.db.query("radarAccounts").collect();
    }
    return accounts.map((a) => ({
      _id: a._id,
      projectId: a.projectId,
      handle: a.handle,
      lastSyncAt: a.lastSyncAt ?? null,
    }));
  },
});

const bucketedVideoValidator = v.object({
  tiktokId: v.string(),
  url: v.string(),
  publishedAt: v.number(),
  caption: v.union(v.string(), v.null()),
  views: v.number(),
  likes: v.number(),
  comments: v.number(),
  shares: v.number(),
  saves: v.number(),
  durationSec: v.union(v.number(), v.null()),
  coverUrl: v.union(v.string(), v.null()),
  musicName: v.union(v.string(), v.null()),
  hashtags: v.array(v.string()),
  authorHandle: v.union(v.string(), v.null()),
  authorFans: v.union(v.number(), v.null()),
  isAd: v.boolean(),
  isPinned: v.boolean(),
  isSlideshow: v.boolean(),
  isPopular: v.boolean(),
});

/**
 * Upsert idempotent d'un lot de vidéos bucketées (récentes + populaires fusionnées
 * et dédupliquées en amont) pour un compte, + maj du compte. Étapes :
 *   1. upsert par (radarAccountId, tiktokId), `isPopular` rafraîchi ;
 *   2. si `refreshPopular` (le fetch populaire a abouti) : DÉMOTE les ex-populaires
 *      (isPopular=true en base mais plus dans le top courant) → isPopular=false,
 *      elles redeviennent candidates « récentes » ;
 *   3. `advanceSync` (le fetch récent a abouti) → avance lastSyncAt (incrémental).
 * Toujours appelée quand au moins un fetch a abouti (même 0 vidéo → lastSyncAt
 * marqué si advanceSync).
 */
export const applyRadarVideos = internalMutation({
  args: {
    accountId: v.id("radarAccounts"),
    projectId: v.id("projects"),
    videos: v.array(bucketedVideoValidator),
    popularIds: v.array(v.string()),
    refreshPopular: v.boolean(),
    advanceSync: v.boolean(),
    fans: v.union(v.number(), v.null()),
    syncedAt: v.number(),
  },
  handler: async (
    ctx,
    { accountId, projectId, videos, popularIds, refreshPopular, advanceSync, fans, syncedAt },
  ): Promise<{ upserted: number }> => {
    const account = await ctx.db.get(accountId);
    if (account === null) return { upserted: 0 }; // supprimé entre-temps
    for (const video of videos) {
      const fields = {
        url: video.url,
        publishedAt: video.publishedAt,
        caption: video.caption ?? undefined,
        views: video.views,
        likes: video.likes,
        comments: video.comments,
        shares: video.shares,
        saves: video.saves,
        durationSec: video.durationSec ?? undefined,
        coverUrl: video.coverUrl ?? undefined,
        musicName: video.musicName ?? undefined,
        hashtags: video.hashtags,
        authorHandle: video.authorHandle ?? undefined,
        isAd: video.isAd,
        isPinned: video.isPinned,
        isSlideshow: video.isSlideshow,
        isPopular: video.isPopular,
        lastSeenAt: syncedAt,
      };
      const existing = await ctx.db
        .query("radarVideos")
        .withIndex("by_account_tiktok", (q) =>
          q.eq("radarAccountId", accountId).eq("tiktokId", video.tiktokId),
        )
        .first();
      if (existing !== null) {
        await ctx.db.patch(existing._id, fields);
      } else {
        await ctx.db.insert("radarVideos", {
          projectId,
          radarAccountId: accountId,
          tiktokId: video.tiktokId,
          ...fields,
        });
      }
    }

    // Démotion des ex-populaires : seulement si le top a été re-récupéré (sinon on
    // garderait l'ancien top, ce qui est correct).
    if (refreshPopular) {
      const stillPopular = new Set(popularIds);
      const formerlyPopular = await ctx.db
        .query("radarVideos")
        .withIndex("by_radarAccount", (q) => q.eq("radarAccountId", accountId))
        .collect();
      for (const v of formerlyPopular) {
        if (v.isPopular === true && !stillPopular.has(v.tiktokId)) {
          await ctx.db.patch(v._id, { isPopular: false });
        }
      }
    }

    await ctx.db.patch(accountId, {
      ...(advanceSync ? { lastSyncAt: syncedAt } : {}),
      ...(fans !== null ? { authorFansSnapshot: fans } : {}),
    });
    return { upserted: videos.length };
  },
});

type RadarSyncSummary = {
  ok: boolean;
  reason?: string;
  accounts: number;
  synced: number;
  errors: number;
};

/**
 * Sync Apify (clé RADAR). DEUX appels par compte :
 *   - RÉCENTES : sorting "latest", 15 vidéos, épinglées exclues, filtre date
 *     incrémental (= dernier sync ; 1er sync sans filtre) ;
 *   - POPULAIRES : sorting "popular", 10 vidéos, SANS filtre date (le top bouge).
 * Fusion + dédup (populaire prioritaire) via mergeRadarBuckets, puis upsert. lastSyncAt
 * n'avance QUE si les récentes ont abouti (l'incrémental en dépend) ; le top n'est
 * démoté que si les populaires ont abouti. Un compte privé/introuvable/0 vidéo NE
 * crashe PAS la boucle ; les deux fetches en échec → compte logué (sans la clé) et
 * retenté. La clé n'est JAMAIS loguée.
 */
export const runRadarSync = internalAction({
  args: {
    projectId: v.optional(v.id("projects")),
    accountId: v.optional(v.id("radarAccounts")),
  },
  handler: async (ctx, { projectId, accountId }): Promise<RadarSyncSummary> => {
    const apiToken = process.env.APIFY_RADAR_TOKEN;
    if (!apiToken) {
      console.error(
        "[radar] APIFY_RADAR_TOKEN absent — sync annulé. " +
          "Posez la clé : npx convex env set APIFY_RADAR_TOKEN <token>.",
      );
      return { ok: false, reason: "missing-radar-token", accounts: 0, synced: 0, errors: 0 };
    }

    const accounts = await ctx.runQuery(internal.radar.listAccountsForSync, {
      projectId,
      accountId,
    });

    let synced = 0;
    let errors = 0;
    for (const account of accounts) {
      const oldestPostDate =
        account.lastSyncAt !== null ? toRadarDateFilter(account.lastSyncAt) : undefined;

      const recent = await fetchRadarProfileVideos(account.handle, apiToken, {
        sorting: "latest",
        resultsPerPage: RECENT_RESULTS,
        oldestPostDate,
        excludePinned: true,
      });
      const popular = await fetchRadarProfileVideos(account.handle, apiToken, {
        sorting: "popular",
        resultsPerPage: POPULAR_RESULTS,
      });

      if (!recent.ok && !popular.ok) {
        errors += 1;
        console.warn(
          `[radar] sync @${account.handle} échoué (récentes: ${recent.error ?? "?"} / top: ${popular.error ?? "?"}) — retenté.`,
        );
        continue; // lastSyncAt non avancé → retry
      }

      const merged = mergeRadarBuckets(
        recent.ok ? recent.videos : [],
        popular.ok ? popular.videos : [],
      );
      const fansValues = [
        ...(recent.ok ? recent.videos : []),
        ...(popular.ok ? popular.videos : []),
      ]
        .map((vid) => vid.authorFans)
        .filter((n): n is number => n !== null);
      const fans = fansValues.length > 0 ? Math.max(...fansValues) : null;

      await ctx.runMutation(internal.radar.applyRadarVideos, {
        accountId: account._id,
        projectId: account.projectId,
        videos: merged,
        popularIds: popular.ok ? popular.videos.map((vid) => vid.tiktokId) : [],
        refreshPopular: popular.ok,
        advanceSync: recent.ok,
        fans,
        syncedAt: Date.now(),
      });
      synced += merged.length;
    }

    return { ok: true, accounts: accounts.length, synced, errors };
  },
});

// ═══ TENDANCES (Brique 2) — hashtags par pays → vidéos à la demande ═══════════

// ─── Queries admin (lecture, cache) ──────────────────────────────────────────

/**
 * Hashtags tendance en cache pour un pays, triés par rank, + `fetchedAt`
 * (fraîcheur, null si jamais chargé). Chaque hashtag porte `videosFetchedAt`
 * (null = ses vidéos pas encore chargées) pour le chargement paresseux.
 */
export const listTrendHashtags = adminQuery({
  args: { countryCode: v.string() },
  handler: async (ctx, { countryCode }) => {
    const cc = assertCountry(countryCode);
    const rows = await ctx.db
      .query("radarTrendHashtags")
      .withIndex("by_country", (q) => q.eq("countryCode", cc))
      .collect();
    rows.sort((a, b) => a.rank - b.rank);
    return {
      fetchedAt: rows.length > 0 ? rows[0].fetchedAt : null,
      hashtags: rows.map((r) => ({
        _id: r._id,
        hashtag: r.hashtag,
        hashtagId: r.hashtagId ?? null,
        rank: r.rank,
        posts: r.posts ?? null,
        videoViews: r.videoViews ?? null,
        trendDirection: r.trendDirection ?? null,
        topCreators: r.topCreators ?? [],
        tiktokUrl: r.tiktokUrl ?? null,
        videosFetchedAt: r.videosFetchedAt ?? null,
        videosError: r.videosError ?? false,
      })),
    };
  },
});

/** Vidéos en cache d'un hashtag (déjà filtrées < 14 j), avec engagement calculé. */
export const listTrendVideos = adminQuery({
  args: { countryCode: v.string(), hashtag: v.string() },
  handler: async (ctx, { countryCode, hashtag }) => {
    const cc = assertCountry(countryCode);
    const vids = await ctx.db
      .query("radarTrendVideos")
      .withIndex("by_country_hashtag", (q) =>
        q.eq("countryCode", cc).eq("hashtag", hashtag),
      )
      .collect();
    return vids.map((video) => ({
      ...video,
      engagement: computeEngagement(
        video.views,
        video.likes,
        video.comments,
        video.shares,
      ),
    }));
  },
});

/** Liste des pays supportés (pour le sélecteur). */
export const listTrendCountries = adminQuery({
  args: {},
  handler: async (): Promise<string[]> => [...SUPPORTED_TREND_COUNTRIES],
});

// ─── Mutations internes (remplacement de cache) ──────────────────────────────

const trendHashtagValidator = v.object({
  hashtag: v.string(),
  hashtagId: v.union(v.string(), v.null()),
  rank: v.number(),
  posts: v.union(v.number(), v.null()),
  videoViews: v.union(v.number(), v.null()),
  trendDirection: v.union(v.string(), v.null()),
  topCreators: v.array(
    v.object({
      handle: v.string(),
      nickname: v.union(v.string(), v.null()),
      country: v.union(v.string(), v.null()),
      followers: v.union(v.number(), v.null()),
    }),
  ),
  tiktokUrl: v.union(v.string(), v.null()),
  period: v.union(v.string(), v.null()),
});

const trendVideoValidator = v.object({
  tiktokId: v.string(),
  url: v.string(),
  publishedAt: v.number(),
  caption: v.union(v.string(), v.null()),
  views: v.number(),
  likes: v.number(),
  comments: v.number(),
  shares: v.number(),
  saves: v.number(),
  durationSec: v.union(v.number(), v.null()),
  coverUrl: v.union(v.string(), v.null()),
  musicName: v.union(v.string(), v.null()),
  hashtags: v.array(v.string()),
  authorHandle: v.union(v.string(), v.null()),
  isAd: v.boolean(),
  isPinned: v.boolean(),
  isSlideshow: v.boolean(),
});

/** Remplace TOUT le cache (hashtags + leurs vidéos) d'un pays par le frais. */
export const replaceTrendHashtags = internalMutation({
  args: {
    countryCode: v.string(),
    fetchedAt: v.number(),
    hashtags: v.array(trendHashtagValidator),
  },
  handler: async (
    ctx,
    { countryCode, fetchedAt, hashtags },
  ): Promise<{ inserted: number }> => {
    // Purge l'ancien cache du pays (hashtags + vidéos rattachées).
    const oldHashtags = await ctx.db
      .query("radarTrendHashtags")
      .withIndex("by_country", (q) => q.eq("countryCode", countryCode))
      .collect();
    for (const h of oldHashtags) await ctx.db.delete(h._id);
    const oldVideos = await ctx.db
      .query("radarTrendVideos")
      .withIndex("by_country_hashtag", (q) => q.eq("countryCode", countryCode))
      .collect();
    for (const vid of oldVideos) await ctx.db.delete(vid._id);

    for (const h of hashtags) {
      await ctx.db.insert("radarTrendHashtags", {
        countryCode,
        hashtag: h.hashtag,
        hashtagId: h.hashtagId ?? undefined,
        rank: h.rank,
        posts: h.posts ?? undefined,
        videoViews: h.videoViews ?? undefined,
        trendDirection: h.trendDirection ?? undefined,
        topCreators: h.topCreators.map((c) => ({
          handle: c.handle,
          nickname: c.nickname ?? undefined,
          country: c.country ?? undefined,
          followers: c.followers ?? undefined,
        })),
        tiktokUrl: h.tiktokUrl ?? undefined,
        period: h.period ?? undefined,
        fetchedAt,
      });
    }
    return { inserted: hashtags.length };
  },
});

/** Remplace les vidéos d'UN hashtag + marque videosFetchedAt sur sa ligne. */
export const replaceTrendVideos = internalMutation({
  args: {
    countryCode: v.string(),
    hashtag: v.string(),
    fetchedAt: v.number(),
    videos: v.array(trendVideoValidator),
  },
  handler: async (
    ctx,
    { countryCode, hashtag, fetchedAt, videos },
  ): Promise<{ inserted: number }> => {
    const old = await ctx.db
      .query("radarTrendVideos")
      .withIndex("by_country_hashtag", (q) =>
        q.eq("countryCode", countryCode).eq("hashtag", hashtag),
      )
      .collect();
    for (const vid of old) await ctx.db.delete(vid._id);

    for (const video of videos) {
      await ctx.db.insert("radarTrendVideos", {
        countryCode,
        hashtag,
        tiktokId: video.tiktokId,
        url: video.url,
        publishedAt: video.publishedAt,
        caption: video.caption ?? undefined,
        views: video.views,
        likes: video.likes,
        comments: video.comments,
        shares: video.shares,
        saves: video.saves,
        durationSec: video.durationSec ?? undefined,
        coverUrl: video.coverUrl ?? undefined,
        musicName: video.musicName ?? undefined,
        hashtags: video.hashtags,
        authorHandle: video.authorHandle ?? undefined,
        isAd: video.isAd,
        isPinned: video.isPinned,
        isSlideshow: video.isSlideshow,
        fetchedAt,
      });
    }

    // Marque la ligne hashtag : ses vidéos sont chargées (succès), pas d'erreur.
    const row = await ctx.db
      .query("radarTrendHashtags")
      .withIndex("by_country_hashtag", (q) =>
        q.eq("countryCode", countryCode).eq("hashtag", hashtag),
      )
      .first();
    if (row !== null) {
      await ctx.db.patch(row._id, { videosFetchedAt: fetchedAt, videosError: false });
    }
    return { inserted: videos.length };
  },
});

// ─── Actions admin (I/O Apify, clé RADAR, awaitables) ────────────────────────

/**
 * Charge/rafraîchit les hashtags tendance d'un pays (data_xplorer, clé RADAR) et
 * REMPLACE le cache du pays. À la demande (ouverture onglet / « Actualiser »).
 * Awaitable → le front sait quand c'est fini. Token jamais logué.
 */
export const fetchTrendHashtags = adminAction({
  args: { countryCode: v.string() },
  handler: async (ctx, { countryCode }): Promise<{ ok: boolean; count: number }> => {
    const cc = assertCountry(countryCode);
    const apiToken = process.env.APIFY_RADAR_TOKEN;
    if (!apiToken) {
      console.error("[radar] APIFY_RADAR_TOKEN absent — tendances annulées.");
      return { ok: false, count: 0 };
    }
    const res = await apiFetchTrendHashtags(cc, apiToken);
    if (!res.ok) {
      console.warn(`[radar] hashtags tendance ${cc} échoué (${res.error ?? "?"}).`);
      return { ok: false, count: 0 };
    }
    await ctx.runMutation(internal.radar.replaceTrendHashtags, {
      countryCode: cc,
      fetchedAt: Date.now(),
      hashtags: res.hashtags,
    });
    return { ok: true, count: res.hashtags.length };
  },
});

/**
 * Charge/rafraîchit les vidéos d'UN hashtag (clockworks, proxyCountryCode, clé
 * RADAR), FILTRÉES < 14 j côté serveur, et remplace leur cache. Déclenchée au clic
 * sur un hashtag (chargement paresseux). Token jamais logué.
 */
export const fetchTrendVideos = adminAction({
  args: { countryCode: v.string(), hashtag: v.string() },
  handler: async (
    ctx,
    { countryCode, hashtag },
  ): Promise<{ ok: boolean; count: number }> => {
    const cc = assertCountry(countryCode);
    const apiToken = process.env.APIFY_RADAR_TOKEN;
    if (!apiToken) {
      console.error("[radar] APIFY_RADAR_TOKEN absent — vidéos tendance annulées.");
      return { ok: false, count: 0 };
    }
    const res = await apiFetchHashtagVideos(cc, hashtag, apiToken, Date.now(), {
      resultsPerPage: TREND_HASHTAG_VIDEOS,
      maxAgeDays: TREND_VIDEO_MAX_AGE_DAYS,
    });
    if (!res.ok) {
      console.warn(
        `[radar] vidéos ${hashtag} (${cc}) échoué (${res.error ?? "?"}) — réessayable.`,
      );
      return { ok: false, count: 0 };
    }
    await ctx.runMutation(internal.radar.replaceTrendVideos, {
      countryCode: cc,
      hashtag,
      fetchedAt: Date.now(),
      videos: res.videos.map((vid) => ({
        tiktokId: vid.tiktokId,
        url: vid.url,
        publishedAt: vid.publishedAt,
        caption: vid.caption,
        views: vid.views,
        likes: vid.likes,
        comments: vid.comments,
        shares: vid.shares,
        saves: vid.saves,
        durationSec: vid.durationSec,
        coverUrl: vid.coverUrl,
        musicName: vid.musicName,
        hashtags: vid.hashtags,
        authorHandle: vid.authorHandle,
        isAd: vid.isAd,
        isPinned: vid.isPinned,
        isSlideshow: vid.isSlideshow,
      })),
    });
    return { ok: true, count: res.videos.length };
  },
});

// ═══ RECHERCHE D'OUTLIERS (Brique 3) — mot-clé → vidéos scorées (cache 24 h) ═══
// Flux : action searchOutliers (cache-aware) → si frais (< 24 h) resert le cache
// SANS appel Apify ; sinon fetch Apify (clé RADAR, proxy US), scoring/tri outlier
// + détection de comptes récurrents (lib pure), puis remplacement du cache du
// mot-clé. Cache GLOBAL (clé = mot-clé seul, partagé cross-projet). La query
// getRadarSearch lit le cache scoré. Silo radarSearches dédié.

/** Résultats récupérés par recherche (resultsPerPage Apify, mode recherche). */
const SEARCH_RESULTS_PER_PAGE = 80;

/**
 * TTL du cache RADAR (outliers ET cohérence d'affichage tendances) : 24 h.
 * Garde-fou budget — l'appel Apify est pay-per-result + add-ons. Ajustable ici.
 * Seul gate TTL serveur : les outliers (searchOutliers) ; les tendances refetch
 * à la demande (« Actualiser »), leur fenêtre de fraîcheur 24 h est côté client.
 */
const RADAR_CACHE_TTL_HOURS = 24;
const RADAR_CACHE_TTL_MS = RADAR_CACHE_TTL_HOURS * 60 * 60 * 1000;

const rankedSearchVideoValidator = v.object({
  tiktokId: v.string(),
  url: v.string(),
  authorId: v.union(v.string(), v.null()),
  authorHandle: v.union(v.string(), v.null()),
  publishedAt: v.number(),
  caption: v.union(v.string(), v.null()),
  coverUrl: v.union(v.string(), v.null()),
  views: v.number(),
  fans: v.union(v.number(), v.null()),
  likes: v.number(),
  comments: v.number(),
  shares: v.number(),
  durationSec: v.union(v.number(), v.null()),
  outlierRatio: v.number(),
  accountOutlierCount: v.number(),
  isRecurringAccount: v.boolean(),
});

// ─── Query admin (lecture du cache) ──────────────────────────────────────────

/**
 * Lot scoré en cache pour un mot-clé (normalisé), ou null si jamais recherché.
 * Vidéos déjà filtrées (anglophone), scorées et triées par outlierRatio
 * décroissant, avec flags de récurrence — la query ne fait que lire le cache.
 */
export const getRadarSearch = adminQuery({
  args: { keyword: v.string() },
  handler: async (ctx, { keyword }) => {
    const norm = normalizeSearchKeyword(keyword);
    if (norm === null) return null;
    const row = await ctx.db
      .query("radarSearches")
      .withIndex("by_keyword", (q) => q.eq("keyword", norm))
      .first();
    if (row === null) return null;
    return {
      keyword: row.keyword,
      rawKeyword: row.rawKeyword,
      fetchedAt: row.fetchedAt,
      totalFetched: row.totalFetched,
      videos: row.videos,
    };
  },
});

// ─── Query interne (fraîcheur du cache, pour l'action) ───────────────────────

/** Fraîcheur du cache d'un mot-clé pour décider d'un appel Apify (action). */
export const getSearchCacheMeta = internalQuery({
  args: { keyword: v.string() },
  handler: async (
    ctx,
    { keyword },
  ): Promise<{ fetchedAt: number; count: number } | null> => {
    const row = await ctx.db
      .query("radarSearches")
      .withIndex("by_keyword", (q) => q.eq("keyword", keyword))
      .first();
    return row === null
      ? null
      : { fetchedAt: row.fetchedAt, count: row.videos.length };
  },
});

// ─── Mutation interne (remplacement du cache d'un mot-clé) ───────────────────

/** Remplace le lot scoré en cache pour un mot-clé (un seul par mot-clé, global). */
export const replaceRadarSearch = internalMutation({
  args: {
    keyword: v.string(),
    rawKeyword: v.string(),
    fetchedAt: v.number(),
    totalFetched: v.number(),
    videos: v.array(rankedSearchVideoValidator),
  },
  handler: async (
    ctx,
    { keyword, rawKeyword, fetchedAt, totalFetched, videos },
  ): Promise<{ inserted: number }> => {
    const existing = await ctx.db
      .query("radarSearches")
      .withIndex("by_keyword", (q) => q.eq("keyword", keyword))
      .first();
    if (existing !== null) await ctx.db.delete(existing._id);
    await ctx.db.insert("radarSearches", {
      keyword,
      rawKeyword,
      fetchedAt,
      totalFetched,
      videos,
    });
    return { inserted: videos.length };
  },
});

// ─── Action admin (I/O Apify, clé RADAR, cache-aware, awaitable) ─────────────

/**
 * Recherche d'outliers par mot-clé. CACHE 24 H d'abord : si le même mot-clé
 * (normalisé) a été recherché dans la fenêtre (par N'IMPORTE quel projet — cache
 * global), on resert le cache SANS appel Apify (`cached:true`). Sinon : fetch
 * Apify (clé RADAR, proxy US, 80 résultats),
 * scoring/tri outlier + détection récurrence (lib pure), remplacement du cache.
 * Awaitable → le front sait quand c'est fini et si un appel a été consommé.
 * Token jamais logué.
 */
export const searchOutliers = adminAction({
  args: { keyword: v.string() },
  handler: async (
    ctx,
    { keyword },
  ): Promise<{
    ok: boolean;
    cached: boolean;
    fetchedAt: number | null;
    count: number;
    error?: string;
  }> => {
    const norm = normalizeSearchKeyword(keyword);
    if (norm === null) {
      throw new ConvexError("Saisis un mot-clé à rechercher.");
    }

    // 1. Cache 24 h (global) : resert sans appel Apify si frais.
    const cacheMeta = await ctx.runQuery(internal.radar.getSearchCacheMeta, {
      keyword: norm,
    });
    if (cacheMeta !== null && Date.now() - cacheMeta.fetchedAt < RADAR_CACHE_TTL_MS) {
      return {
        ok: true,
        cached: true,
        fetchedAt: cacheMeta.fetchedAt,
        count: cacheMeta.count,
      };
    }

    // 2. Appel Apify (clé RADAR dédiée).
    const apiToken = process.env.APIFY_RADAR_TOKEN;
    if (!apiToken) {
      console.error("[radar] APIFY_RADAR_TOKEN absent — recherche annulée.");
      return { ok: false, cached: false, fetchedAt: null, count: 0 };
    }
    const res = await apiFetchSearchVideos(norm, apiToken, {
      resultsPerPage: SEARCH_RESULTS_PER_PAGE,
    });
    if (!res.ok) {
      console.warn(`[radar] recherche "${norm}" échouée (${res.error ?? "?"}).`);
      return { ok: false, cached: false, fetchedAt: null, count: 0 };
    }

    // 3. Scoring + tri + récurrence (lib pure), puis remplacement du cache.
    const ranked = rankSearchVideos(res.videos);
    const fetchedAt = Date.now();
    await ctx.runMutation(internal.radar.replaceRadarSearch, {
      keyword: norm,
      rawKeyword: keyword.trim().slice(0, 100),
      fetchedAt,
      totalFetched: res.totalFetched,
      videos: ranked.map((v) => ({
        tiktokId: v.tiktokId,
        url: v.url,
        authorId: v.authorId,
        authorHandle: v.authorHandle,
        publishedAt: v.publishedAt,
        caption: v.caption,
        coverUrl: v.coverUrl,
        views: v.views,
        fans: v.fans,
        likes: v.likes,
        comments: v.comments,
        shares: v.shares,
        durationSec: v.durationSec,
        outlierRatio: v.outlierRatio,
        accountOutlierCount: v.accountOutlierCount,
        isRecurringAccount: v.isRecurringAccount,
      })),
    });
    return { ok: true, cached: false, fetchedAt, count: ranked.length };
  },
});
