import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { MARKET_CURRENCY } from "./radarMarketMath";
import { MEDIAN_WINDOW, videoCitesApp } from "./radarNetworkMath";
import { storeUrl } from "./radarStoreMath";
import { proofDetail, type ProofDetail } from "./radarVetMath";

/**
 * Les pages de l'export vers Swarm (convex/swarmExport) : ce qui part de chaque table, réduit et filtré. À part des
 * fonctions Convex pour se rejouer sur un export de la prod (rien ici ne dépend de l'authentification).
 */

export const TABLES = ["apps", "tracked", "trackedVideos", "formats", "signals"] as const;
export type ExportTable = (typeof TABLES)[number];

/**
 * Taille d'une page : assez petite pour rester loin des limites d'une requête (transcriptions des signaux). Pour
 * `tracked`, ce sont des comptes dont chacun fait lire ses 30 dernières vidéos (sa preuve). Swarm lit au plus 500
 * pages par table : 1 000 vidéos par page tiennent 500 000 vidéos.
 */
const PAGE: Record<ExportTable, number> = { apps: 200, tracked: 200, trackedVideos: 1000, formats: 200, signals: 200 };
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

function projectTracked(t: Doc<"radarTracked">, proof: ProofDetail | null) {
  return {
    id: t._id,
    handle: t.handle,
    appId: t.appId,
    status: t.status,
    // Comment il est entré (« seed » : liste de départ, « manual » : à la main, « caption » : trouvé par une vidéo)
    // et ce qui le relie à son app aujourd'hui, sur ses 30 dernières vidéos rangées.
    matchedBy: t.matchedBy,
    proofAt: t.proofAt ?? null,
    proof,
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

function projectTrackedVideo(x: Doc<"radarTrackedVideos">, cites: boolean | null) {
  return {
    id: x._id,
    cites,
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

function projectFormat(f: Doc<"radarFormats">, members: Doc<"radarFormats">["members"]) {
  return {
    id: f._id,
    kind: f.kind,
    key: f.key,
    label: f.label,
    members,
    // Recalculés sur les reprises des comptes suivis : un format ne se montre plus sous une app dont il n'a plus
    // aucune reprise (Swarm range les formats d'une fiche d'app par ces apps).
    accountCount: new Set(members.map((m) => m.accountId)).size,
    appIds: [...new Set(members.map((m) => m.appId))],
    maxViews: members.length ? Math.max(...members.map((m) => m.views)) : 0,
    lastPostAt: members.length ? Math.max(...members.map((m) => m.publishedAt)) : f.lastPostAt,
    firstSeenAt: f.firstSeenAt,
    lang: f.lang ?? null,
  };
}

function projectSignal(s: Doc<"radarSignals">, app: Doc<"radarApps"> | null) {
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
    // L'app d'un signal n'est gardée que si elle est suivie (ou fondue dans une app suivie).
    appId: app?._id ?? null,
    appName: app ? (s.appName ?? app.name) : null,
    cites: app ? videoCitesApp({ caption: s.caption, hook: s.hook, transcript: s.transcript, handle: s.authorHandle }, app) : null,
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

/** Les vidéos rangées d'un compte, les plus récentes d'abord. */
const videosOf = (ctx: QueryCtx, accountId: Id<"radarTracked">, n: number) =>
  ctx.db.query("radarTrackedVideos").withIndex("by_account_published", (q) => q.eq("accountId", accountId)).order("desc").take(n);

/** Le compte d'une ligne s'il est encore suivi (sinon `null`), relu au plus une fois par page. */
function activeAccounts(ctx: QueryCtx) {
  const seen = new Map<Id<"radarTracked">, Doc<"radarTracked"> | null>();
  return async (id: Id<"radarTracked">): Promise<Doc<"radarTracked"> | null> => {
    let acc = seen.get(id);
    if (acc === undefined) {
      const got = await ctx.db.get(id);
      acc = got?.status === "active" ? got : null;
      seen.set(id, acc);
    }
    return acc;
  };
}

/** La page `cursor` (null = la première) d'une table de l'export, réduite à ce que Swarm affiche. */
export async function exportPage(ctx: QueryCtx, table: ExportTable, cursor: string | null) {
  const opts = { cursor, numItems: PAGE[table] };
  const apps = new Map((await ctx.db.query("radarApps").collect()).map((a) => [a._id, a]));
  switch (table) {
    case "apps": {
      const r = await ctx.db.query("radarApps").paginate(opts);
      return { rows: r.page.map(projectApp), cursor: r.continueCursor, done: r.isDone };
    }
    case "tracked": {
      // Les comptes actifs seulement, chacun avec ce qui le relie à son app (ses 30 dernières vidéos rangées).
      const r = await ctx.db.query("radarTracked").paginate(opts);
      const rows = [];
      for (const t of r.page) {
        if (t.status !== "active") continue;
        const app = apps.get(t.appId);
        const texts = (await videosOf(ctx, t._id, MEDIAN_WINDOW)).filter((x) => !x.platform).map((x) => `${x.caption ?? ""} ${x.hook ?? ""}`);
        rows.push(projectTracked(t, app ? proofDetail(t.handle, t.bio, texts, app, t.matchedBy) : null));
      }
      return { rows, cursor: r.continueCursor, done: r.isDone };
    }
    case "trackedVideos": {
      // Les vidéos des comptes actifs, et si chacune cite l'app sous laquelle elle est rangée.
      const r = await ctx.db.query("radarTrackedVideos").paginate(opts);
      const accountOf = activeAccounts(ctx);
      const rows = [];
      for (const x of r.page) {
        const t = await accountOf(x.accountId);
        if (!t) continue;
        const app = apps.get(x.appId);
        rows.push(projectTrackedVideo(x, app ? videoCitesApp({ caption: x.caption ?? "", hook: x.hook, handle: t.handle }, app) : null));
      }
      return { rows, cursor: r.continueCursor, done: r.isDone };
    }
    case "formats": {
      // Les reprises des comptes encore suivis seulement.
      const r = await ctx.db.query("radarFormats").paginate(opts);
      const isActive = activeAccounts(ctx);
      const rows = [];
      for (const f of r.page) {
        const members = [];
        for (const m of f.members) if (await isActive(m.accountId)) members.push(m);
        rows.push(projectFormat(f, members));
      }
      return { rows, cursor: r.continueCursor, done: r.isDone };
    }
    case "signals": {
      // Pas les signaux d'un compte en pause ; l'app d'un signal, seulement si elle est suivie (ou fondue).
      const r = await ctx.db.query("radarSignals").paginate(opts);
      const isActive = activeAccounts(ctx);
      const rows = [];
      for (const s of r.page) {
        if (s.trackedAccountId && !(await isActive(s.trackedAccountId))) continue;
        const app = s.appId ? apps.get(s.appId) : undefined;
        rows.push(projectSignal(s, app && (app.status === "active" || app.mergedInto) ? app : null));
      }
      return { rows, cursor: r.continueCursor, done: r.isDone };
    }
  }
}
