/**
 * LECTURE D'UNE URL SNAPCHAT — Spotlight ou lien court. Module PUR, sans le
 * scraper : importable côté client (`lib/post-url-recognized`) sans tirer
 * dans le bundle créateur les motifs d'échec et l'User-Agent du relevé
 * (`convex/snapchatPublicPage.ts`, qui ré-exporte ces fonctions).
 */

/** L'hôte appartient-il à snapchat.com (lui-même ou un sous-domaine) ? */
export function isSnapchatHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "snapchat.com" || h.endsWith(".snapchat.com");
}

export function parseSnapchatUrl(url: string): URL | null {
  const raw = url.trim();
  if (raw === "") return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

/**
 * Identifiant du Spotlight dans son URL : `/spotlight/<id>`, nu ou sous
 * `/@user/`. `null` pour tout le reste (lien court, profil, Story).
 */
export function snapchatSpotlightId(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const u = parseSnapchatUrl(url);
  if (!u || !isSnapchatHost(u.hostname)) return null;
  const m = u.pathname.match(/\/spotlight\/([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}

/** Lien court de partage `snapchat.com/t/<code>` — l'identifiant n'y est pas. */
export function isSnapchatShortlink(url: string): boolean {
  const u = parseSnapchatUrl(url);
  if (!u || !isSnapchatHost(u.hostname)) return false;
  return /^\/t\/[A-Za-z0-9_-]+\/?$/.test(u.pathname);
}
