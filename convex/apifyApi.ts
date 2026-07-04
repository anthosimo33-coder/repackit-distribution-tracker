/**
 * Couche API Apify (TikTok/Instagram) — appel réseau externe, DESTINÉ à être
 * appelé depuis une action Convex (convex/apifySync.ts) : `fetch` n'est dispo que
 * dans le runtime action. Calqué sur convex/youtubeApi.ts.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. `tiktokPostId` /
 * `instagramShortcode` / `parseTikTokViews` / `parseInstagramViews` / `toCount`
 * sont des RÉPLIQUES de lib/apifyPosts.ts (où vivent les tests Vitest). Toute
 * évolution doit être faite des DEUX côtés.
 *
 * APIFY :
 *  - Endpoint REST « run-sync-get-dataset-items » : lance l'actor avec les URLs
 *    en input, ATTEND la fin du run, renvoie directement les items du dataset.
 *  - Token via header Authorization: Bearer (jamais dans l'URL).
 *  - Actors (overridables par env pour swap sans redeploy) :
 *      TikTok    → clockworks/tiktok-scraper   (champ vues : playCount)
 *      Instagram → apify/instagram-scraper     (champ vues : videoPlayCount,
 *                                               fallback videoViewCount)
 *  - COÛT : Apify est payant à l'usage. On GROUPE les URLs (MAX_URLS_PER_RUN par
 *    run) → 1 run par lot par plateforme (pas 1 run/post). Un lot en erreur
 *    (quota, actor down, timeout) est LOGUÉ et IGNORÉ — les autres continuent.
 */

const APIFY_ACTS_BASE = "https://api.apify.com/v2/acts";

/** Actors par défaut (slug `owner~name` pour le path REST). Overridables par env. */
const DEFAULT_TIKTOK_ACTOR = "clockworks~tiktok-scraper";
const DEFAULT_INSTAGRAM_ACTOR = "apify~instagram-scraper";

/**
 * URLs par run. Borne le coût ET la durée (run-sync est plafonné côté Apify) :
 * un run = un lot, jamais 500 posts d'un coup. Petit pour rester sous le timeout
 * synchrone même si l'actor est lent.
 */
const MAX_URLS_PER_RUN = 25;

/** Timeout (s) passé au run Apify — borne un run qui patine (post lent/bloqué). */
const RUN_TIMEOUT_SECS = 120;

export type ApifyPlatform = "TikTok" | "Instagram";

// ─── Répliques pures (lib/apifyPosts.ts) ─────────────────────────────────────

function toCount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseUrl(input: string | null | undefined): URL | null {
  if (typeof input !== "string" || input.trim() === "") return null;
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

const TIKTOK_ID_RE = /\/(?:video|photo)\/(\d+)/;
const INSTAGRAM_CODE_RE = /\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/;

/** Réplique de lib/apifyPosts.tiktokPostId — cf tests Vitest là-bas. */
export function tiktokPostId(input: string | null | undefined): string | null {
  const url = parseUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.|vm\.|vt\.)/, "");
  if (host !== "tiktok.com" && !host.endsWith(".tiktok.com")) return null;
  const m = TIKTOK_ID_RE.exec(url.pathname);
  return m ? m[1] : null;
}

/** Réplique de lib/apifyPosts.instagramShortcode — cf tests Vitest là-bas. */
export function instagramShortcode(
  input: string | null | undefined,
): string | null {
  const url = parseUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, "");
  if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return null;
  const m = INSTAGRAM_CODE_RE.exec(url.pathname);
  return m ? m[1] : null;
}

/** Réplique de lib/apifyPosts.ApifyPostStat — vues + likes + commentaires + titre. */
export interface ApifyPostStat {
  views: number;
  likes: number | null;
  comments: number | null;
  title: string | null;
}

interface ParsedApifyViews {
  stats: Record<string, ApifyPostStat>;
  unavailable: string[];
}

const TITLE_MAX = 500;

/** Réplique de lib/apifyPosts.cleanCaption. */
function cleanCaption(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "") return null;
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) : t;
}

/** Réplique de lib/apifyPosts.parseTikTokViews — cf tests Vitest là-bas. */
function parseTikTokViews(
  apiResponse: unknown,
  requestedKeys: readonly string[],
): ParsedApifyViews {
  const stats: Record<string, ApifyPostStat> = {};
  const items = Array.isArray(apiResponse) ? apiResponse : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rawId = (item as { id?: unknown }).id;
    const key =
      typeof rawId === "string" || typeof rawId === "number"
        ? String(rawId)
        : tiktokPostId((item as { webVideoUrl?: unknown }).webVideoUrl as string);
    if (!key) continue;
    const views = toCount((item as { playCount?: unknown }).playCount);
    if (views === null) continue;
    const likes = toCount((item as { diggCount?: unknown }).diggCount);
    const comments = toCount((item as { commentCount?: unknown }).commentCount);
    const title = cleanCaption((item as { text?: unknown }).text);
    stats[key] = { views, likes, comments, title };
  }
  const present = new Set(Object.keys(stats));
  return { stats, unavailable: requestedKeys.filter((k) => !present.has(k)) };
}

/** Réplique de lib/apifyPosts.parseInstagramViews — cf tests Vitest là-bas. */
function parseInstagramViews(
  apiResponse: unknown,
  requestedKeys: readonly string[],
): ParsedApifyViews {
  const stats: Record<string, ApifyPostStat> = {};
  const items = Array.isArray(apiResponse) ? apiResponse : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rawCode = (item as { shortCode?: unknown }).shortCode;
    const key =
      typeof rawCode === "string" && rawCode !== ""
        ? rawCode
        : instagramShortcode((item as { url?: unknown }).url as string);
    if (!key) continue;
    const views =
      toCount((item as { videoPlayCount?: unknown }).videoPlayCount) ??
      toCount((item as { videoViewCount?: unknown }).videoViewCount);
    if (views === null) continue;
    const likes = toCount((item as { likesCount?: unknown }).likesCount);
    const comments = toCount((item as { commentsCount?: unknown }).commentsCount);
    const title = cleanCaption((item as { caption?: unknown }).caption);
    stats[key] = { views, likes, comments, title };
  }
  const present = new Set(Object.keys(stats));
  return { stats, unavailable: requestedKeys.filter((k) => !present.has(k)) };
}

// ─── Fetch batché (I/O — runtime action uniquement) ──────────────────────────

function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`chunk: taille de lot invalide (${size})`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export interface ApifyBatchError {
  status: number | "network";
  message: string;
  /** Nb d'URLs du lot concerné (perdues pour ce relevé). */
  batchSize: number;
}

export interface FetchApifyViewsResult {
  /** clé de post → stat (vues + likes + titre). */
  stats: Record<string, ApifyPostStat>;
  /** clés absentes (post privé/supprimé, ou image Insta sans vues). */
  unavailable: string[];
  /** lots en erreur (quota, actor down, timeout, réseau) — non bloquant. */
  errors: ApifyBatchError[];
  /** Nb de runs Apify lancés (≈ unité de coût). */
  runs: number;
}

function actorFor(platform: ApifyPlatform): string {
  if (platform === "TikTok") {
    return process.env.APIFY_TIKTOK_ACTOR || DEFAULT_TIKTOK_ACTOR;
  }
  return process.env.APIFY_INSTAGRAM_ACTOR || DEFAULT_INSTAGRAM_ACTOR;
}

function keyOf(platform: ApifyPlatform, url: string): string | null {
  return platform === "TikTok" ? tiktokPostId(url) : instagramShortcode(url);
}

/** Input de l'actor pour un lot d'URLs (téléchargements désactivés = moins cher). */
function actorInput(
  platform: ApifyPlatform,
  urls: string[],
): Record<string, unknown> {
  if (platform === "TikTok") {
    return {
      postURLs: urls,
      resultsPerPage: 1,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
    };
  }
  return {
    directUrls: urls,
    resultsType: "posts",
    resultsLimit: 1,
    addParentData: false,
  };
}

function parseFor(
  platform: ApifyPlatform,
  json: unknown,
  keys: readonly string[],
): ParsedApifyViews {
  return platform === "TikTok"
    ? parseTikTokViews(json, keys)
    : parseInstagramViews(json, keys);
}

/**
 * Relève les vues d'une liste d'URLs TikTok OU Instagram via Apify. Calcule une
 * CLÉ DE POST par URL (id TikTok / shortcode Insta) pour rapprocher la sortie de
 * l'actor ; les URLs sans clé exploitable (shortlink) sont ignorées. Découpe en
 * lots de MAX_URLS_PER_RUN (1 run/lot). Un lot en erreur est LOGUÉ et IGNORÉ —
 * on retourne ce qui a pu être récupéré.
 *
 * `fetchImpl` est injectable pour les tests ; par défaut le `fetch` global du
 * runtime action Convex.
 */
export async function fetchApifyViewsForPlatform(
  platform: ApifyPlatform,
  postUrls: readonly string[],
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchApifyViewsResult> {
  const result: FetchApifyViewsResult = {
    stats: {},
    unavailable: [],
    errors: [],
    runs: 0,
  };

  // URL représentative par clé (dédupe : 2 publications peuvent partager un post).
  const urlByKey = new Map<string, string>();
  for (const url of postUrls) {
    const key = keyOf(platform, url);
    if (key && !urlByKey.has(key)) urlByKey.set(key, url);
  }
  if (urlByKey.size === 0) return result;

  const actor = actorFor(platform);
  const endpoint = `${APIFY_ACTS_BASE}/${actor}/run-sync-get-dataset-items?timeout=${RUN_TIMEOUT_SECS}`;
  const entries = [...urlByKey.entries()]; // [key, url]

  for (const batch of chunk(entries, MAX_URLS_PER_RUN)) {
    const batchKeys = batch.map(([key]) => key);
    const batchUrls = batch.map(([, url]) => url);
    result.runs += 1;
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify(actorInput(platform, batchUrls)),
      });
      if (!res.ok) {
        const message = await readApiError(res);
        result.errors.push({
          status: res.status,
          message,
          batchSize: batchUrls.length,
        });
        continue; // lot perdu, on n'échoue pas les suivants
      }
      const json: unknown = await res.json();
      const parsed = parseFor(platform, json, batchKeys);
      Object.assign(result.stats, parsed.stats);
      result.unavailable.push(...parsed.unavailable);
    } catch (e) {
      result.errors.push({
        status: "network",
        message: e instanceof Error ? e.message : String(e),
        batchSize: batchUrls.length,
      });
    }
  }

  return result;
}

/** Vues d'UN post TikTok via son URL → nombre, ou null (privé/supprimé/erreur). */
export async function fetchTikTokViews(
  postUrl: string,
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const key = tiktokPostId(postUrl);
  if (!key) return null;
  const r = await fetchApifyViewsForPlatform("TikTok", [postUrl], apiToken, fetchImpl);
  return r.stats[key]?.views ?? null;
}

/** Vues d'UN post/reel Instagram via son URL → nombre, ou null (image/privé/erreur). */
export async function fetchInstagramViews(
  postUrl: string,
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const key = instagramShortcode(postUrl);
  if (!key) return null;
  const r = await fetchApifyViewsForPlatform(
    "Instagram",
    [postUrl],
    apiToken,
    fetchImpl,
  );
  return r.stats[key]?.views ?? null;
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
