/**
 * YouTube — helpers PURS pour le tracking auto des vues (cron quotidien). Aucune
 * dépendance Convex/React → testé Vitest (lib/youtubeId.test.ts).
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. Ces fonctions sont RÉPLIQUÉES
 * côté serveur (convex/youtubeApi.ts) pour l'action de fetch + le cron ; toute
 * évolution ici doit l'être là-bas. Les tests vivent ici.
 *
 * La détection de PLATEFORME (TikTok/Instagram/YouTube) vit dans
 * lib/inspiration-url.ts (regex `plateformeFromUrl`). Ici on ne fait QUE
 * l'extraction du videoId d'une URL déjà supposée YouTube — la sélection des
 * publications YouTube se fait en amont via `plateforme === "YouTube"`.
 */

/** Un videoId YouTube fait exactement 11 caractères dans [A-Za-z0-9_-]. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Segments de path portant l'id en 2e position : /shorts/ID, /embed/ID, /live/ID, /v/ID. */
const PATH_ID_RE = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/;

/**
 * Extrait le videoId d'une URL YouTube, quel que soit le format soumis par un
 * créateur. Gère :
 *   - youtube.com/watch?v=VIDEOID (+ &t=, &list=, etc.)
 *   - youtu.be/VIDEOID (+ ?si=, ?t=)
 *   - youtube.com/shorts/VIDEOID, /embed/VIDEOID, /live/VIDEOID, /v/VIDEOID
 *   - m.youtube.com, music.youtube.com, www. — avec ou sans scheme.
 * Retourne `null` proprement si l'URL n'est pas YouTube, est malformée, ou si
 * l'id extrait n'a pas la forme d'un videoId valide.
 */
export function extractYouTubeId(input: string | null | undefined): string | null {
  if (typeof input !== "string" || input.trim() === "") return null;
  const raw = input.trim();

  // Tolère l'absence de scheme (youtu.be/ID, youtube.com/watch?v=ID collés).
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
    // youtu.be/<id>
    id = url.pathname.split("/")[1] ?? null;
  } else if (url.pathname === "/watch" || url.pathname === "/watch/") {
    id = url.searchParams.get("v");
  } else {
    const m = PATH_ID_RE.exec(url.pathname);
    if (m) id = m[1];
  }

  return id !== null && VIDEO_ID_RE.test(id) ? id : null;
}

/**
 * Découpe une liste en lots de `size` éléments (respect du quota API : l'endpoint
 * videos accepte jusqu'à 50 ids par appel → un appel par lot, jamais un par vidéo).
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
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
  /** likeCount peut être masqué par le créateur → `null`. */
  likes: number | null;
  /** statistics.commentCount ; null si non fourni. */
  comments: number | null;
  /** snippet.title (titre réel YouTube) ; null si snippet absent/vide. */
  title: string | null;
}

/** Longueur max stockée d'un titre (l'UI tronque visuellement en plus). */
const TITLE_MAX = 500;

/** Titre snippet → propre : trim, null si vide, tronqué à TITLE_MAX. */
export function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "") return null;
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) : t;
}

export interface ParsedVideoStats {
  /** videoId → stats, pour chaque vidéo PRÉSENTE dans la réponse. */
  stats: Record<string, VideoStat>;
  /** ids demandés ABSENTS de la réponse (vidéo supprimée / privée). */
  unavailable: string[];
}

/**
 * Parse la réponse de `videos?part=snippet,statistics` de l'API YouTube Data v3 :
 *   { items: [{ id, snippet: { title }, statistics: { viewCount, likeCount, commentCount } }, ...] }
 * Convertit viewCount/likeCount/commentCount (strings) en nombres et lit snippet.title. Une
 * vidéo supprimée/privée n'apparaît PAS dans `items` → listée dans `unavailable`
 * (jamais d'exception). Robuste à un JSON partiel/inattendu (snippet absent → titre
 * null, sans casser le relevé des vues).
 */
export function parseVideoStats(
  apiResponse: unknown,
  requestedIds: readonly string[],
): ParsedVideoStats {
  const stats: Record<string, VideoStat> = {};
  const items =
    apiResponse &&
    typeof apiResponse === "object" &&
    Array.isArray((apiResponse as { items?: unknown }).items)
      ? ((apiResponse as { items: unknown[] }).items)
      : [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    const statistics = (item as { statistics?: unknown }).statistics;
    if (typeof id !== "string" || !statistics || typeof statistics !== "object") {
      continue;
    }
    const viewRaw = (statistics as { viewCount?: unknown }).viewCount;
    const views = toCount(viewRaw);
    if (views === null) continue; // pas de viewCount exploitable → on ignore
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

/** "123" → 123 ; nombre fini → lui-même ; tout le reste → null. */
function toCount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
