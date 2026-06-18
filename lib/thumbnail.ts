/**
 * Vignettes d'inspirations — helpers PURS (zéro dépendance Convex/réseau),
 * testés Vitest (lib/thumbnail.test.ts).
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. Ces fonctions sont
 * RÉPLIQUÉES côté serveur dans convex/inspirationThumbnails.ts (où vit l'I/O
 * réseau de l'action). Toute évolution ici doit l'être là-bas. Les tests
 * vivent ici.
 *
 * La détection de plateforme + l'extraction du videoId YouTube vivent
 * respectivement dans lib/inspiration-url.ts (detectInspirationType) et
 * lib/youtubeId.ts (extractYouTubeId) — on ne les redéfinit pas ici.
 */

/**
 * URL de vignette YouTube depuis un videoId. `hqdefault.jpg` est quasi
 * toujours présent (présent dès l'upload, même sans maxres) → on l'utilise
 * directement, pas besoin d'appel réseau ni de clé API.
 */
export function buildYouTubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/** Endpoint oEmbed public TikTok pour une URL de vidéo donnée. */
export function buildTikTokOEmbedUrl(videoUrl: string): string {
  return `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
}

/**
 * Extrait `thumbnail_url` d'une réponse oEmbed (TikTok / Instagram, même
 * forme). Retourne l'URL trimée si présente et non vide, sinon null. Robuste
 * à un JSON partiel/inattendu (jamais d'exception).
 */
export function parseOEmbedThumbnail(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const raw = (json as { thumbnail_url?: unknown }).thumbnail_url;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
