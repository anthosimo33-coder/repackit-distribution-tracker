import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { httpAction, internalQuery } from "./_generated/server";
import { MARKET_CURRENCY } from "./radarMarketMath";
import { storeUrl } from "./radarStoreMath";

/**
 * Export du Radar vers Swarm (le SaaS de veille, projet Convex à part).
 *
 * Swarm ne lit jamais la base de Jarvia : une fois par jour, après le relevé, sa
 * synchronisation appelle GET /swarm/export?table=…&cursor=… page par page, avec
 * la clé partagée SWARM_EXPORT_SECRET (posée sur les deux déploiements, jamais
 * affichée). Lecture seule ; chaque table est réduite aux champs que Swarm affiche.
 */

const TABLES = ["apps", "tracked", "trackedVideos", "formats", "signals"] as const;
type ExportTable = (typeof TABLES)[number];

/** Taille d'une page : assez petite pour rester loin des limites d'une requête (transcriptions des signaux). */
const PAGE: Record<ExportTable, number> = { apps: 200, tracked: 500, trackedVideos: 1000, formats: 200, signals: 200 };
/** Les derniers relevés de vues d'une vidéo suffisent à Swarm (courbe et accélération). */
const SNAPSHOTS = 12;

const lastSnapshots = (s: { at: number; views: number }[]) => s.slice(-SNAPSHOTS);

function projectApp(a: Doc<"radarApps">) {
  return {
    id: a._id,
    slug: a.slug,
    name: a.name,
    status: a.status,
    trackedCount: a.trackedCount ?? null,
    mergedInto: a.mergedInto ?? null,
    createdAt: a.createdAt,
    // Sa fiche (convex/radarFiche) : niche et phrase (« hand » = niche posée à la main), fiche App Store,
    // ce que ses campagnes paient (montants en cents de `currency`), pays de ses comptes actifs.
    niche: a.niche ?? null,
    nicheBy: a.nicheBy ?? null,
    pitch: a.pitch ?? null,
    store: a.store ? { ...a.store, url: storeUrl(a.store.storeId) } : null,
    market: a.market ? { ...a.market, rateCents: a.market.rateCents ?? null, about: a.market.about ?? null, currency: MARKET_CURRENCY } : null,
    countries: a.net?.countries ?? [],
  };
}

function projectTracked(t: Doc<"radarTracked">) {
  return {
    id: t._id,
    handle: t.handle,
    appId: t.appId,
    status: t.status,
    fans: t.fans,
    bio: t.bio ?? null,
    lang: t.lang ?? null,
    // Le pays d'où il publie (ISO 3166, deux lettres) : le plus fréquent parmi ses vidéos relevées.
    country: t.country ?? null,
    medianViews: t.medianViews ?? null,
    videosSeen: t.videosSeen,
    lastPostAt: t.lastPostAt ?? null,
    posts7d: t.posts7d ?? null,
    best7d: t.best7d ?? null,
    igHandle: t.igHandle ?? null,
    igFans: t.igFans ?? null,
    igMedianViews: t.igMedianViews ?? null,
    igPosts7d: t.igPosts7d ?? null,
    readAt: t.readAt ?? null,
    addedAt: t.addedAt,
  };
}

function projectTrackedVideo(x: Doc<"radarTrackedVideos">) {
  return {
    id: x._id,
    accountId: x.accountId,
    appId: x.appId,
    platform: x.platform ?? "tiktok",
    videoId: x.videoId,
    publishedAt: x.publishedAt,
    views: x.views,
    snapshots: lastSnapshots(x.snapshots),
    caption: x.caption ?? null,
    hook: x.hook ?? null,
    hookKey: x.hookKey ?? null,
    musicTitle: x.musicTitle ?? null,
    coverUrl: x.coverUrl ?? null,
    region: x.region ?? null,
    lastSeenAt: x.lastSeenAt,
  };
}

function projectFormat(f: Doc<"radarFormats">) {
  return {
    id: f._id,
    kind: f.kind,
    key: f.key,
    label: f.label,
    members: f.members,
    accountCount: f.accountCount,
    appIds: f.appIds,
    maxViews: f.maxViews,
    lastPostAt: f.lastPostAt,
    firstSeenAt: f.firstSeenAt,
    lang: f.lang ?? null,
  };
}

function projectSignal(s: Doc<"radarSignals">) {
  return {
    id: s._id,
    platform: s.platform,
    videoId: s.videoId,
    url: s.url,
    authorHandle: s.authorHandle,
    authorFans: s.authorFans,
    caption: s.caption,
    lang: s.lang,
    region: s.region ?? null,
    publishedAt: s.publishedAt,
    durationSec: s.durationSec ?? null,
    coverUrl: s.coverUrl ?? null,
    views: s.views,
    likes: s.likes,
    comments: s.comments,
    shares: s.shares,
    saves: s.saves,
    ratio: s.ratio,
    snapshots: lastSnapshots(s.snapshots),
    appId: s.appId ?? null,
    appName: s.appName ?? null,
    trackedAccountId: s.trackedAccountId ?? null,
    multiplier: s.multiplier ?? null,
    hook: s.hook ?? null,
    musicTitle: s.musicTitle ?? null,
    transcript: s.transcript ?? null,
    unavailable: s.unavailable?.reason ?? null,
    firstSeenAt: s.firstSeenAt,
    lastSeenAt: s.lastSeenAt,
  };
}

/** Une page d'une table, réduite. `cursor` null = première page. */
export const page = internalQuery({
  args: { table: v.union(...TABLES.map((t) => v.literal(t))), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: PAGE[table] };
    switch (table) {
      case "apps": {
        const r = await ctx.db.query("radarApps").paginate(opts);
        return { rows: r.page.map(projectApp), cursor: r.continueCursor, done: r.isDone };
      }
      case "tracked": {
        const r = await ctx.db.query("radarTracked").paginate(opts);
        return { rows: r.page.map(projectTracked), cursor: r.continueCursor, done: r.isDone };
      }
      case "trackedVideos": {
        const r = await ctx.db.query("radarTrackedVideos").paginate(opts);
        return { rows: r.page.map(projectTrackedVideo), cursor: r.continueCursor, done: r.isDone };
      }
      case "formats": {
        const r = await ctx.db.query("radarFormats").paginate(opts);
        return { rows: r.page.map(projectFormat), cursor: r.continueCursor, done: r.isDone };
      }
      case "signals": {
        const r = await ctx.db.query("radarSignals").paginate(opts);
        return { rows: r.page.map(projectSignal), cursor: r.continueCursor, done: r.isDone };
      }
    }
  },
});

/** Comparaison en temps constant : la durée ne dit rien de la clé. */
function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** GET /swarm/export?table=apps|tracked|trackedVideos|formats|signals&cursor=… — Authorization: Bearer <SWARM_EXPORT_SECRET>. */
export const exportHandler = httpAction(async (ctx, request) => {
  const secret = process.env.SWARM_EXPORT_SECRET;
  if (!secret || secret.length < 32) return json(503, { error: "export non configuré" });
  const header = request.headers.get("Authorization") ?? "";
  if (!sameSecret(header, `Bearer ${secret}`)) return json(401, { error: "non autorisé" });

  const url = new URL(request.url);
  const table = url.searchParams.get("table");
  if (!TABLES.includes(table as ExportTable)) return json(400, { error: `table attendue : ${TABLES.join(", ")}` });
  const cursor = url.searchParams.get("cursor") || null;
  const result = await ctx.runQuery(internal.swarmExport.page, { table: table as ExportTable, cursor });
  return json(200, result);
});
