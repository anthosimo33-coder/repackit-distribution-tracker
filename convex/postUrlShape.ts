/**
 * FORME D'UNE URL DE POST — plateforme réelle, lien de profil, lien non
 * rapprochable. Module PUR (aucun import `_generated`) → importable côté
 * serveur ET côté client, en UNE définition. Même patron que
 * `convex/postUrlDate.ts` et `convex/accountPhase.ts`.
 *
 * ── Le défaut que ce module ferme ────────────────────────────────────────────
 * Le 2026-09-03, des créatrices ne pouvaient plus déclarer leur publication :
 * « Copier le lien » de l'app TikTok iOS rend `tiktok.com/t/<code>`, une forme
 * que le détecteur client (`lib/inspiration-url.ts`) ne connaissait pas. La
 * garde refusait le lien en annonçant « ce lien n'est pas un lien TikTok » — sur
 * un lien TikTok — alors que le serveur ET toute la chaîne de relevé
 * l'acceptaient (`isTikTokShortlink` la connaît depuis l'espace clippeur).
 *
 * ── La règle, arbitrée ──────────────────────────────────────────────────────
 * ON NE BLOQUE QUE CE QU'ON PROUVE FAUX. Une liste blanche de formats d'URL
 * tenue à la main contre des plateformes tierces re-cassera à chaque changement
 * d'app — c'est déjà arrivé trois fois sans que personne le voie (`/share/`
 * d'Instagram, `watch?app=desktop&v=`, `tiktok.com/t/`). Donc :
 *   - un format INCONNU passe (le serveur tranche, et il est permissif) ;
 *   - seules deux choses sont refusées, parce qu'elles sont DÉMONTRABLES :
 *     l'URL est d'une autre plateforme que la cible, ou c'est un lien de PROFIL
 *     et pas de post.
 * Une garde qui refuse ce qu'elle n'a pas su lire fait perdre des publications ;
 * une garde qui refuse ce qu'elle a prouvé faux protège la paie.
 */

import { isTikTokShortlink, tiktokVideoIdFromUrl } from "./postUrlDate";
import type { Plateforme } from "./platforms";

/** Plateformes d'un lien de post. */
export type PostUrlPlatform = Plateforme;

/** Parse tolérant : accepte une URL sans schéma (`tiktok.com/@u/video/1`). */
function parse(url: string): URL | null {
  const raw = url.trim();
  if (raw === "") return null;
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

/** Segments de chemin non vides, en minuscules. */
function segments(u: URL): string[] {
  return u.pathname.split("/").filter(Boolean);
}

/** L'hôte appartient-il à ce domaine (lui-même ou un sous-domaine) ? */
function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Plateforme d'une URL de post, par son HÔTE.
 *
 * ⚠️ Remplace une détection par SOUS-CHAÎNE (`url.includes("tiktok.com")`) qui
 * disait « TikTok » de `https://tiktok.com.example/@u/video/1`. Un tel lien
 * était accepté, stocké, puis jamais rapproché par le relevé de vues : la
 * publication restait à zéro vue indéfiniment, sans que rien ne le signale.
 * Aucune URL de plateforme légitime ne perd la détection au change : le domaine
 * y est toujours l'hôte, jamais un morceau de chemin ou de paramètre.
 */
export function detectPostUrlPlatform(url: string): PostUrlPlatform | undefined {
  const u = parse(url);
  if (!u) return undefined;
  const host = u.hostname.toLowerCase();
  if (hostIs(host, "tiktok.com")) return "TikTok";
  if (hostIs(host, "instagram.com")) return "Instagram";
  if (hostIs(host, "youtube.com") || hostIs(host, "youtu.be")) return "YouTube";
  if (
    hostIs(host, "facebook.com") ||
    hostIs(host, "fb.com") ||
    hostIs(host, "fb.watch")
  ) {
    return "Facebook";
  }
  if (hostIs(host, "snapchat.com")) return "Snapchat";
  return undefined;
}

/** Premiers segments d'un chemin Instagram qui ne sont PAS un nom de compte. */
const INSTAGRAM_NON_ACCOUNT_ROOTS = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "share",
  "accounts",
]);

/** Onglets d'une chaîne YouTube — toujours du profil, jamais une vidéo. */
const YOUTUBE_CHANNEL_TABS = new Set([
  "videos",
  "shorts",
  "streams",
  "featured",
  "playlists",
  "community",
  "about",
  "podcasts",
]);

/**
 * Premiers segments d'un chemin Facebook qui ne sont PAS un nom de compte :
 * racines de post (`/reel/…`, `/watch?v=…`, `/share/r/…`, `/story.php?…`) ou
 * sections du site. `profile.php` n'y est PAS : c'est justement un profil.
 */
const FACEBOOK_NON_ACCOUNT_ROOTS = new Set([
  "reel",
  "reels",
  "watch",
  "share",
  "story.php",
  "permalink.php",
  "photo",
  "photo.php",
  "video.php",
  "videos",
  "posts",
  "stories",
  "groups",
  "events",
  "marketplace",
  "gaming",
  "hashtag",
  "l.php",
  "sharer.php",
  "login",
]);

/** Onglets d'une Page ou d'un profil Facebook — du profil, jamais un post. */
const FACEBOOK_PROFILE_TABS = new Set([
  "reels",
  "videos",
  "photos",
  "posts",
  "about",
  "followers",
  "friends",
  "mentions",
]);

/**
 * L'URL est-elle DÉMONTRABLEMENT un lien de profil (et non de post) ?
 *
 * Un lien de profil collé à la place d'un lien de post passait les deux gardes :
 * la plateforme est bonne, et rien ne regardait la forme. La publication était
 * créée sans vidéo derrière — donc sans vues à relever, jamais.
 *
 * Renvoie `false` dès qu'il y a le moindre doute : c'est un DENYLIST de formes
 * connues, pas une allowlist. Un format inédit n'est jamais « prouvé profil ».
 */
export function isAccountOnlyUrl(url: string, platform: PostUrlPlatform): boolean {
  const u = parse(url);
  if (!u) return false;
  const seg = segments(u).map((s) => s.toLowerCase());
  if (seg.length === 0) return false;

  if (platform === "TikTok") {
    // `/@handle` et RIEN d'autre. `/@handle/video/…`, `/t/…` → un post.
    return seg.length === 1 && seg[0].startsWith("@");
  }
  if (platform === "Instagram") {
    // `/username` seul. Toute racine de post/partage → pas un profil.
    return seg.length === 1 && !INSTAGRAM_NON_ACCOUNT_ROOTS.has(seg[0]);
  }
  if (platform === "Facebook") {
    // fb.watch ne sert que des vidéos.
    if (u.hostname.toLowerCase().endsWith("fb.watch")) return false;
    if (seg[0] === "profile.php") return true;
    // `/people/<nom>/<id>` : l'adresse d'un profil sans nom d'utilisateur.
    if (seg[0] === "people") return true;
    if (FACEBOOK_NON_ACCOUNT_ROOTS.has(seg[0])) return false;
    // `/page` seul, ou `/page/reels` : un onglet SANS identifiant de post.
    // `/page/videos/<id>` et `/page/posts/<id>` restent des posts.
    return (
      seg.length === 1 ||
      (seg.length === 2 && FACEBOOK_PROFILE_TABS.has(seg[1]))
    );
  }
  if (platform === "Snapchat") {
    // `/add/<user>` et `/@user` seul. `/spotlight/<id>` et
    // `/@user/spotlight/<id>` sont des posts.
    if (seg[0] === "add") return seg.length === 2;
    return seg.length === 1 && seg[0].startsWith("@");
  }
  // YouTube — `@handle`, `channel/UC…`, `c/…`, `user/…`, avec au plus un onglet.
  const root =
    seg[0].startsWith("@") ||
    ((seg[0] === "channel" || seg[0] === "c" || seg[0] === "user") &&
      seg.length >= 2);
  if (!root) return false;
  const rest = seg[0].startsWith("@") ? seg.slice(1) : seg.slice(2);
  return rest.length === 0 || (rest.length === 1 && YOUTUBE_CHANNEL_TABS.has(rest[0]));
}

/** Ce qu'une URL de publication a de DÉMONTRABLEMENT faux, ou `null`. */
export type PublishUrlIssue =
  /** L'URL est d'une autre plateforme que la cible. */
  | "wrong-platform"
  /** L'URL est un lien de profil, pas un lien de post. */
  | "account-url";

/**
 * Le seul verdict qui autorise un refus de saisie. `null` = « rien de prouvé »,
 * ce qui inclut le champ vide et tout format non reconnu : c'est le serveur qui
 * tranche, et il ne refuse que ce qu'il a lui-même prouvé faux (même module).
 *
 * L'ordre compte : quand les deux sont vrais (un profil Instagram sur une cible
 * TikTok), la mauvaise plateforme est le motif le plus utile à lire.
 */
export function publishUrlIssue(
  url: string,
  expectedPlatform: PostUrlPlatform,
): PublishUrlIssue | null {
  if (url.trim() === "") return null;
  // Illisible comme URL : ce n'est pas à cette garde de le dire — le serveur
  // répond « lien http(s) attendu », qui est le motif exact.
  if (parse(url) === null) return null;
  // Un HÔTE inconnu est prouvé faux (un post TikTok vit toujours sous
  // tiktok.com) ; un CHEMIN inconnu sur le bon hôte ne l'est pas. C'est toute
  // la différence entre « pas cette plateforme » et « format que je ne connais
  // pas encore », et le verdict rendu ici est mot pour mot celui du serveur.
  if (detectPostUrlPlatform(url) !== expectedPlatform) return "wrong-platform";
  return isAccountOnlyUrl(url, expectedPlatform) ? "account-url" : null;
}

/**
 * Motif LISIBLE d'une URL que le relevé de vues ne sait pas rapprocher.
 *
 * Le relevé extrait un identifiant de l'URL (id TikTok, shortcode Instagram) ;
 * sans lui, il n'a rien à demander à Apify. Ces publications étaient écartées
 * par un `continue` MUET : ni relevées, ni comptées en échec, donc invisibles —
 * une vidéo à zéro vue pour toujours, et personne pour s'en plaindre. Ce motif
 * part dans `publications.lastCollectFailureReason`, que l'écran affiche déjà
 * (cf `convex/collectAvailability.ts` : on dit « on ne sait pas », on ne peint
 * pas un zéro).
 *
 * Tronqué à 200 caractères, la borne de `recordCollectFailure` : un motif est
 * une phrase, pas un dump d'URL.
 */
export function unmatchableUrlReason(
  url: string,
  platform: PostUrlPlatform,
): string {
  // i18n-exempt: motif de collecte PERSISTÉ, lu dans le tracker ADMIN — jamais rendu dans un portail créateur (cf convex/tiktokInternal.ts, mêmes motifs en français).
  const raccourci = `Lien raccourci ${platform} non résolu — l'identifiant de la vidéo n'est pas dans l'URL, nouvelle tentative de résolution programmée`;
  // i18n-exempt: motif de collecte PERSISTÉ, lu dans le tracker ADMIN — jamais rendu dans un portail créateur.
  const illisible = `Lien de post non rapprochable pour ${platform} — ni identifiant de vidéo ni code de publication dans l'URL`;
  // i18n-exempt: motif de collecte PERSISTÉ, lu dans le tracker ADMIN — jamais rendu dans un portail créateur.
  const pasSpotlight = "Lien Snapchat sans Spotlight — seuls les Spotlight ont des vues publiques (une Story n'est pas mesurable)";
  const reason =
    platform === "TikTok" && isTikTokShortlink(url)
      ? raccourci
      : platform === "Snapchat"
        ? pasSpotlight
        : illisible;
  return reason.slice(0, 200);
}

// ─── Identité du post : la VIDÉO derrière le lien ────────────────────────────

/**
 * CLÉ DE LA VIDÉO derrière un lien de post — DÉFINITION UNIQUE du dépôt (la
 * garde de saisie, le drapeau doublon, la désignation d'un post par l'outil MCP
 * via `cleDeLienPost`) :
 *   - TikTok : `tiktok:<id>` (`/video/`, `/photo/`, `/v/`) ;
 *   - Instagram : `instagram:<shortcode>` (`/reel/`, `/reels/`, `/p/`, `/tv/`
 *     confondus, avec ou sans `@` devant, paramètres de partage ignorés) ;
 *   - YouTube : `youtube:<id>` (shorts, watch, youtu.be) ;
 *   - sinon l'adresse sans paramètres, sans `www.` ni `/` final, en minuscules.
 * `null` = pas un lien.
 *
 * ⚠️ Un LIEN COURT TikTok (`vm.`, `vt.`, `tiktok.com/t/`) n'a PAS d'id : sa clé
 * est son adresse. Chaque « Partager » en fabrique un nouveau pour la même
 * vidéo — 14 doublons sur 19 le 19/11/2026. Seule sa RÉSOLUTION (cf
 * convex/postUrlResolution) rend la clé de la vidéo : c'est pourquoi la saisie
 * résout avant d'écrire, et la résolution différée re-calcule la clé.
 */
export function postKeyOf(url: string): string | null {
  const brut = url.trim();
  const tiktok = tiktokVideoIdFromUrl(brut);
  if (tiktok) return `tiktok:${tiktok}`;
  let u: URL;
  try {
    u = new URL(brut);
  } catch {
    return null;
  }
  const hote = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (hote === "instagram.com") {
    const m = /^\/(?:[^/]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/.exec(u.pathname);
    if (m) return `instagram:${m[1]}`;
  }
  if (hote === "youtube.com" || hote === "youtu.be") {
    const id =
      hote === "youtu.be"
        ? u.pathname.slice(1).split("/")[0]
        : (/^\/shorts\/([A-Za-z0-9_-]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get("v"));
    if (id) return `youtube:${id}`;
  }
  return `${hote}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

/**
 * La clé désigne-t-elle une VIDÉO par son identifiant (TikTok, Instagram,
 * YouTube) — et non une simple adresse ? Une adresse peut être celle de
 * l'accueil TikTok, où mène un lien court mort : deux liens morts ne sont pas
 * la même vidéo. Seule une clé à identifiant prouve un doublon trouvé APRÈS
 * coup (résolution d'un lien court).
 */
export function isVideoKey(key: string | null): boolean {
  return key !== null && /^(?:tiktok|instagram|youtube):/.test(key);
}

