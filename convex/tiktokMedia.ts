/**
 * IMAGES D'UN POST TIKTOK — lues dans le payload PUBLIC de sa page (même balise
 * que le relevé maison, `convex/tiktokPublicPage.ts`). Pur : la récupération
 * réseau est faite par l'appelant (outil MCP `images_tiktok`).
 *
 * Carrousel photo → `itemStruct.imagePost.images[].imageURL.urlList` (forme NON
 * relevée sur un vrai post photo au moment d'écrire : lue défensivement). Vidéo →
 * sa couverture (`originCover`, à défaut `cover`), seule image disponible sans
 * décoder la vidéo — vérifié sur une vraie page publique le 07/10/2026.
 */

/** Le compte qui a publié (nom, photo sur le CDN, badge) — de quoi dessiner l'en-tête d'un reel partagé. */
export type TikTokAuthor = { username: string; avatar?: string; verified?: boolean };

export type TikTokMedia =
  | { kind: "photos"; images: string[]; author?: TikTokAuthor }
  | { kind: "video"; images: string[]; author?: TikTokAuthor }
  | { kind: "unreadable"; reason: string };

/** Hôtes autorisés pour le proxy d'image : les CDN de TikTok, rien d'autre. */
const TIKTOK_CDN = /(^|\.)(tiktokcdn(-[a-z]{2})?\.com|tiktokcdn-us\.com|ibyteimg\.com|muscdn\.com|byteimg\.com)$/;

export function isTikTokCdnUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && TIKTOK_CDN.test(u.hostname);
  } catch {
    return false;
  }
}

export function isTikTokPostUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" && /(^|\.)tiktok\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

const UNIVERSAL_DATA_RE = /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;

function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function firstUrl(v: unknown): string | null {
  if (typeof v === "string") return v;
  const list = rec(v).urlList;
  if (Array.isArray(list)) {
    // Le JPEG d'abord : tous les lecteurs le prennent ; le webp reste en repli.
    const urls = list.filter((u): u is string => typeof u === "string");
    return urls.find((u) => /\.jpe?g/i.test(u)) ?? urls[0] ?? null;
  }
  return null;
}

/**
 * Images d'un post TikTok lues dans le payload public de sa page (même balise
 * que le relevé, `convex/tiktokPublicPage.ts`). Carrousel photo →
 * `itemStruct.imagePost.images[].imageURL.urlList` (forme NON relevée sur un
 * vrai post photo au moment d'écrire : lue défensivement). Vidéo → sa
 * couverture (`originCover`, à défaut `cover`), seule image disponible sans
 * décoder la vidéo.
 */
export function extractTikTokMedia(html: string): TikTokMedia {
  const m = UNIVERSAL_DATA_RE.exec(html);
  if (!m) return { kind: "unreadable", reason: "balise de réhydratation absente" };
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return { kind: "unreadable", reason: "payload JSON illisible" };
  }
  const detail = rec(rec(rec(data).__DEFAULT_SCOPE__)["webapp.video-detail"]);
  if (typeof detail.statusCode === "number" && detail.statusCode !== 0) {
    return { kind: "unreadable", reason: `TikTok refuse de servir ce post (${detail.statusCode})` };
  }
  const item = rec(rec(detail.itemInfo).itemStruct);
  if (Object.keys(item).length === 0) return { kind: "unreadable", reason: "post introuvable dans la page" };
  const a = rec(item.author);
  const avatar = [a.avatarMedium, a.avatarLarger, a.avatarThumb].find((u) => typeof u === "string" && isTikTokCdnUrl(u));
  const author: { author?: TikTokAuthor } =
    typeof a.uniqueId === "string" && a.uniqueId
      ? { author: { username: a.uniqueId, ...(typeof avatar === "string" ? { avatar } : {}), ...(a.verified === true ? { verified: true } : {}) } }
      : {};
  const photos = rec(item.imagePost).images;
  if (Array.isArray(photos) && photos.length > 0) {
    const images = photos
      .map((p) => firstUrl(rec(p).imageURL) ?? firstUrl(rec(p).displayImage))
      .filter((u): u is string => u !== null && isTikTokCdnUrl(u))
      .slice(0, 35);
    if (images.length > 0) return { kind: "photos", images, ...author };
  }
  const video = rec(item.video);
  const cover = [video.originCover, video.cover].find((u) => typeof u === "string" && isTikTokCdnUrl(u));
  if (typeof cover === "string") return { kind: "video", images: [cover], ...author };
  return { kind: "unreadable", reason: "ni photos ni couverture dans la page" };
}
