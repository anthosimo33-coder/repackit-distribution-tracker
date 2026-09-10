/**
 * REPLI MAISON — lecture des compteurs d'un post TikTok dans le payload PUBLIC
 * de sa page, quand l'actor Apify déclare le post indisponible.
 *
 * ── Pourquoi ce module existe ────────────────────────────────────────────────
 * `clockworks/tiktok-scraper` rend `POST_NOT_FOUND_OR_PRIVATE` sur des posts
 * VIVANTS et PUBLICS. Constaté le 2026-08-31 sur 10 publications Snytch : 7
 * d'entre elles servent leurs compteurs à qui demande la page, anonymement
 * (39 000 vues sur l'une d'elles), pendant que l'app les peignait « 0 vue » —
 * et que la paie les rémunérait sur zéro (cf `convex/pricing.ts`). Le run A/B
 * a éliminé la forme de l'URL : l'échec est dans l'actor, pas dans nos données.
 *
 * ⚠️ CE MODULE NE REMPLACE PAS APIFY, ET NE DOIT PAS LE FAIRE. Il ne se
 * déclenche que sur les posts qu'Apify ABANDONNE. Ce qu'on paie chez Apify,
 * c'est la rotation de proxys ; ce repli marche parce qu'il est RARE. Le
 * généraliser aux ~220 posts de chaque nuit, depuis une IP unique, c'est le
 * motif qui fait blacklister — donc c'est le casser.
 *
 * ── La forme du payload, relevée sur la prod ─────────────────────────────────
 *   <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" …>{ __DEFAULT_SCOPE__: {
 *       "webapp.video-detail": {
 *          statusCode: 0, statusMsg: "",
 *          itemInfo: { itemStruct: { id, desc, author:{uniqueId},
 *                      stats: { playCount, diggCount, commentCount,
 *                               collectCount, shareCount } } } } } }</script>
 *
 * `statusCode` NON NUL = TikTok refuse de servir le post, et le dit :
 * `10204 / "item_privacy_authorization&status_self_see"` signifie « visible par
 * son autrice uniquement ». Ce n'est PAS un post supprimé, et ce n'est pas un
 * défaut de collecte à réessayer indéfiniment — c'est un fait à AFFICHER.
 *
 * ⚠️ Mélange de types ASSUMÉ par TikTok : `playCount` est un nombre,
 * `collectCount` une CHAÎNE ("108"). D'où `toCount` sur chaque champ — le même
 * helper que le relevé Apify, qui rejette aussi les négatifs.
 */

import { toCount } from "./apifyItem";

/** Compteurs d'un post, tels que la page publique les porte. */
export type TikTokPublicStats = {
  views: number;
  likes: number | null;
  comments: number | null;
  /** `collectCount` — les saves. Absent du chemin Apify sur cette route. */
  saves: number | null;
  shares: number | null;
  /** Légende (`desc`), null si vide — même convention que le relevé Apify. */
  title: string | null;
  /** `author.uniqueId`, pour contrôler qu'on lit bien le bon post. */
  authorHandle: string | null;
};

export type TikTokPublicResult =
  /** Compteurs lus. */
  | { kind: "stats"; stats: TikTokPublicStats }
  /**
   * TikTok REFUSE de servir le post et donne son motif. Définitif tant que le
   * réglage ne change pas : réessayer chaque nuit ne changera rien.
   */
  | { kind: "refused"; statusCode: number; statusMsg: string }
  /** Page illisible (balise absente, JSON cassé, post non trouvé dedans). */
  | { kind: "unreadable"; reason: string };

/**
 * `10204 / item_privacy_authorization&status_self_see` — le post est réglé sur
 * « visible par moi uniquement ». Constaté sur 3 publications Snytch dont
 * l'autrice confirmait pourtant qu'elles étaient « en ligne » : elles le sont,
 * pour elle seule.
 */
export const SELF_SEE_STATUS_CODE = 10204;

/** Libellé humain d'un refus, pour l'écran et le journal. */
export function refusalLabel(statusCode: number, statusMsg: string): string {
  if (statusCode === SELF_SEE_STATUS_CODE || statusMsg.includes("status_self_see")) {
    return "visible par son autrice uniquement";
  }
  if (statusMsg.includes("delete")) return "supprimé";
  return `refusé par TikTok (${statusCode})`;
}

/** Le `<script>` de réhydratation, non gourmand pour s'arrêter au bon `</script>`. */
const UNIVERSAL_DATA_RE =
  /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Lit les compteurs du post `postId` dans le HTML de sa page.
 *
 * `postId` est EXIGÉ et vérifié : la page porte aussi des vidéos recommandées,
 * et lire « le premier playCount venu » rendrait les compteurs d'un post qui
 * n'est pas le nôtre. Un écart d'id est une lecture ratée, pas une donnée.
 */
export function parseTikTokPublicPage(
  html: string,
  postId: string,
): TikTokPublicResult {
  const m = UNIVERSAL_DATA_RE.exec(html);
  if (!m) return { kind: "unreadable", reason: "balise de réhydratation absente" };

  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return { kind: "unreadable", reason: "payload JSON illisible" };
  }

  const detail = asRecord(
    asRecord(asRecord(data).__DEFAULT_SCOPE__)["webapp.video-detail"],
  );
  if (Object.keys(detail).length === 0) {
    return { kind: "unreadable", reason: "webapp.video-detail absent" };
  }

  const statusCode = toCount(detail.statusCode);
  const statusMsg = typeof detail.statusMsg === "string" ? detail.statusMsg : "";
  // statusCode 0 = servi. Non nul = refus explicite, avec son motif.
  if (statusCode !== 0) {
    return {
      kind: "refused",
      statusCode: statusCode ?? -1,
      statusMsg,
    };
  }

  const item = asRecord(asRecord(detail.itemInfo).itemStruct);
  const id = typeof item.id === "string" ? item.id : null;
  if (id === null) return { kind: "unreadable", reason: "itemStruct.id absent" };
  if (id !== postId) {
    // Garde-fou dur : on préfère ne rien rendre plutôt que les compteurs d'un
    // autre post.
    return {
      kind: "unreadable",
      reason: `id servi (${id}) ≠ id demandé (${postId})`,
    };
  }

  const stats = asRecord(item.stats);
  const views = toCount(stats.playCount);
  if (views === null) {
    return { kind: "unreadable", reason: "playCount absent ou illisible" };
  }
  const desc = typeof item.desc === "string" ? item.desc.trim() : "";
  const author = asRecord(item.author);

  return {
    kind: "stats",
    stats: {
      views,
      likes: toCount(stats.diggCount),
      comments: toCount(stats.commentCount),
      saves: toCount(stats.collectCount),
      shares: toCount(stats.shareCount),
      title: desc.length > 0 ? desc : null,
      authorHandle:
        typeof author.uniqueId === "string" && author.uniqueId.length > 0
          ? author.uniqueId
          : null,
    },
  };
}

/**
 * En-têtes d'un navigateur ordinaire. Sans `User-Agent` crédible, TikTok sert
 * une page sans payload — on ne serait pas bloqué, on lirait juste du vide, ce
 * qui est pire (une absence silencieuse au lieu d'une erreur).
 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml",
};

/**
 * Va chercher la page du post et en lit les compteurs.
 *
 * L'URL est NETTOYÉE de ses paramètres (`?_r=1&_t=…`, ajoutés par le partage
 * mobile) : ils n'apportent rien et allongent la clé de cache côté TikTok. Le
 * run A/B du 2026-08-31 a montré qu'ils ne changent RIEN au résultat côté
 * Apify — ce nettoyage est de l'hygiène, pas un correctif.
 *
 * `fetchImpl` est injecté pour les tests (même arrangement que `apifyApi`).
 * Aucune exception ne sort d'ici : une panne réseau est une lecture ratée, pas
 * un incident qui doit interrompre le relevé des autres posts.
 */
export async function fetchTikTokPublicStats(
  postUrl: string,
  postId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TikTokPublicResult> {
  const clean = postUrl.split("?")[0];
  let res: Response;
  try {
    res = await fetchImpl(clean, { headers: BROWSER_HEADERS });
  } catch (e) {
    return { kind: "unreadable", reason: `réseau : ${String(e).slice(0, 120)}` };
  }
  if (!res.ok) {
    return { kind: "unreadable", reason: `HTTP ${res.status}` };
  }
  let html: string;
  try {
    html = await res.text();
  } catch (e) {
    return { kind: "unreadable", reason: `corps illisible : ${String(e).slice(0, 80)}` };
  }
  return parseTikTokPublicPage(html, postId);
}
