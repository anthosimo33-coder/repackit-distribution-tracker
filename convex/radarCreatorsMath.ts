/**
 * NOUVEAU RADAR — CRÉATEURS : les comptes suivis vus comme des personnes à
 * contacter. Règles pures (les lectures sont dans convex/radarCreators).
 *
 * Demande du 11/11/2026 : « la liste des créatrices françaises qu'on trouve, un
 * onglet où je peux voir tous leurs TikToks que le Radar a chopés, comme ça je
 * peux les DM après ». Ce jour-là, 127 comptes suivis actifs publient en
 * français (Retain Cards 30, Astra AI 21, Snitchy 15, The Ick 12…), presque
 * tous des ambassadrices d'une autre app : ce sont elles, la liste.
 *
 * La langue est celle que TikTok donne aux légendes du compte (la plus fréquente
 * de son dernier relevé, `radarTracked.lang`) ; quand TikTok n'en donne aucune,
 * celle du texte à l'écran de ses vidéos (convex/radarTextLang) ; et celle
 * déclarée à la main l'emporte (radarSeedAccounts.LANG_BY_HAND). Les auteurs des vidéos trouvées
 * par la recherche (une vingtaine en français) n'y sont pas : ce sont des vidéos
 * virales sans rapport avec une app, pas des créatrices à recruter.
 */
import type { UnavailableReason } from "./radarAvailabilityMath";

/** Les langues qu'on peut choisir : celles d'un compte (radarSignalsMath.langBucket), sans « autre ». */
export const CREATOR_LANGS = ["fr", "en", "es-am", "es-es", "pt"] as const;
export type CreatorLang = (typeof CREATOR_LANGS)[number];
export const DEFAULT_CREATOR_LANG: CreatorLang = "fr";

/**
 * Les tris. « median » d'abord : ce qu'une vidéo du compte fait d'habitude dit
 * mieux ce qu'on recrute que ses abonnés (des comptes d'ambassadrice de 30
 * abonnés font 800 vues par vidéo) ou qu'un coup isolé.
 */
export const CREATOR_SORTS = ["median", "fans", "recent", "posts"] as const;
export type CreatorSort = (typeof CREATOR_SORTS)[number];
export const DEFAULT_CREATOR_SORT: CreatorSort = "median";

export type CreatorRow = {
  handle: string;
  bio: string | null;
  app: string | null;
  /** L'app qu'il pousse est une concurrente du projet. */
  rival: boolean;
  fans: number;
  medianViews: number | null;
  posts7d: number;
  lastPostAt: number | null;
};

const byHandle = (a: CreatorRow, b: CreatorRow) => a.handle.localeCompare(b.handle);

const ORDER: Record<CreatorSort, (a: CreatorRow, b: CreatorRow) => number> = {
  // Sans médiane (trop peu de vidéos lues), un compte passe après ceux qu'on sait juger.
  median: (a, b) => (b.medianViews ?? -1) - (a.medianViews ?? -1) || b.fans - a.fans || byHandle(a, b),
  fans: (a, b) => b.fans - a.fans || byHandle(a, b),
  recent: (a, b) => (b.lastPostAt ?? 0) - (a.lastPostAt ?? 0) || byHandle(a, b),
  posts: (a, b) => b.posts7d - a.posts7d || (b.lastPostAt ?? 0) - (a.lastPostAt ?? 0) || byHandle(a, b),
};

export function sortCreators<T extends CreatorRow>(rows: readonly T[], sort: CreatorSort): T[] {
  return [...rows].sort(ORDER[sort]);
}

/**
 * Les créateurs d'une app (ou de toutes : `app` null) dont le pseudo, la bio ou
 * l'app contient la recherche. Un « @ » en tête de recherche est ignoré.
 */
export function filterCreators<T extends CreatorRow>(rows: readonly T[], { app, q }: { app: string | null; q: string }): T[] {
  const needle = q.trim().replace(/^@+/, "").toLowerCase();
  return rows.filter((r) => {
    if (app !== null && r.app !== app) return false;
    return !needle || `${r.handle} ${r.bio ?? ""} ${r.app ?? ""}`.toLowerCase().includes(needle);
  });
}

/** Les apps du filtre, avec leur nombre de créateurs : les concurrentes du projet d'abord, puis les plus fournies. */
export function appOptions(rows: readonly CreatorRow[]): { name: string; rival: boolean; count: number }[] {
  const by = new Map<string, { name: string; rival: boolean; count: number }>();
  for (const r of rows) {
    if (r.app === null) continue;
    const o = by.get(r.app) ?? { name: r.app, rival: r.rival, count: 0 };
    o.count++;
    by.set(r.app, o);
  }
  return [...by.values()].sort((a, b) => Number(b.rival) - Number(a.rival) || b.count - a.count || a.name.localeCompare(b.name));
}

// ─── Les TikToks d'un créateur ───────────────────────────────────────────────

/** Vidéos montrées dans la fiche d'un créateur, les plus récentes d'abord. */
export const CREATOR_VIDEOS_CAP = 200;

type Unavailable = { reason: UnavailableReason; at: number };
/** Une vidéo relevée de son compte (radarTrackedVideos). */
export type TrackedVideoLite = { videoId: string; platform?: "instagram"; publishedAt: number; views: number; caption?: string; hook?: string };
/** Un signal de son compte (radarSignals) : il porte la miniature, et ce que le contrôle de visibilité a constaté. */
export type CreatorSignalLite = TrackedVideoLite & { url: string; coverUrl?: string; unavailable?: Unavailable };

export type CreatorVideo = {
  videoId: string;
  url: string;
  publishedAt: number;
  views: number;
  hook: string | null;
  caption: string | null;
  /** Vues ÷ ce que le compte fait d'habitude ; null tant qu'on ne connaît pas sa normale. */
  multiplier: number | null;
  coverUrl: string | null;
  unavailable: Unavailable | null;
};

/**
 * Tous les TikToks qu'on a d'un compte, les plus récents d'abord : ses vidéos
 * relevées, plus les signaux qui n'en font pas partie (une vidéo trouvée par la
 * recherche avant que le compte soit suivi). Les Reels Instagram n'y sont pas.
 *  - Le signal d'une vidéo lui donne sa miniature, et ses vues si elles sont plus
 *    fraîches (sa courbe est relevée plus souvent que le compte).
 *  - Un compte passé en privé l'est pour TOUTES ses vidéos : le constat fait sur
 *    un signal vaut pour celles qui n'en ont pas.
 * `score` donne le multiple d'une vidéo (radarNetworkMath.multiplierOf sur la
 * médiane du compte) : passé par l'appelant, pour que l'écran, qui importe ce
 * module pour ses tris, n'embarque pas les règles des apps suivies.
 */
export function creatorVideos(
  handle: string,
  videos: readonly TrackedVideoLite[],
  signals: readonly CreatorSignalLite[],
  score: (views: number) => number | null,
): CreatorVideo[] {
  const sigs = new Map(signals.map((s) => [s.videoId, s]));
  const priv = [...sigs.values()]
    .map((s) => s.unavailable)
    .filter((u): u is Unavailable => u?.reason === "private")
    .sort((a, b) => b.at - a.at)[0];
  const known = new Set<string>();
  const out: CreatorVideo[] = [];
  const push = (v: TrackedVideoLite, sig: CreatorSignalLite | undefined) => {
    if (v.platform === "instagram" || known.has(v.videoId)) return;
    known.add(v.videoId);
    const views = Math.max(v.views, sig?.views ?? 0);
    out.push({
      videoId: v.videoId,
      url: sig?.url ?? `https://www.tiktok.com/@${handle}/video/${v.videoId}`,
      publishedAt: v.publishedAt,
      views,
      hook: v.hook ?? sig?.hook ?? null,
      caption: v.caption ?? sig?.caption ?? null,
      multiplier: score(views),
      coverUrl: sig?.coverUrl ?? null,
      unavailable: sig?.unavailable ?? priv ?? null,
    });
  };
  for (const v of videos) push(v, sigs.get(v.videoId));
  for (const s of sigs.values()) push(s, s);
  return out.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, CREATOR_VIDEOS_CAP);
}

// ─── Vidéos gardées ──────────────────────────────────────────────────────────

/** Vidéos gardées montrées au plus (les dernières gardées d'abord). */
export const KEPT_CAP = 300;

/** Les statuts « gardée » d'un projet à montrer : les derniers posés d'abord. */
export function keptFirst<T extends { updatedAt: number }>(marks: readonly T[]): T[] {
  return [...marks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, KEPT_CAP);
}
