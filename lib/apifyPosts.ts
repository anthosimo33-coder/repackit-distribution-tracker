/**
 * Apify TikTok/Instagram — helpers PURS pour le tracking auto des vues (cron
 * quotidien). Aucune dépendance Convex/React → testé Vitest (lib/apifyPosts.test.ts).
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/ (bundles séparés). Ces fonctions
 * sont RÉPLIQUÉES côté serveur (convex/apifyApi.ts) pour l'action de fetch + le
 * cron ; toute évolution ici doit l'être là-bas. Les tests vivent ici.
 *
 * Rôle : (a) extraire une CLÉ DE POST stable d'une URL TikTok/Instagram (id
 * numérique TikTok, shortcode Instagram) pour rapprocher la sortie Apify de la
 * publication d'origine SANS dépendre de la normalisation d'URL ; (b) parser la
 * sortie des actors Apify en `clé → vues`. La détection de PLATEFORME se fait en
 * amont via `publications.plateforme` (on ne devine rien depuis l'URL ici).
 */

import {
  parseSaves,
  parseAuthorProfile,
  hasAnyCount,
  type AuthorProfile,
} from "../convex/apifyItem";

/**
 * "123" → 123 ; nombre fini POSITIF OU NUL → lui-même ; tout le reste → null.
 *
 * UN NÉGATIF EST UN CODE D'ABSENCE, PAS UN COMPTEUR. L'actor Instagram renvoie
 * `likesCount: -1` quand le compte masque ses likes ; stocké tel quel, il
 * s'affichait « -1 like », faussait les sommes et rendait le taux d'engagement
 * NÉGATIF. Aucun compteur qui passe par ici n'admet de négatif légitime (vues,
 * likes, commentaires, saves, abonnés/abonnements/likes cumulés). Le seul
 * compteur du domaine qui en admettrait un — `subsGained`, une perte d'abonnés
 * — est une saisie manuelle et ne passe PAS par cette fonction.
 *
 * `null` veut dire « non collecté », comme pour une valeur absente : c'est
 * l'appelant qui décide quoi en faire, et il le décide déjà (cf `parseSaves`).
 */
export function toCount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

/** Parse tolérante d'une URL : accepte l'absence de scheme. null si illisible. */
function parseUrl(input: string | null | undefined): URL | null {
  if (typeof input !== "string" || input.trim() === "") return null;
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

const TIKTOK_ID_RE = /\/(?:video|photo)\/(\d+)/;
const INSTAGRAM_CODE_RE = /\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/;

/**
 * Clé de post TikTok = l'id NUMÉRIQUE de la vidéo (`/video/<id>` ou
 * `/photo/<id>`). C'est la même valeur que `item.id` renvoyé par l'actor → permet
 * de rapprocher sortie ↔ publication sans normaliser l'URL (params, www, slash
 * final). Les shortlinks (vm./vt.tiktok.com/XXXX) n'exposent PAS l'id → null
 * (post non rapprochable, loggué/skippé en amont). Retourne null hors TikTok.
 */
export function tiktokPostId(input: string | null | undefined): string | null {
  const url = parseUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.|vm\.|vt\.)/, "");
  if (host !== "tiktok.com" && !host.endsWith(".tiktok.com")) return null;
  const m = TIKTOK_ID_RE.exec(url.pathname);
  return m ? m[1] : null;
}

/**
 * Clé de post Instagram = le SHORTCODE (`/reel/<code>`, `/reels/<code>`,
 * `/p/<code>`, `/tv/<code>`). Égal à `item.shortCode` renvoyé par l'actor.
 * Retourne null hors Instagram ou si aucun shortcode (profil, etc.).
 */
export function instagramShortcode(
  input: string | null | undefined,
): string | null {
  const url = parseUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, "");
  if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return null;
  const m = INSTAGRAM_CODE_RE.exec(url.pathname);
  return m ? m[1] : null;
}

/** Stat d'UN post relevée via Apify : vues + likes + titre (= légende). */
export interface ApifyPostStat {
  /** Vues (playCount TikTok ; videoPlayCount/videoViewCount Instagram). */
  views: number;
  /** Likes (diggCount TikTok ; likesCount Instagram) ; null si non fourni. */
  likes: number | null;
  /** Commentaires (commentCount TikTok ; commentsCount Instagram) ; null si non fourni. */
  comments: number | null;
  /** Légende = titre du post (text TikTok ; caption Instagram) ; null si vide. */
  title: string | null;
  /**
   * SAVES (`collectCount`, TikTok uniquement) ; `null` = NON COLLECTÉ.
   *
   * Instagram et YouTube n'exposent aucune métrique de saves : sur ces
   * plateformes `null` est la réponse DÉFINITIVE, pas un défaut de collecte.
   * Ne jamais replier sur 0 — les règles du playbook distinguent « non mesuré »
   * de « mesuré à zéro » (cf convex/graduation.ts).
   */
  saves: number | null;
  /**
   * Compteurs du COMPTE auteur (`authorMeta`), servis GRATUITEMENT avec chaque
   * item vidéo TikTok — donc sans run supplémentaire. `null` si absents.
   *
   * Portés PAR POST plutôt qu'indexés par handle : le rattachement au compte
   * applicatif se fait via la publication. Le handle de l'URL TikTok
   * (« kellyleydie ») ne coïncide pas avec celui saisi en base
   * (« @kelly.leydie ») — un appariement par chaîne serait faux.
   */
  author: AuthorProfile | null;
}

export interface ParsedApifyViews {
  /** clé de post → stat, pour chaque post PRÉSENT et exploitable dans la sortie. */
  stats: Record<string, ApifyPostStat>;
  /** clés demandées ABSENTES (post privé/supprimé, ou image Insta sans vues). */
  unavailable: string[];
}

/** Longueur max stockée d'une légende-titre (l'UI tronque visuellement en plus). */
const TITLE_MAX = 500;

/** Légende → titre propre : trim, null si vide, tronqué à TITLE_MAX. */
export function cleanCaption(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "") return null;
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) : t;
}

/**
 * Parse la sortie de l'actor TikTok (clockworks/tiktok-scraper) :
 *   [{ id: "123", playCount: 4567, diggCount: 89, commentCount: 12, text: "légende", webVideoUrl, ... }, ...]
 * Clé = `id` (fallback : id extrait de `webVideoUrl`). Vues = `playCount`,
 * likes = `diggCount`, commentaires = `commentCount`, titre = `text` (la légende
 * = titre TikTok). Un post sans
 * clé ou sans playCount exploitable est ignoré (jamais d'exception). Robuste à un
 * JSON partiel/inattendu.
 */
export function parseTikTokViews(
  apiResponse: unknown,
  requestedKeys: readonly string[],
): ParsedApifyViews {
  const stats: Record<string, ApifyPostStat> = {};
  const items = Array.isArray(apiResponse) ? apiResponse : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rawId = (item as { id?: unknown }).id;
    const key =
      typeof rawId === "string" || typeof rawId === "number"
        ? String(rawId)
        : tiktokPostId((item as { webVideoUrl?: unknown }).webVideoUrl as string);
    if (!key) continue;
    const views = toCount((item as { playCount?: unknown }).playCount);
    if (views === null) continue;
    const likes = toCount((item as { diggCount?: unknown }).diggCount);
    const comments = toCount((item as { commentCount?: unknown }).commentCount);
    const title = cleanCaption((item as { text?: unknown }).text);
    // `collectCount` était reçu et jeté : la lecture vit maintenant dans le
    // helper partagé avec RADAR (convex/apifyItem.ts).
    const profil = parseAuthorProfile(item);
    stats[key] = {
      views,
      likes,
      comments,
      title,
      // `collectCount` et `authorMeta` étaient reçus et jetés : la lecture vit
      // maintenant dans le helper partagé avec RADAR (convex/apifyItem.ts).
      saves: parseSaves(item),
      author: hasAnyCount(profil) ? profil : null,
    };
  }
  const present = new Set(Object.keys(stats));
  return { stats, unavailable: requestedKeys.filter((k) => !present.has(k)) };
}

/**
 * Parse la sortie de l'actor Instagram (apify/instagram-scraper, resultsType
 * "posts") :
 *   [{ shortCode: "Cxyz", videoPlayCount, videoViewCount, likesCount, commentsCount, caption, type: "Video", url, ... }, ...]
 * Clé = `shortCode` (fallback : shortcode extrait de `url`). Vues =
 * `videoPlayCount` puis fallback `videoViewCount`, likes = `likesCount`,
 * commentaires = `commentsCount`, titre = `caption`. ⚠️ Un post IMAGE n'a aucune
 * vue → ignoré (pas de snapshot), reporté
 * en `unavailable`.
 */
export function parseInstagramViews(
  apiResponse: unknown,
  requestedKeys: readonly string[],
): ParsedApifyViews {
  const stats: Record<string, ApifyPostStat> = {};
  const items = Array.isArray(apiResponse) ? apiResponse : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rawCode = (item as { shortCode?: unknown }).shortCode;
    const key =
      typeof rawCode === "string" && rawCode !== ""
        ? rawCode
        : instagramShortcode((item as { url?: unknown }).url as string);
    if (!key) continue;
    const views =
      toCount((item as { videoPlayCount?: unknown }).videoPlayCount) ??
      toCount((item as { videoViewCount?: unknown }).videoViewCount);
    if (views === null) continue;
    const likes = toCount((item as { likesCount?: unknown }).likesCount);
    const comments = toCount((item as { commentsCount?: unknown }).commentsCount);
    const title = cleanCaption((item as { caption?: unknown }).caption);
    // Instagram n'expose AUCUNE métrique de saves — `null` est définitif ici,
    // pas un défaut de collecte à rattraper plus tard.
    stats[key] = { views, likes, comments, title, saves: null, author: null };
  }
  const present = new Set(Object.keys(stats));
  return { stats, unavailable: requestedKeys.filter((k) => !present.has(k)) };
}
