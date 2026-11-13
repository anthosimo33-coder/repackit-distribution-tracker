/**
 * NOUVEAU RADAR — CRÉATEURS : les comptes suivis d'une langue, et tous les
 * TikToks qu'on a de l'un d'eux (onglet Créateurs). Les règles sont dans le
 * module pur convex/radarCreatorsMath.
 *
 * Lecture seule, gardée comme le reste du Radar (`radar.use`, admin). L'écran
 * lit les comptes d'UNE langue par leur index, jamais les 2 000 comptes suivis ;
 * les vidéos d'un compte ne sont lues qu'à l'ouverture de sa fiche.
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { permissionQuery, type ProjectQueryCtx } from "./functions";
import { multiplierOf } from "./radarNetworkMath";
import { projectSlugOf } from "./radarSignals";
import { CREATOR_LANGS, CREATOR_VIDEOS_CAP, creatorVideos } from "./radarCreatorsMath";

const langArg = v.union(...CREATOR_LANGS.map((l) => v.literal(l)));

/** Les comptes suivis ACTIFS dont les vidéos sont dans cette langue, avec l'app qu'ils poussent. */
export async function listCreatorsCore(ctx: ProjectQueryCtx, { lang }: { lang: (typeof CREATOR_LANGS)[number] }) {
  const slug = await projectSlugOf(ctx);
  const apps = new Map((await ctx.db.query("radarApps").collect()).map((a) => [a._id, a]));
  const rows = await ctx.db
    .query("radarTracked")
    .withIndex("by_lang", (q) => q.eq("lang", lang).eq("status", "active"))
    .collect();
  return rows.map((t) => {
    const app = apps.get(t.appId);
    return {
      id: t._id,
      handle: t.handle,
      url: `https://www.tiktok.com/@${t.handle}`,
      app: app?.name ?? null,
      rival: app?.rivalOf.includes(slug) ?? false,
      fans: t.fans,
      bio: t.bio ?? null,
      country: t.country ?? null,
      igHandle: t.igHandle ?? null,
      medianViews: t.medianViews ?? null,
      // Vidéos relevées depuis qu'on le suit : ce que sa fiche montre.
      videosSeen: t.videosSeen,
      posts7d: t.posts7d ?? 0,
      lastPostAt: t.lastPostAt ?? null,
    };
  });
}

export const listCreators = permissionQuery("radar.use")({
  args: { lang: langArg },
  handler: (ctx, args) => listCreatorsCore(ctx, args),
});

/** Tous les TikToks qu'on a d'un compte suivi, les plus récents d'abord. */
export async function creatorVideosCore(ctx: ProjectQueryCtx, { accountId }: { accountId: Id<"radarTracked"> }) {
  const acc = await ctx.db.get(accountId);
  if (!acc) return null;
  const videos = await ctx.db
    .query("radarTrackedVideos")
    .withIndex("by_account_published", (q) => q.eq("accountId", accountId))
    .order("desc")
    .take(CREATOR_VIDEOS_CAP);
  // Ses signaux, par le lien au compte (son pseudo a pu changer depuis) : miniature, visibilité.
  const signals = await ctx.db
    .query("radarSignals")
    .withIndex("by_tracked", (q) => q.eq("trackedAccountId", accountId))
    .take(CREATOR_VIDEOS_CAP);
  return {
    videos: creatorVideos(
      acc.handle,
      videos,
      signals.map((s) => ({
        videoId: s.videoId,
        ...(s.platform === "instagram" ? { platform: "instagram" as const } : {}),
        publishedAt: s.publishedAt,
        views: s.views,
        caption: s.caption,
        ...(s.hook ? { hook: s.hook } : {}),
        url: s.url,
        ...(s.coverUrl ? { coverUrl: s.coverUrl } : {}),
        ...(s.unavailable ? { unavailable: s.unavailable } : {}),
      })),
      (views) => multiplierOf(views, acc.medianViews) ?? null,
    ),
    // La fiche s'arrête aux 200 plus récentes : au-delà, elle le dit.
    truncated: videos.length === CREATOR_VIDEOS_CAP,
  };
}

export const creatorVideosOf = permissionQuery("radar.use")({
  args: { accountId: v.id("radarTracked") },
  handler: (ctx, args) => creatorVideosCore(ctx, args),
});
