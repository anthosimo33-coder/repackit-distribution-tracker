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
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { adminMutation, adminQuery } from "./functions";
import {
  computeEngagement,
  fetchRadarProfileVideos,
  normalizeTikTokHandle,
  toRadarDateFilter,
} from "./radarApi";

/**
 * Limite douce de comptes favoris (garde-fou quota Apify). NON bloquante : à
 * l'ajout au-delà, on AVERTIT mais on n'empêche pas (cf brief : prévenir, pas
 * bloquer dur). Le compteur « X / LIMIT » de l'UI lit cette valeur.
 */
const RADAR_ACCOUNT_LIMIT = 25;

/** Vidéos récupérées par compte et par sync (validé en faisabilité, coût borné). */
const RESULTS_PER_PAGE = 6;

/** Note libre : trim + borne. */
function cleanNote(note: string | undefined): string | undefined {
  if (typeof note !== "string") return undefined;
  const t = note.trim();
  return t === "" ? undefined : t.slice(0, 200);
}

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
 * Mur de vidéos : toutes les vidéos du projet, ou celles d'UN compte favori.
 * Engagement calculé serveur (tri possible). Tri/filtre fin restent en JS côté
 * client (réactivité). Chaque vidéo porte le handle/note de son compte (affichage
 * grille). Un accountId d'un AUTRE projet est rejeté (no cross-project leak).
 */
export const listRadarVideos = adminQuery({
  args: { accountId: v.optional(v.id("radarAccounts")) },
  handler: async (ctx, { accountId }) => {
    const accounts = await ctx.db
      .query("radarAccounts")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const accountById = new Map(accounts.map((a) => [a._id, a]));

    let videos: Doc<"radarVideos">[];
    if (accountId !== undefined) {
      const account = accountById.get(accountId);
      if (account === undefined) {
        throw new ConvexError("Compte Radar introuvable dans ce projet.");
      }
      videos = await ctx.db
        .query("radarVideos")
        .withIndex("by_radarAccount", (q) => q.eq("radarAccountId", accountId))
        .collect();
    } else {
      videos = await ctx.db
        .query("radarVideos")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect();
    }

    return videos.map((video) => {
      const account = accountById.get(video.radarAccountId);
      return {
        ...video,
        engagement: computeEngagement(
          video.views,
          video.likes,
          video.comments,
          video.shares,
        ),
        accountHandle: account?.handle ?? video.authorHandle ?? null,
        accountNote: account?.note ?? null,
      };
    });
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
        ? `Tu suis ${nextCount} comptes (limite conseillée ${RADAR_ACCOUNT_LIMIT}). Au-delà, le quota Apify gratuit risque d'être dépassé.`
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

const parsedVideoValidator = v.object({
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
});

/**
 * Upsert idempotent d'un lot de vidéos pour un compte + maj du compte
 * (lastSyncAt, authorFansSnapshot). Toujours appelée quand le run a abouti (même
 * 0 vidéo → on marque lastSyncAt pour ne pas re-scraper toute la fenêtre).
 */
export const applyRadarVideos = internalMutation({
  args: {
    accountId: v.id("radarAccounts"),
    projectId: v.id("projects"),
    videos: v.array(parsedVideoValidator),
    fans: v.union(v.number(), v.null()),
    syncedAt: v.number(),
  },
  handler: async (
    ctx,
    { accountId, projectId, videos, fans, syncedAt },
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
    await ctx.db.patch(accountId, {
      lastSyncAt: syncedAt,
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
 * Sync Apify (clé RADAR). Incrémental : filtre date = dernier sync du compte
 * (1er sync = sans filtre, RESULTS_PER_PAGE dernières vidéos). Robuste : un
 * compte introuvable/privé/0 vidéo NE crashe PAS la boucle ; un échec
 * réseau/quota est logué (sans la clé) et le compte sera retenté au prochain
 * passage (lastSyncAt non avancé). La clé n'est JAMAIS loguée.
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
      const result = await fetchRadarProfileVideos(account.handle, apiToken, {
        resultsPerPage: RESULTS_PER_PAGE,
        oldestPostDate,
      });
      if (!result.ok) {
        errors += 1;
        console.warn(
          `[radar] sync @${account.handle} échoué (${result.error ?? "?"}) — retenté au prochain passage.`,
        );
        continue; // lastSyncAt non avancé → retry
      }
      const fansValues = result.videos
        .map((v) => v.authorFans)
        .filter((n): n is number => n !== null);
      const fans = fansValues.length > 0 ? Math.max(...fansValues) : null;
      await ctx.runMutation(internal.radar.applyRadarVideos, {
        accountId: account._id,
        projectId: account.projectId,
        videos: result.videos,
        fans,
        syncedAt: Date.now(),
      });
      synced += result.videos.length;
    }

    return { ok: true, accounts: accounts.length, synced, errors };
  },
});
