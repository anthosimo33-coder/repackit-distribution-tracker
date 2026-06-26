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

/**
 * URL du LECTEUR TikTok officiel (iframe `player/v1`) pour un id de vidéo. Joue
 * la vidéo EN PLACE dans une iframe, sans oEmbed ni embed.js (donc fiable même
 * quand plusieurs vidéos sont ouvertes successivement dans une modale — l'embed
 * oEmbed/embed.js, lui, ne ré-hydrate pas les blockquotes après le 1er montage et
 * dégénère en simple lien → redirection). `rel=0` coupe les recommandations.
 */
export function tiktokPlayerEmbedUrl(videoId: string): string {
  return `https://www.tiktok.com/player/v1/${encodeURIComponent(videoId.trim())}?rel=0&description=0`;
}

/**
 * URL canonique d'une vidéo TikTok (`/@handle/video/<id>`) reconstruite depuis le
 * handle + l'id — pour le lien ↗ et tout embed qui exige le format canonique.
 * Tolère un handle préfixé d'un « @ ».
 */
export function tiktokCanonicalVideoUrl(handle: string, videoId: string): string {
  const h = handle.trim().replace(/^@+/, "");
  return `https://www.tiktok.com/@${h}/video/${videoId.trim()}`;
}
