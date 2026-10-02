/**
 * Couche API Cloudflare Stream (REST) — appels réseau externes, DESTINÉS à être
 * appelés depuis une action Convex (convex/cloudflareStream.ts) : `fetch` n'est
 * dispo que dans le runtime action. Calqué sur convex/apifyApi.ts.
 *
 * RÔLE : transcoder la vidéo SOUMISE par un créateur (souvent .mov HEVC iPhone,
 * illisible dans le navigateur) en un flux que le player Stream lit partout.
 *
 * MODE D'UPLOAD — « copy from URL » : on donne à Stream l'URL SIGNÉE Convex
 * (getUrl) de la vidéo DÉJÀ stockée ; Cloudflare la récupère côté serveur et la
 * transcode. UN SEUL chemin pour la nouvelle soumission ET la migration (la
 * vidéo est toujours d'abord en Convex storage — source + fallback + bouton
 * télécharger #56). Évite le double upload client qu'imposerait un « direct
 * creator upload » en parallèle du blob Convex qu'on garde de toute façon.
 *
 * ⚠️ ENV (posés via `npx convex env set`) :
 *   - CLOUDFLARE_ACCOUNT_ID
 *   - CLOUDFLARE_STREAM_API_TOKEN  (permission Stream:Edit)
 * ABSENTS → `cloudflareStreamConfig()` renvoie null : l'appelant log + no-op
 * (fallback Convex), JAMAIS de crash.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. `mapStreamState` est une
 * RÉPLIQUE de lib/cloudflare-stream.ts (tests Vitest là-bas). Toute évolution
 * doit être faite des DEUX côtés.
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

/** Timeout des appels REST (création de copie / statut / suppression). */
const FETCH_TIMEOUT_MS = 15_000;

/** État normalisé d'une vidéo Stream (réplique du type lib/cloudflare-stream). */
export type StreamStatus = "processing" | "ready" | "error";

/** Réplique de lib/cloudflare-stream.mapStreamState — cf tests Vitest là-bas. */
function mapStreamState(state: string | null | undefined): StreamStatus {
  const s = (state ?? "").trim().toLowerCase();
  if (s === "ready") return "ready";
  if (s === "error") return "error";
  return "processing";
}

/**
 * Cadence du suivi de transcoding, en DEUX phases. La plupart des vidéos sont
 * prêtes en moins d'une minute (relevé serré) ; une grosse vidéo (4K, longue)
 * ou une file d'attente Cloudflare peut prendre bien plus. Le 01/10/2026, une
 * soumission est restée « Transcoding en cours » pour toujours : le suivi
 * s'arrêtait à ~5 min alors que Cloudflare a fini plus tard, et rien ne le
 * relançait.
 */
export const STREAM_POLL_FAST_INTERVAL_MS = 8_000;
export const STREAM_POLL_FAST_ATTEMPTS = 40; // ~5 min
export const STREAM_POLL_SLOW_INTERVAL_MS = 60_000;
export const STREAM_POLL_MAX_ATTEMPTS = STREAM_POLL_FAST_ATTEMPTS + 120; // + 2 h

/**
 * Délai avant le relevé qui suit le relevé n° `attempt` (1 = le premier), ou
 * null quand on abandonne — l'appelant passe alors la soumission en "error"
 * pour que l'écran retombe sur la vidéo Convex au lieu d'attendre à vie.
 */
export function nextStreamPollDelayMs(attempt: number): number | null {
  if (attempt < STREAM_POLL_FAST_ATTEMPTS) return STREAM_POLL_FAST_INTERVAL_MS;
  if (attempt < STREAM_POLL_MAX_ATTEMPTS) return STREAM_POLL_SLOW_INTERVAL_MS;
  return null;
}

export interface CloudflareStreamConfig {
  accountId: string;
  apiToken: string;
}

/**
 * Config Cloudflare depuis l'env du deployment, ou null si l'un des deux secrets
 * manque. Centralise la GATE : tout l'appelant passe par là pour décider
 * « Stream actif » vs « fallback Convex ».
 */
export function cloudflareStreamConfig(): CloudflareStreamConfig | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken };
}

/** Résultat d'un upload/relevé : UID + état normalisé, ou null si échec. */
export interface StreamVideo {
  uid: string;
  status: StreamStatus;
}

/** GET/POST/DELETE JSON avec timeout + Bearer. Toute erreur → throw lisible. */
async function cfFetch(
  config: CloudflareStreamConfig,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${CF_API_BASE}/accounts/${config.accountId}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        ...(init.headers ?? {}),
      },
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = cfErrorMessage(json) ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** Extrait `errors[].message` d'une réponse Cloudflare en erreur (best-effort). */
function cfErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const errors = (json as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  return errors
    .map((e) =>
      e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string"
        ? (e as { message: string }).message
        : null,
    )
    .filter((m): m is string => m !== null)
    .join("; ");
}

/** Parse `{ result: { uid, status: { state } } }` → StreamVideo, ou null. */
function parseStreamVideo(json: unknown): StreamVideo | null {
  if (!json || typeof json !== "object") return null;
  const result = (json as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  const uid = (result as { uid?: unknown }).uid;
  if (typeof uid !== "string" || uid.length === 0) return null;
  const state = (result as { status?: { state?: unknown } }).status?.state;
  return {
    uid,
    status: mapStreamState(typeof state === "string" ? state : null),
  };
}

/**
 * Lance la copie d'une vidéo (URL signée Convex) vers Cloudflare Stream. Renvoie
 * le UID + l'état initial (souvent "processing"). Le transcoding se poursuit
 * côté Cloudflare ; on relève l'état ensuite via `fetchStreamStatus`.
 */
export async function copyVideoToStream(
  config: CloudflareStreamConfig,
  videoUrl: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StreamVideo> {
  const json = await cfFetch(
    config,
    "/stream/copy",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: videoUrl, meta: { name } }),
    },
    fetchImpl,
  );
  const video = parseStreamVideo(json);
  if (!video) throw new Error("Réponse Cloudflare copy invalide (uid manquant).");
  return video;
}

/** Relève l'état de transcoding d'un UID (processing/ready/error). */
export async function fetchStreamStatus(
  config: CloudflareStreamConfig,
  uid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StreamStatus> {
  const json = await cfFetch(
    config,
    `/stream/${encodeURIComponent(uid)}`,
    { method: "GET" },
    fetchImpl,
  );
  const video = parseStreamVideo(json);
  // UID introuvable / réponse inattendue → on considère "error" (l'UI retombe
  // alors sur le fallback Convex), plutôt que de boucler en "processing".
  return video?.status ?? "error";
}

/**
 * Supprime une vidéo Stream (hygiène de coût : à la re-soumission qui remplace,
 * et à la publication qui purge la soumission). Best-effort : l'appelant ignore
 * l'échec (un orphelin Stream ne casse rien, il coûte juste un peu).
 */
export async function deleteStreamVideo(
  config: CloudflareStreamConfig,
  uid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await cfFetch(
    config,
    `/stream/${encodeURIComponent(uid)}`,
    { method: "DELETE" },
    fetchImpl,
  );
}

/**
 * Durée d'une vidéo Stream, en secondes — `null` si Cloudflare ne la connaît pas
 * (encore en transcodage : il répond -1) ou si l'appel échoue. Sert à choisir
 * les instants des images clés (`regarder_video`) ; jamais bloquant.
 */
export async function fetchStreamDuration(
  config: CloudflareStreamConfig,
  uid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const json = await cfFetch(config, `/stream/${encodeURIComponent(uid)}`, { method: "GET" }, fetchImpl);
    const duree = (json as { result?: { duration?: unknown } } | null)?.result?.duration;
    return typeof duree === "number" && Number.isFinite(duree) && duree > 0 ? duree : null;
  } catch {
    return null;
  }
}
