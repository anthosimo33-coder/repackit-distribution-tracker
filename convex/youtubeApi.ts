/**
 * Couche API YouTube Data v3 — appel réseau externe, DESTINÉ à être appelé
 * depuis une action Convex (convex/youtubeSync.ts) : `fetch` n'est dispo que
 * dans le runtime action. Module helper pur côté logique (réplica A6), I/O
 * isolé dans `fetchYouTubeViews`.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. `extractYouTubeId` / `chunk`
 * / `parseVideoStats` sont des RÉPLIQUES de lib/youtubeId.ts (où vivent les
 * tests Vitest). Toute évolution doit être faite des DEUX côtés.
 *
 * Quota : l'endpoint `videos` accepte jusqu'à 50 ids par appel → on groupe par
 * 50 (un appel par lot), JAMAIS un appel par vidéo.
 */

import {
  parseChannelStats,
  youtubeHandleFrom,
  type ChannelStats,
} from "./youtubeChannel";

const YOUTUBE_VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const MAX_IDS_PER_CALL = 50;

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const PATH_ID_RE = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/;

// ─── Réplique pure (lib/youtubeId.ts) ────────────────────────────────────────

/** Réplique de lib/youtubeId.extractYouTubeId — cf tests Vitest là-bas. */
export function extractYouTubeId(input: string | null | undefined): string | null {
  if (typeof input !== "string" || input.trim() === "") return null;
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    try {
      url = new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.|music\.)/, "");
  const isYouTube =
    host === "youtube.com" ||
    host === "youtu.be" ||
    host.endsWith(".youtube.com");
  if (!isYouTube) return null;

  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (url.pathname === "/watch" || url.pathname === "/watch/") {
    id = url.searchParams.get("v");
  } else {
    const m = PATH_ID_RE.exec(url.pathname);
    if (m) id = m[1];
  }
  return id !== null && VIDEO_ID_RE.test(id) ? id : null;
}

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

export interface VideoStat {
  views: number;
  likes: number | null;
  comments: number | null;
  /** snippet.title (titre réel YouTube) ; null si snippet absent/vide. */
  title: string | null;
}

const TITLE_MAX = 500;

/** Réplique de lib/youtubeId.cleanTitle. */
function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "") return null;
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) : t;
}

function toCount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Réplique de lib/youtubeId.parseVideoStats — cf tests Vitest là-bas. */
function parseVideoStats(
  apiResponse: unknown,
  requestedIds: readonly string[],
): { stats: Record<string, VideoStat>; unavailable: string[] } {
  const stats: Record<string, VideoStat> = {};
  const items =
    apiResponse &&
    typeof apiResponse === "object" &&
    Array.isArray((apiResponse as { items?: unknown }).items)
      ? (apiResponse as { items: unknown[] }).items
      : [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    const statistics = (item as { statistics?: unknown }).statistics;
    if (typeof id !== "string" || !statistics || typeof statistics !== "object") {
      continue;
    }
    const views = toCount((statistics as { viewCount?: unknown }).viewCount);
    if (views === null) continue;
    const likes = toCount((statistics as { likeCount?: unknown }).likeCount);
    const comments = toCount((statistics as { commentCount?: unknown }).commentCount);
    const snippet = (item as { snippet?: unknown }).snippet;
    const title =
      snippet && typeof snippet === "object"
        ? cleanTitle((snippet as { title?: unknown }).title)
        : null;
    stats[id] = { views, likes, comments, title };
  }

  const present = new Set(Object.keys(stats));
  const unavailable = requestedIds.filter((id) => !present.has(id));
  return { stats, unavailable };
}

// ─── Fetch batché (I/O — runtime action uniquement) ──────────────────────────

export interface YouTubeBatchError {
  status: number | "network";
  message: string;
  /** Nb d'ids du lot concerné (perdus pour ce relevé). */
  batchSize: number;
}

export interface FetchYouTubeViewsResult {
  /** videoId → vues/likes, pour chaque vidéo récupérée. */
  stats: Record<string, VideoStat>;
  /** ids absents de la réponse (vidéo supprimée/privée). */
  unavailable: string[];
  /** lots en erreur (quota 403, clé 400, réseau) — non bloquant. */
  errors: YouTubeBatchError[];
}

/**
 * Relève les statistiques (vues + likes) d'une liste de videoIds via l'API
 * YouTube Data v3. Découpe en lots de 50, un appel par lot. Un lot en erreur
 * (quota dépassé, clé invalide, réseau) est LOGUÉ et IGNORÉ — on retourne ce
 * qui a pu être récupéré, sans faire échouer les autres lots.
 *
 * `fetchImpl` est injectable pour les tests ; par défaut le `fetch` global du
 * runtime action Convex.
 */
export async function fetchYouTubeViews(
  videoIds: readonly string[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchYouTubeViewsResult> {
  const result: FetchYouTubeViewsResult = {
    stats: {},
    unavailable: [],
    errors: [],
  };
  if (videoIds.length === 0) return result;

  for (const batch of chunk(videoIds, MAX_IDS_PER_CALL)) {
    const params = new URLSearchParams({
      // snippet → titre du post ; statistics → vues/likes. NE PAS retirer
      // statistics (les vues YouTube en dépendent).
      part: "snippet,statistics",
      id: batch.join(","),
      key: apiKey,
    });
    try {
      const res = await fetchImpl(`${YOUTUBE_VIDEOS_ENDPOINT}?${params}`);
      if (!res.ok) {
        const message = await readApiError(res);
        result.errors.push({
          status: res.status,
          message,
          batchSize: batch.length,
        });
        continue; // lot perdu, on n'échoue pas les suivants
      }
      const json: unknown = await res.json();
      const parsed = parseVideoStats(json, batch);
      Object.assign(result.stats, parsed.stats);
      result.unavailable.push(...parsed.unavailable);
    } catch (e) {
      result.errors.push({
        status: "network",
        message: e instanceof Error ? e.message : String(e),
        batchSize: batch.length,
      });
    }
  }

  return result;
}

/** Extrait un message d'erreur lisible du corps d'une réponse API non-ok. */
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

const YOUTUBE_CHANNELS_ENDPOINT =
  "https://www.googleapis.com/youtube/v3/channels";

/**
 * Compteurs d'ABONNÉS des chaînes YouTube, un appel par handle.
 *
 * `channels.list` n'accepte qu'UN `forHandle` par appel (contrairement à `id`,
 * qui en prend 50). À l'échelle du projet — quelques chaînes — c'est quelques
 * unités de quota sur 10 000 par jour : négligeable, et ça évite d'avoir à
 * résoudre les identifiants de chaîne depuis les URLs de vidéos.
 *
 * Une chaîne introuvable ou en erreur est SAUTÉE, jamais bloquante : le relevé
 * des vues est le cœur du cron, les abonnés en sont un supplément.
 */
export async function fetchYouTubeChannelStats(
  handles: readonly string[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  stats: Record<string, ChannelStats>;
  errors: { handle: string; message: string }[];
}> {
  const out: {
    stats: Record<string, ChannelStats>;
    errors: { handle: string; message: string }[];
  } = { stats: {}, errors: [] };

  for (const raw of new Set(handles)) {
    const handle = youtubeHandleFrom(raw);
    if (!handle) continue;
    const url = `${YOUTUBE_CHANNELS_ENDPOINT}?part=statistics&forHandle=${encodeURIComponent(handle)}&key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        out.errors.push({ handle, message: `HTTP ${res.status}` });
        continue;
      }
      const parsed = parseChannelStats(handle, await res.json());
      if (parsed) out.stats[handle] = parsed;
    } catch (e) {
      out.errors.push({
        handle,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}
