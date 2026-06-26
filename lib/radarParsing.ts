/**
 * RADAR (veille TikTok) — helpers PURS pour la Brique 1 (comptes favoris +
 * suivi de leurs vidéos). Aucune dépendance Convex/React → testé Vitest
 * (lib/radarParsing.test.ts).
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/ (bundles séparés). Ces
 * fonctions sont RÉPLIQUÉES à l'identique côté serveur (convex/radarApi.ts) pour
 * l'action de sync + le cron. Toute évolution ici doit l'être là-bas. Les tests
 * vivent ICI (Vitest ne scanne que lib/**).
 *
 * Rôle : (a) normaliser un input de compte (@handle, handle nu, URL de profil)
 * en handle propre ; (b) calculer l'engagement (likes+comments+shares)/vues ;
 * (c) parser la sortie de l'actor clockworks/tiktok-scraper (input PROFIL) en
 * vidéos exploitables ; (d) dériver le filtre date incrémental de l'actor.
 */

/** "123" → 123 ; nombre fini → lui-même ; tout le reste → null. */
export function toCount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Texte propre : trim, null si vide, tronqué à `max`. */
export function cleanText(value: unknown, max = 500): string | null {
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

/** Charset d'un handle TikTok : lettres/chiffres/point/underscore, ≤ 24. */
const HANDLE_RE = /^[a-z0-9._]{1,24}$/;
const URL_HANDLE_RE = /@([a-zA-Z0-9._]{1,24})/;

/**
 * Normalise un input de compte favori en HANDLE propre (sans « @ », minuscule) :
 *   - "@Khaby.Lame"                         → "khaby.lame"
 *   - "khaby.lame"                          → "khaby.lame"
 *   - "https://www.tiktok.com/@khaby.lame"  → "khaby.lame"
 *   - "tiktok.com/@khaby.lame?lang=fr"      → "khaby.lame"
 * Refuse (null) : vide, charset invalide, URL hors tiktok.com, shortlink de
 * profil (vm./vt.tiktok.com — aucun @ dans le path, non résoluble sans réseau).
 */
export function normalizeTikTokHandle(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // Cas URL : doit pointer tiktok.com et exposer /@handle dans le path.
  const looksLikeUrl = /tiktok\.com/i.test(trimmed) || /^https?:\/\//i.test(trimmed);
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

  // Cas handle nu / @handle.
  const handle = (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
  return HANDLE_RE.test(handle) ? handle : null;
}

/**
 * Engagement = (likes + commentaires + partages) / vues. Borné à [0, +∞[ ;
 * 0 si vues ≤ 0 ou entrées non finies (jamais NaN, jamais négatif). Sert au tri
 * « par engagement » du mur de vidéos.
 */
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

/**
 * Filtre date incrémental de l'actor (`oldestPostDateUnified`) : "YYYY-MM-DD"
 * UTC dérivé du dernier sync. L'actor ne renvoie que les vidéos publiées à
 * partir de cette DATE (granularité jour) → on re-voit les vidéos du jour du
 * dernier sync (upsert idempotent, pas de doublon) sans en manquer.
 */
export function toRadarDateFilter(lastSyncAtMs: number): string {
  return new Date(lastSyncAtMs).toISOString().slice(0, 10);
}

const TIKTOK_VIDEO_ID_RE = /\/(?:video|photo)\/(\d+)/;

/** id numérique d'une vidéo depuis une webVideoUrl (fallback si item.id absent). */
function videoIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = TIKTOK_VIDEO_ID_RE.exec(url);
  return m ? m[1] : null;
}

/** Première chaîne non vide parmi plusieurs candidats (couvertures TikTok). */
function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c;
  }
  return null;
}

/** Extrait les noms de hashtags (`[{name}]` ou `["name"]`) → string[] propre. */
function extractHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const h of value) {
    if (typeof h === "string" && h.trim() !== "") out.push(h.trim());
    else if (h && typeof h === "object") {
      const name = (h as { name?: unknown }).name;
      if (typeof name === "string" && name.trim() !== "") out.push(name.trim());
    }
    if (out.length >= 30) break; // borne défensive
  }
  return out;
}

/** Vidéo parsée depuis la sortie clockworks (input profil), prête à l'upsert. */
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

/** Date de publication en ms depuis createTimeISO (fallback createTime sec). */
function parsePublishedAt(item: Record<string, unknown>): number {
  const iso = item.createTimeISO;
  if (typeof iso === "string") {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) return ms;
  }
  const sec = toCount(item.createTime);
  return sec !== null ? sec * 1000 : 0;
}

/**
 * Parse la sortie de l'actor clockworks/tiktok-scraper (input PROFIL) :
 *   [{ id, webVideoUrl, createTimeISO, text, playCount, diggCount, commentCount,
 *      shareCount, collectCount, videoMeta:{duration,coverUrl}, musicMeta:{musicName},
 *      authorMeta:{name,nickName,fans}, hashtags:[{name}], isAd, isPinned, isSlideshow }, ...]
 * Un item sans id exploitable (ni `id` ni id dans webVideoUrl) est ignoré
 * (jamais d'exception). Robuste à un JSON partiel/inattendu.
 */
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
