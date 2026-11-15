import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { MARKET_CURRENCY } from "./radarMarketMath";
import { citesNormalized, MEDIAN_WINDOW, normalize, videoCitesApp } from "./radarNetworkMath";
import { storeUrl } from "./radarStoreMath";
import { proofDetail, VET_MIN_VIDEOS } from "./radarVetMath";

/**
 * Les pages de l'export vers Swarm (convex/swarmExport) : ce qui part de chaque table, réduit et filtré. À part des
 * fonctions Convex pour se rejouer sur un export de la prod (rien ici ne dépend de l'authentification).
 */

export const TABLES = ["apps", "tracked", "trackedVideos", "formats", "signals"] as const;
export type ExportTable = (typeof TABLES)[number];

/**
 * Taille d'une page : assez petite pour rester loin des limites d'une requête (transcriptions des signaux). Pour
 * `tracked`, ce sont des comptes dont chacun fait lire ses 30 dernières vidéos (ce qui le relie à son app). Swarm lit au plus 500
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
    // À l'essai (radarAuto.settleTrials) : pas encore prouvée, Swarm ne la montre pas.
    status: a.trialSince !== undefined ? ("paused" as const) : a.status,
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
    // Ce qu'est le produit d'après l'IA (radarJudge) : app, saas, jeu_mobile… ; `null` tant qu'elle n'est pas jugée.
    // Les apps hors périmètre (ni app, ni SaaS, ni jeu mobile) sont en pause dans le Radar : Swarm ne les montre pas.
    kind: a.nature?.kind ?? null,
  };
}

/**
 * Un compte suivi, tel que Swarm le reçoit. La JUSTIFICATION d'un compte (comment il est entré, ce qui le relie à son
 * app : `matchedBy`, `proofAt`, preuve par pseudo, bio ou vidéos) reste interne au Radar — décision du 14/11/2026 :
 * elle ne part plus. Un compte que plus rien ne relie à son app part « en pause » (cf `exportPage`).
 */
function projectTracked(t: Doc<"radarTracked">) {
  return {
    id: t._id,
    handle: t.handle,
    appId: t.appId,
    status: t.status,
    // Placement payé (jugement de l'IA) : pas un créateur de l'app, mais ses vidéos qui la citent comptent dans ses
    // vues, étiquetées « placement payé » (définition du fondateur, 14/11/2026).
    placement: t.placement === true,
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

/**
 * Une vidéo d'un compte suivi, telle que Swarm la reçoit. Sans `id`, `hookKey`, `coverUrl` ni `lastSeenAt` depuis le
 * 15/11/2026 (demande de Swarm) : il ne s'en sert pas, et ils faisaient 38 % du JSON (29 Mo sur 76, dont 24 pour les
 * miniatures, que Swarm recopie depuis la page publique de la vidéo).
 */
function projectTrackedVideo(x: Doc<"radarTrackedVideos">, cites: boolean | null) {
  return {
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
    musicTitle: x.musicTitle ?? null,
    region: x.region ?? null,
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


/** Le compte d'une ligne s'il est encore suivi (sinon `null`), relu au plus une fois par page. */
function activeAccounts(ctx: QueryCtx, apps: AppsById) {
  const seen = new Map<Id<"radarTracked">, Doc<"radarTracked"> | null>();
  return async (id: Id<"radarTracked">): Promise<Doc<"radarTracked"> | null> => {
    let acc = seen.get(id);
    if (acc === undefined) {
      const got = await ctx.db.get(id);
      acc = got?.status === "active" && appShown(apps, got.appId) !== "hidden" ? got : null;
      seen.set(id, acc);
    }
    return acc;
  };
}

type AppsById = Map<Id<"radarApps">, Doc<"radarApps">>;

/**
 * Ce que Swarm montre d'une app (15/11/2026, « Oui, retire-les », fondateur) : `hidden` pour une app EN PAUSE (hors
 * périmètre, essai raté…) ou À L'ESSAI — ni ses comptes, ni leurs vidéos, ni leurs signaux, ni leurs reprises ne
 * partent ; jusque-là, 114 créateurs d'apps hors périmètre (Hipobuy, Meta-Klage, Arkose+) s'affichaient dans Swarm
 * sans fiche d'app. Une app fondue vaut la vraie ; une app inconnue (`unknown`) garde la règle d'avant.
 */
export function appShown(apps: AppsById, id: Id<"radarApps"> | undefined): "shown" | "hidden" | "unknown" {
  let app = id ? apps.get(id) : undefined;
  if (app?.mergedInto) app = apps.get(app.mergedInto);
  if (!app) return "unknown";
  return app.status === "active" && app.trialSince === undefined ? "shown" : "hidden";
}

/**
 * Le compte est-il relié à son app par sa preuve ? Le même verdict que `proofDetail` sur ses 30 dernières vidéos, lu
 * au plus court (15/11/2026 : les 88 pages de `tracked` prenaient 69 s en prod) : pseudo, bio, ajout à la main ou liste
 * de départ, sans lire une vidéo ; sinon ses vidéos, des plus récentes aux plus anciennes, jusqu'à la deuxième qui
 * cite l'app (`VET_MIN_VIDEOS` : prouvé quelle que soit la suite) ; le reste, comme avant, sur les 30.
 */
async function provenForExport(ctx: QueryCtx, t: Doc<"radarTracked">, app: Doc<"radarApps">): Promise<boolean> {
  if (proofDetail(t.handle, t.bio, [], app, t.matchedBy).by !== null) return true;
  const texts: string[] = [];
  let read = 0;
  let cites = 0;
  for await (const x of ctx.db.query("radarTrackedVideos").withIndex("by_account_published", (q) => q.eq("accountId", t._id)).order("desc")) {
    if (read++ >= MEDIAN_WINDOW) break;
    if (x.platform) continue;
    const text = `${x.caption ?? ""} ${x.hook ?? ""}`;
    texts.push(text);
    if (citesNormalized(normalize(text), app) && ++cites >= VET_MIN_VIDEOS) return true;
  }
  return proofDetail(t.handle, t.bio, texts, app, t.matchedBy).by !== null;
}

/** Apps par appel de l'export filtré (`apps`). */
export const EXPORT_MAX_APPS = 500;

/**
 * Le curseur de l'export filtré par apps : l'app où il en est (`i`, dans la liste reçue) et le curseur DANS cette app
 * (`c`). Une page ne lit qu'une app ; la suivante reprend où elle s'est arrêtée, puis passe à l'app d'après.
 */
type AppsCursor = { i: number; c: string | null };
const readAppsCursor = (cursor: string | null): AppsCursor => {
  if (!cursor) return { i: 0, c: null };
  const x = JSON.parse(cursor) as Partial<AppsCursor>;
  return { i: typeof x.i === "number" && x.i >= 0 ? Math.floor(x.i) : 0, c: typeof x.c === "string" ? x.c : null };
};

/**
 * La page `cursor` (null = la première) d'une table de l'export, réduite à ce que Swarm affiche. `appIds` (tables
 * `tracked` et `trackedVideos` seulement) : les lignes rangées sous ces apps, et elles seules — une app fondue
 * (`mergedInto`) n'est pas remplacée par la vraie : Swarm passe lui-même les ids fondus avec la vraie.
 */
export async function exportPage(ctx: QueryCtx, table: ExportTable, cursor: string | null, appIds?: readonly Id<"radarApps">[]) {
  if (appIds && table !== "tracked" && table !== "trackedVideos") throw new Error(`le filtre par apps ne vaut que pour tracked et trackedVideos, pas ${table}`);
  if (appIds && appIds.length > EXPORT_MAX_APPS) throw new Error(`${EXPORT_MAX_APPS} apps au plus par appel`);
  const at = appIds ? readAppsCursor(cursor) : null;
  if (appIds && at && at.i >= appIds.length) return { rows: [], cursor: JSON.stringify(at), done: true };
  const opts = { cursor: at ? at.c : cursor, numItems: PAGE[table] };
  // Ce qu'on rend d'une page lue : son curseur, simple ou par apps.
  const after = (r: { continueCursor: string; isDone: boolean }) => {
    if (!appIds || !at) return { cursor: r.continueCursor, done: r.isDone };
    const next: AppsCursor = r.isDone ? { i: at.i + 1, c: null } : { i: at.i, c: r.continueCursor };
    return { cursor: JSON.stringify(next), done: r.isDone && at.i + 1 >= appIds.length };
  };
  const apps = new Map((await ctx.db.query("radarApps").collect()).map((a) => [a._id, a]));
  switch (table) {
    case "apps": {
      const r = await ctx.db.query("radarApps").paginate(opts);
      return { rows: r.page.map(projectApp), cursor: r.continueCursor, done: r.isDone };
    }
    case "tracked": {
      // Les comptes actifs, la preuve elle-même jamais (pseudo, bio, vidéos, liste de départ, ajout à la main, sur ses
      // 30 dernières vidéos rangées).
      const r = at
        ? await ctx.db.query("radarTracked").withIndex("by_app", (q) => q.eq("appId", appIds![at.i])).paginate(opts)
        : await ctx.db.query("radarTracked").paginate(opts);
      const rows = [];
      for (const t of r.page) {
        if (t.status !== "active") continue;
        if (appShown(apps, t.appId) === "hidden") continue;
        const app = apps.get(t.appId);
        // Relié à son app : par sa preuve, par un placement payé (il cite peu son app par nature, mais sa vidéo compte et
        // s'étiquette), ou parce que l'IA (v2, JUDGE_VERSION) dit qu'il la pousse. Sinon il part « en pause » : pas un
        // créateur pour Swarm, qui ne liste que les comptes actifs, mais ses vidéos gardent leur pseudo et leur lien
        // (#513). Aucune justification ne part.
        // Le « pousse » RELU et appliqué seulement (radarJudgeReview) : celui de l'IA seule ne relie plus rien (15/11/2026).
        // Du moins cher au plus cher : rien à lire, puis ses jugements, puis ses vidéos.
        const reviewed = async (a: Doc<"radarApps">) =>
          (await ctx.db.query("radarAccountJudgments").withIndex("by_account", (q) => q.eq("accountId", t._id)).collect()).some((j) => j.appId === a._id && j.reviewed === "pousse");
        const linked = !app || t.placement === true || (await reviewed(app)) || (await provenForExport(ctx, t, app));
        rows.push(linked ? projectTracked(t) : { ...projectTracked(t), status: "paused" as const });
      }
      return { rows, ...after(r) };
    }
    case "trackedVideos": {
      // Les vidéos des comptes actifs, et si chacune cite l'app sous laquelle elle est rangée.
      const r = at
        ? await ctx.db.query("radarTrackedVideos").withIndex("by_app", (q) => q.eq("appId", appIds![at.i])).paginate(opts)
        : await ctx.db.query("radarTrackedVideos").paginate(opts);
      const accountOf = activeAccounts(ctx, apps);
      const rows = [];
      for (const x of r.page) {
        const t = await accountOf(x.accountId);
        if (!t) continue;
        const app = apps.get(x.appId);
        rows.push(projectTrackedVideo(x, app ? videoCitesApp({ caption: x.caption ?? "", hook: x.hook, handle: t.handle }, app) : null));
      }
      return { rows, ...after(r) };
    }
    case "formats": {
      // Les reprises des comptes encore suivis seulement.
      const r = await ctx.db.query("radarFormats").paginate(opts);
      const isActive = activeAccounts(ctx, apps);
      const rows = [];
      for (const f of r.page) {
        const members = [];
        for (const m of f.members) if (await isActive(m.accountId)) members.push(m);
        rows.push(projectFormat(f, members));
      }
      return { rows, cursor: r.continueCursor, done: r.isDone };
    }
    case "signals": {
      // Pas les signaux d'un compte en pause ni d'une app cachée (en pause, à l'essai) ; l'app d'un signal, seulement si
      // elle est suivie (ou fondue).
      const r = await ctx.db.query("radarSignals").paginate(opts);
      const isActive = activeAccounts(ctx, apps);
      const rows = [];
      for (const s of r.page) {
        if (s.trackedAccountId && !(await isActive(s.trackedAccountId))) continue;
        if (s.appId && appShown(apps, s.appId) === "hidden") continue;
        const app = s.appId ? apps.get(s.appId) : undefined;
        rows.push(projectSignal(s, app && (app.status === "active" || app.mergedInto) ? app : null));
      }
      return { rows, cursor: r.continueCursor, done: r.isDone };
    }
  }
}
