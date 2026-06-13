/**
 * P6 — helpers purs pour les embeds vidéo des formats (testés Vitest).
 * Détection de plateforme : réutiliser lib/inspiration-url (detectInspirationType).
 */

/**
 * Extrait l'ID vidéo YouTube d'une URL (watch?v=, youtu.be/, shorts/, embed/).
 * Retourne null si non reconnu → l'appelant retombe sur une carte cliquable.
 */
export function extractYouTubeId(url: string): string | null {
  const u = url.trim();
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
  ];
  for (const re of patterns) {
    const m = u.match(re);
    if (m) return m[1];
  }
  return null;
}

/** URL d'embed YouTube (privacy-enhanced nocookie) pour un ID donné. */
export function youTubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}`;
}

/** URL de l'oEmbed TikTok officiel pour une URL de vidéo. */
export function tiktokOembedUrl(videoUrl: string): string {
  return `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl.trim())}`;
}
