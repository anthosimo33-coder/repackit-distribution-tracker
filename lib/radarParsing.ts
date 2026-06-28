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

/** Vidéo parsée + son bucket d'affichage (populaire vs récente). */
export interface BucketedRadarVideo extends RadarParsedVideo {
  isPopular: boolean;
}

/**
 * Fusionne les DEUX ensembles d'un compte (récentes = sorting "latest" ;
 * populaires = sorting "popular") en une liste DÉDUPLIQUÉE prête à l'upsert, avec
 * marquage `isPopular`. Règles du fondateur :
 *   - POPULAIRE PRIORITAIRE : une vidéo présente dans les deux n'est gardée qu'en
 *     populaire (retirée des récentes) → jamais de doublon (clé = tiktokId).
 *   - Les vidéos ÉPINGLÉES (isPinned) sont exclues des récentes (elles squattent
 *     le haut du profil et fausseraient « les plus récentes »). Une épinglée peut
 *     rester en populaire si elle y figure (vues élevées).
 * Pur (aucune I/O) → testé Vitest, répliqué à l'identique dans convex/radarApi.ts.
 */
export function mergeRadarBuckets(
  recent: readonly RadarParsedVideo[],
  popular: readonly RadarParsedVideo[],
): BucketedRadarVideo[] {
  const seen = new Set<string>();
  const out: BucketedRadarVideo[] = [];
  for (const v of popular) {
    if (seen.has(v.tiktokId)) continue;
    seen.add(v.tiktokId);
    out.push({ ...v, isPopular: true });
  }
  for (const v of recent) {
    if (seen.has(v.tiktokId)) continue; // dédup : populaire prioritaire
    if (v.isPinned) continue; // épinglées exclues des récentes
    seen.add(v.tiktokId);
    out.push({ ...v, isPopular: false });
  }
  return out;
}

const DAY_MS = 86_400_000;

/**
 * Vrai si `publishedAtMs` date de MOINS de `days` jours (par rapport à `nowMs`).
 * Sert au filtre « vidéos récentes » des tendances : en mode hashtag, clockworks
 * renvoie le TOP du hashtag (PAS trié par date) → on ne garde que le frais. Tolère
 * 2 j de décalage futur (parsing de fuseau). `publishedAtMs<=0` → false.
 */
export function isWithinDays(
  publishedAtMs: number,
  nowMs: number,
  days: number,
): boolean {
  if (!Number.isFinite(publishedAtMs) || publishedAtMs <= 0) return false;
  const ageMs = nowMs - publishedAtMs;
  return ageMs <= days * DAY_MS && ageMs > -2 * DAY_MS;
}

/** Hashtag tendance parsé depuis data_xplorer/tiktok-trends (trendType hashtags). */
export interface ParsedTrendHashtag {
  hashtag: string;
  hashtagId: string | null;
  rank: number;
  posts: number | null;
  videoViews: number | null;
  trendDirection: string | null; // "up" | "down" | "stable"
  topCreators: {
    handle: string;
    nickname: string | null;
    country: string | null;
    followers: number | null;
  }[];
  tiktokUrl: string | null;
  period: string | null;
}

/** Normalise la direction de tendance en "up" | "down" | "stable" (sinon null). */
function trendDir(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().toLowerCase();
  if (t === "up" || t === "down" || t === "stable") return t;
  return null;
}

/** Extrait les top créateurs (`[{handle,nickname,followers,country}]`) → propre, cap 5. */
function parseTopCreators(value: unknown): ParsedTrendHashtag["topCreators"] {
  if (!Array.isArray(value)) return [];
  const out: ParsedTrendHashtag["topCreators"] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const handle = cleanText(c.handle, 100);
    if (handle === null) continue;
    out.push({
      handle,
      nickname: cleanText(c.nickname, 100),
      country: cleanText(c.country, 8),
      followers: toCount(c.followers),
    });
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Parse la sortie de data_xplorer/tiktok-trends (trendType "hashtags") :
 *   [{ Rank, Hashtag, "Hashtag ID", Posts, "Video Views", "Trend Direction",
 *      "Top Creators":[{handle,nickname,followers,country}], "TikTok URL", Period }, ...]
 * Les clés ont des ESPACES/MAJUSCULES (sortie "clean" de l'acteur). Un item sans
 * `Hashtag` exploitable est ignoré. Robuste à un JSON partiel/inattendu.
 */
export function parseTrendHashtags(apiResponse: unknown): ParsedTrendHashtag[] {
  const items = Array.isArray(apiResponse) ? apiResponse : [];
  const out: ParsedTrendHashtag[] = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const hashtag = cleanText(item["Hashtag"], 100);
    if (hashtag === null) continue;
    out.push({
      hashtag,
      hashtagId: cleanText(item["Hashtag ID"], 50),
      rank: toCount(item["Rank"]) ?? i + 1,
      posts: toCount(item["Posts"]),
      videoViews: toCount(item["Video Views"]),
      trendDirection: trendDir(item["Trend Direction"]),
      topCreators: parseTopCreators(item["Top Creators"]),
      tiktokUrl: cleanText(item["TikTok URL"], 300),
      period: cleanText(item["Period"], 30),
    });
  }
  return out;
}

// ─── Brique 3 — RECHERCHE D'OUTLIERS (mot-clé → vidéos scorées) ───────────────
// Source : clockworks/tiktok-scraper en mode RECHERCHE par mot-clé. On score
// chaque vidéo par sa surperformance relative (vues / abonnés) et on flague les
// comptes qui surperforment de façon RÉPÉTÉE (≥ 2 vidéos au-dessus du seuil) →
// signal d'un FORMAT validé, pas d'un coup de chance. Fonctions PURES (testées
// Vitest), RÉPLIQUÉES à l'identique dans convex/radarApi.ts (règle A6).

/**
 * Seuil d'outlier (vues / abonnés) à partir duquel une vidéo est « pétée » : 5.0
 * = la vidéo fait 5× les abonnés du compte en vues. AJUSTABLE ici (et dans la
 * réplique convex/radarApi.ts). Pilote la détection de comptes récurrents.
 */
export const RADAR_OUTLIER_THRESHOLD = 5.0;

/**
 * Nombre minimum de vidéos outlier d'un MÊME compte (dans le lot) pour le
 * qualifier de « récurrent » (format validé). 1 seule = fluke probable.
 */
export const RADAR_RECURRING_MIN_OUTLIERS = 2;

/**
 * Normalise un mot-clé de recherche pour la CLÉ DE CACHE : trim, minuscule,
 * espaces internes compressés. "  Argent   En Ligne " → "argent en ligne".
 * null si vide → l'appelant refuse la recherche.
 */
export function normalizeSearchKeyword(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const norm = input.trim().toLowerCase().replace(/\s+/g, " ");
  return norm === "" ? null : norm.slice(0, 100);
}

/** Vidéo parsée depuis la sortie clockworks en mode RECHERCHE par mot-clé. */
export interface RadarSearchVideo {
  tiktokId: string;
  url: string;
  authorId: string | null; // authorMeta.id — id NUMÉRIQUE stable (clé de groupage)
  authorHandle: string | null; // authorMeta.name
  publishedAt: number;
  caption: string | null;
  coverUrl: string | null;
  views: number; // playCount
  fans: number | null; // authorMeta.fans (abonnés du compte)
  likes: number;
  comments: number;
  shares: number;
  durationSec: number | null;
  textLanguage: string | null; // textLanguage ("en", "fr", ...)
}

/**
 * Parse la sortie clockworks en mode recherche → vidéos exploitables pour le
 * scoring. Capte en plus du parse profil l'`authorMeta.id` (groupage récurrence)
 * et `textLanguage` (filtre anglophone). Item sans id exploitable ignoré.
 */
export function parseRadarSearchVideos(apiResponse: unknown): RadarSearchVideo[] {
  const items = Array.isArray(apiResponse) ? apiResponse : [];
  const out: RadarSearchVideo[] = [];
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
    const authorHandle = cleanText(authorMeta.name, 100);
    const rawAuthorId = authorMeta.id;
    const authorId =
      typeof rawAuthorId === "string" || typeof rawAuthorId === "number"
        ? String(rawAuthorId)
        : null;

    out.push({
      tiktokId,
      url:
        firstString(item.webVideoUrl) ??
        (authorHandle
          ? `https://www.tiktok.com/@${authorHandle}/video/${tiktokId}`
          : `https://www.tiktok.com/video/${tiktokId}`),
      authorId,
      authorHandle,
      publishedAt: parsePublishedAt(item),
      caption: cleanText(item.text),
      coverUrl: firstString(
        videoMeta.coverUrl,
        videoMeta.cover,
        videoMeta.originCover,
        videoMeta.dynamicCover,
      ),
      views: toCount(item.playCount) ?? 0,
      fans: toCount(authorMeta.fans),
      likes: toCount(item.diggCount) ?? 0,
      comments: toCount(item.commentCount) ?? 0,
      shares: toCount(item.shareCount) ?? 0,
      durationSec: toCount(videoMeta.duration),
      textLanguage: cleanText(item.textLanguage, 8),
    });
  }
  return out;
}

/**
 * Outlier ratio = vues / abonnés. GARDE-FOU : null si abonnés absent ou ≤ 0
 * (vidéo exclue du classement plutôt que division par zéro). Jamais NaN/Infinity.
 */
export function computeOutlierRatio(views: number, fans: number | null): number | null {
  if (fans === null || !Number.isFinite(fans) || fans <= 0) return null;
  if (!Number.isFinite(views) || views < 0) return null;
  return views / fans;
}

/** Vidéo scorée + flags de récurrence du compte (prête à l'affichage/stockage). */
export interface RankedSearchVideo extends RadarSearchVideo {
  outlierRatio: number;
  accountOutlierCount: number; // nb de vidéos outlier de CE compte dans le lot
  isRecurringAccount: boolean; // accountOutlierCount ≥ RADAR_RECURRING_MIN_OUTLIERS
}

/**
 * Cœur de la Brique 3. À partir d'un lot brut de vidéos de recherche :
 *   1. ne garde QUE l'anglophone (textLanguage === "en") ;
 *   2. calcule l'outlier ratio, EXCLUT les vidéos sans abonnés exploitables ;
 *   3. groupe par authorId, compte les vidéos ≥ `threshold` par compte → un
 *      compte avec ≥ 2 outliers est « récurrent » (format validé) ;
 *   4. trie par outlier ratio DÉCROISSANT (on ignore l'ordre Apify, non fiable).
 * Les vidéos sans authorId ne peuvent pas être groupées → jamais récurrentes.
 * Pure (aucune I/O) → testée Vitest, répliquée dans convex/radarApi.ts.
 */
export function rankSearchVideos(
  videos: readonly RadarSearchVideo[],
  threshold: number = RADAR_OUTLIER_THRESHOLD,
): RankedSearchVideo[] {
  // 1-2. Filtre anglophone + ratio défini.
  const scored: (RadarSearchVideo & { outlierRatio: number })[] = [];
  for (const v of videos) {
    if (v.textLanguage !== "en") continue;
    const ratio = computeOutlierRatio(v.views, v.fans);
    if (ratio === null) continue;
    scored.push({ ...v, outlierRatio: ratio });
  }

  // 3. Compte des outliers par compte (authorId), uniquement ≥ seuil.
  const outliersByAuthor = new Map<string, number>();
  for (const v of scored) {
    if (v.authorId === null || v.outlierRatio < threshold) continue;
    outliersByAuthor.set(v.authorId, (outliersByAuthor.get(v.authorId) ?? 0) + 1);
  }

  const ranked: RankedSearchVideo[] = scored.map((v) => {
    const accountOutlierCount =
      v.authorId !== null
        ? (outliersByAuthor.get(v.authorId) ?? 0)
        : v.outlierRatio >= threshold
          ? 1
          : 0;
    return {
      ...v,
      accountOutlierCount,
      isRecurringAccount: accountOutlierCount >= RADAR_RECURRING_MIN_OUTLIERS,
    };
  });

  // 4. Tri par surperformance décroissante.
  ranked.sort((a, b) => b.outlierRatio - a.outlierRatio);
  return ranked;
}
