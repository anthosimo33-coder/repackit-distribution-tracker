/**
 * RADAR — couche API Apify (TikTok) pour la Brique 1 (vidéos d'un compte favori).
 * Appel réseau externe → DESTINÉ à être appelé depuis une action Convex
 * (convex/radar.ts) : `fetch` n'est dispo que dans le runtime action. Calqué sur
 * convex/apifyApi.ts.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. `toCount` / `cleanText` /
 * `normalizeTikTokHandle` / `computeEngagement` / `toRadarDateFilter` /
 * `parseRadarVideos` sont des RÉPLIQUES À L'IDENTIQUE de lib/radarParsing.ts (où
 * vivent les tests Vitest). Toute évolution doit être faite des DEUX côtés.
 *
 * Source : clockworks/tiktok-scraper appelé en input PROFIL :
 *   { profiles:[handle], resultsPerPage, profileSorting:"latest",
 *     oldestPostDateUnified?: "YYYY-MM-DD" }  ← filtre date incrémental.
 * Endpoint REST « run-sync-get-dataset-items » (lance + attend + renvoie les
 * items). Token via header Authorization Bearer — JAMAIS dans l'URL, JAMAIS logué.
 */

const APIFY_ACTS_BASE = "https://api.apify.com/v2/acts";

/** Actor TikTok (slug `owner~name`). Overridable par env (swap sans redeploy). */
const DEFAULT_TIKTOK_ACTOR = "clockworks~tiktok-scraper";

/** Timeout (s) passé au run Apify — borne un run qui patine (profil lent). */
const RUN_TIMEOUT_SECS = 120;

// ─── Répliques pures (lib/radarParsing.ts) ───────────────────────────────────

/** "123" → 123 ; nombre fini → lui-même ; tout le reste → null. */
function toCount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Texte propre : trim, null si vide, tronqué à `max`. */
function cleanText(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "") return null;
  return t.length > max ? t.slice(0, max) : t;
}

/** Parse tolérante d'une URL : accepte l'absence de scheme. null si illisible. */
function parseUrl(input: string): URL | null {
  const raw = input.trim();
  try {
    return new URL(raw);
  } catch {
    try {
      return new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }
}

const HANDLE_RE = /^[a-z0-9._]{1,24}$/;
const URL_HANDLE_RE = /@([a-zA-Z0-9._]{1,24})/;

/** Réplique de lib/radarParsing.normalizeTikTokHandle — cf tests Vitest là-bas. */
export function normalizeTikTokHandle(
  input: string | null | undefined,
): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const looksLikeUrl =
    /tiktok\.com/i.test(trimmed) || /^https?:\/\//i.test(trimmed);
  if (looksLikeUrl) {
    const url = parseUrl(trimmed);
    if (!url) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "tiktok.com" && !host.endsWith(".tiktok.com")) return null;
    const m = URL_HANDLE_RE.exec(url.pathname);
    if (!m) return null;
    const handle = m[1].toLowerCase();
    return HANDLE_RE.test(handle) ? handle : null;
  }

  const handle = (
    trimmed.startsWith("@") ? trimmed.slice(1) : trimmed
  ).toLowerCase();
  return HANDLE_RE.test(handle) ? handle : null;
}

/** Réplique de lib/radarParsing.computeEngagement — cf tests Vitest là-bas. */
export function computeEngagement(
  views: number,
  likes: number,
  comments: number,
  shares: number,
): number {
  if (!Number.isFinite(views) || views <= 0) return 0;
  const interactions =
    (Number.isFinite(likes) ? likes : 0) +
    (Number.isFinite(comments) ? comments : 0) +
    (Number.isFinite(shares) ? shares : 0);
  const ratio = interactions / views;
  return ratio > 0 ? ratio : 0;
}

/** Réplique de lib/radarParsing.toRadarDateFilter — cf tests Vitest là-bas. */
export function toRadarDateFilter(lastSyncAtMs: number): string {
  return new Date(lastSyncAtMs).toISOString().slice(0, 10);
}

const TIKTOK_VIDEO_ID_RE = /\/(?:video|photo)\/(\d+)/;

function videoIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = TIKTOK_VIDEO_ID_RE.exec(url);
  return m ? m[1] : null;
}

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c;
  }
  return null;
}

function extractHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const h of value) {
    if (typeof h === "string" && h.trim() !== "") out.push(h.trim());
    else if (h && typeof h === "object") {
      const name = (h as { name?: unknown }).name;
      if (typeof name === "string" && name.trim() !== "") out.push(name.trim());
    }
    if (out.length >= 30) break;
  }
  return out;
}

/** Réplique de lib/radarParsing.RadarParsedVideo. */
export interface RadarParsedVideo {
  tiktokId: string;
  url: string;
  publishedAt: number;
  caption: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  durationSec: number | null;
  coverUrl: string | null;
  musicName: string | null;
  hashtags: string[];
  authorHandle: string | null;
  authorFans: number | null;
  isAd: boolean;
  isPinned: boolean;
  isSlideshow: boolean;
}

function parsePublishedAt(item: Record<string, unknown>): number {
  const iso = item.createTimeISO;
  if (typeof iso === "string") {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) return ms;
  }
  const sec = toCount(item.createTime);
  return sec !== null ? sec * 1000 : 0;
}

/** Réplique de lib/radarParsing.parseRadarVideos — cf tests Vitest là-bas. */
export function parseRadarVideos(apiResponse: unknown): RadarParsedVideo[] {
  const items = Array.isArray(apiResponse) ? apiResponse : [];
  const out: RadarParsedVideo[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;

    const rawId = item.id;
    const tiktokId =
      typeof rawId === "string" || typeof rawId === "number"
        ? String(rawId)
        : videoIdFromUrl(item.webVideoUrl);
    if (!tiktokId || tiktokId === "") continue;

    const authorMeta = (item.authorMeta ?? {}) as Record<string, unknown>;
    const videoMeta = (item.videoMeta ?? {}) as Record<string, unknown>;
    const musicMeta = (item.musicMeta ?? {}) as Record<string, unknown>;

    const authorHandle = cleanText(authorMeta.name, 100);
    const url =
      firstString(item.webVideoUrl) ??
      (authorHandle
        ? `https://www.tiktok.com/@${authorHandle}/video/${tiktokId}`
        : `https://www.tiktok.com/video/${tiktokId}`);

    out.push({
      tiktokId,
      url,
      publishedAt: parsePublishedAt(item),
      caption: cleanText(item.text),
      views: toCount(item.playCount) ?? 0,
      likes: toCount(item.diggCount) ?? 0,
      comments: toCount(item.commentCount) ?? 0,
      shares: toCount(item.shareCount) ?? 0,
      saves: toCount(item.collectCount) ?? 0,
      durationSec: toCount(videoMeta.duration),
      coverUrl: firstString(
        videoMeta.coverUrl,
        videoMeta.cover,
        videoMeta.originCover,
        videoMeta.dynamicCover,
      ),
      musicName: cleanText(musicMeta.musicName, 200),
      hashtags: extractHashtags(item.hashtags),
      authorHandle,
      authorFans: toCount(authorMeta.fans),
      isAd: Boolean(item.isAd),
      isPinned: Boolean(item.isPinned),
      isSlideshow: Boolean(item.isSlideshow),
    });
  }
  return out;
}

/** Réplique de lib/radarParsing.BucketedRadarVideo. */
export interface BucketedRadarVideo extends RadarParsedVideo {
  isPopular: boolean;
}

/** Réplique de lib/radarParsing.mergeRadarBuckets — cf tests Vitest là-bas. */
export function mergeRadarBuckets(
  recent: readonly RadarParsedVideo[],
  popular: readonly RadarParsedVideo[],
): BucketedRadarVideo[] {
  const seen = new Set<string>();
  const out: BucketedRadarVideo[] = [];
  for (const v of popular) {
    if (seen.has(v.tiktokId)) continue;
    seen.add(v.tiktokId);
    out.push({ ...v, isPopular: true });
  }
  for (const v of recent) {
    if (seen.has(v.tiktokId)) continue; // dédup : populaire prioritaire
    if (v.isPinned) continue; // épinglées exclues des récentes
    seen.add(v.tiktokId);
    out.push({ ...v, isPopular: false });
  }
  return out;
}

// ─── Fetch profil (I/O — runtime action uniquement) ──────────────────────────

function actorSlug(): string {
  return process.env.APIFY_RADAR_TIKTOK_ACTOR || DEFAULT_TIKTOK_ACTOR;
}

export type RadarSorting = "latest" | "popular";

/** Input clockworks pour scraper UN profil (téléchargements désactivés = moins cher). */
function profileActorInput(
  handle: string,
  opts: {
    sorting: RadarSorting;
    resultsPerPage: number;
    oldestPostDate?: string;
    excludePinned?: boolean;
  },
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    profiles: [handle],
    resultsPerPage: opts.resultsPerPage,
    profileSorting: opts.sorting, // "latest" (date) ou "popular" (vues)
    profileScrapeSections: ["videos"],
    excludePinnedPosts: opts.excludePinned ?? false,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
    shouldDownloadSlideshowImages: false,
  };
  // Le filtre date ne s'applique qu'avec "latest"/"oldest" (cf actor) : on ne le
  // passe donc que pour les récentes (incrémental), jamais pour les populaires.
  if (opts.sorting === "latest" && opts.oldestPostDate) {
    input.oldestPostDateUnified = opts.oldestPostDate;
  }
  return input;
}

/** Extrait un message d'erreur lisible du corps d'une réponse Apify non-ok. */
async function readApiError(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    const apiMsg = (body as { error?: { message?: unknown } })?.error?.message;
    if (typeof apiMsg === "string") return apiMsg;
  } catch {
    // corps non-JSON
  }
  return res.statusText || `HTTP ${res.status}`;
}

export interface FetchRadarVideosResult {
  /** true = run Apify abouti (même si 0 vidéo : compte vide/privé/introuvable). */
  ok: boolean;
  /** Vidéos parsées (vide si ok && compte sans vidéo, ou si échec). */
  videos: RadarParsedVideo[];
  /** Message d'erreur si !ok (quota, actor down, timeout, réseau). */
  error?: string;
}

/**
 * Relève un ensemble de vidéos d'UN compte TikTok via Apify (clé RADAR). Deux
 * usages : `sorting:"latest"` (récentes, filtre date incrémental + exclusion des
 * épinglées) et `sorting:"popular"` (top vues, SANS filtre date — le top bouge à
 * chaque sync). Un échec réseau/HTTP n'est PAS propagé en exception : on retourne
 * `{ ok:false, error }` → l'appelant continue la boucle. Le token n'est JAMAIS logué.
 *
 * `fetchImpl` injectable pour les tests ; par défaut le `fetch` global de l'action.
 */
export async function fetchRadarProfileVideos(
  handle: string,
  apiToken: string,
  opts: {
    sorting: RadarSorting;
    resultsPerPage: number;
    oldestPostDate?: string;
    excludePinned?: boolean;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<FetchRadarVideosResult> {
  const endpoint = `${APIFY_ACTS_BASE}/${actorSlug()}/run-sync-get-dataset-items?timeout=${RUN_TIMEOUT_SECS}`;
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(profileActorInput(handle, opts)),
    });
    if (!res.ok) {
      return { ok: false, videos: [], error: await readApiError(res) };
    }
    const json: unknown = await res.json();
    return { ok: true, videos: parseRadarVideos(json) };
  } catch (e) {
    return {
      ok: false,
      videos: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
