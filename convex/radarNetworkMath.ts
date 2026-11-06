/**
 * NOUVEAU RADAR — réseaux d'apps : règles PURES (aucun accès base, aucun réseau).
 *
 * Une app a un réseau de comptes TikTok qui la poussent. On rattache un compte à
 * une app quand une de ses légendes (ou son pseudo) la CITE — preuve forte. Un nom
 * qui est aussi un mot courant (« the ick », « cringe », « cheat love ») ne compte
 * qu'accompagné d'un mot de contexte (insta, tromperie, whatsapp…) : sans cette
 * garde, l'argot anglais « the ick » remplirait la base (vérifié le 06/11/2026 :
 * 0 vidéo de l'app sur les 30 en tête de #theick).
 *
 * Chaque compte suivi est relevé régulièrement ; une vidéo « sort du lot » quand
 * elle dépasse la médiane des vues de SON compte, ce qui est plus juste que vues ÷
 * abonnés pour des comptes neufs à 0 abonné.
 */

export type AppRule = {
  /** Cité tel quel (espaces, tirets et soulignés retirés) : suffit à rattacher. */
  strong: readonly string[];
  /** Mot courant : ne rattache qu'avec un mot de `context` dans la même légende. */
  weak?: readonly string[];
  context?: readonly string[];
};

export type SeedApp = AppRule & {
  slug: string;
  name: string;
  /** Slugs des projets dont l'app est concurrente. */
  rivalOf: readonly string[];
  /** Recherches de son réseau : mots-clés, et « #hashtag » pour une recherche de hashtag. */
  searches: readonly string[];
};

/**
 * Les apps de départ : concurrentes de Snytch (savoir qui quelqu'un suit) et de
 * BLUSH (lire une conversation). Signatures relevées le 06/11/2026 sur TikTok :
 * The Ick « prénom + secretaccount », CheatLove « prénom.stalk », RecentFollow
 * « prénom.girltea », What Brandon Thinks « prénomgumgum », The Cringe
 * « prénom_privateacc ».
 */
// Jamais un mot contenu dans un motif faible (« cheat » est dans « cheatlove ») :
// il se servirait de contexte à lui-même.
const STALK_CONTEXT = ["insta", "follow", "abonn", "tromp", "stalk", "infid", "infiel", "secret", "copain", "mec"];
const CHAT_CONTEXT = ["app", "whatsapp", "chat", "conv", "couple", "relation", "situationship", "toxic", "privateacc", "ex ", "#ex"];

export const SEED_APPS: readonly SeedApp[] = [
  { slug: "theick", name: "The Ick", rivalOf: ["snytch"], strong: ["theickio", "theick.io"], weak: ["theick"], context: STALK_CONTEXT, searches: ["theickio", "theick tromperie", "theick insta", "#theickio", "#theick"] },
  { slug: "cheatlove", name: "CheatLove", rivalOf: ["snytch"], strong: ["cheatloveio", "cheatlove.io"], weak: ["cheatlove"], context: STALK_CONTEXT, searches: ["cheatlove", "cheatlove tromperie", "#cheatlove"] },
  { slug: "recentfollow", name: "RecentFollow", rivalOf: ["snytch"], strong: ["recentfollow"], searches: ["recentfollow", "recent follow app", "#recentfollow"] },
  { slug: "whatbrandonthinks", name: "What Brandon Thinks", rivalOf: ["blush"], strong: ["whatbrandonthinks"], searches: ["whatbrandonthinks", "what brandon thinks whatsapp", "#whatbrandonthinks"] },
  { slug: "thecringe", name: "The Cringe", rivalOf: ["blush"], strong: ["thecringeapp"], weak: ["thecringe"], context: CHAT_CONTEXT, searches: ["thecringe", "the cringe app whatsapp", "#thecringe"] },
];

/** Comptes suivis au plus (tous réseaux) : le budget des relevés est calé dessus. */
export const MAX_TRACKED = 1_000;

/** Médiane fiable à partir de 5 vidéos connues ; jamais en dessous de 200 vues. */
export const MEDIAN_MIN_VIDEOS = 5;
export const MEDIAN_FLOOR = 200;
/** Vidéos du compte prises pour la médiane (les plus récentes). */
export const MEDIAN_WINDOW = 30;

/** Sort du lot de son compte : 3 fois sa médiane, et au moins 10 000 vues. */
export const PROMOTE_MULTIPLIER = 3;
export const PROMOTE_MIN_VIEWS = 10_000;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Minuscules ; `compact` sans espaces, tirets ni soulignés (« Recent Follow » → « recentfollow »). */
export function normalize(text: string) {
  const lower = text.toLowerCase();
  return { lower, compact: lower.replace(/[\s_\-]+/g, "") };
}

/** La légende ou le pseudo cite-t-il l'app ? */
export function citesApp(caption: string, handle: string, rule: AppRule): boolean {
  const { lower, compact } = normalize(`${caption} ${handle}`);
  if (rule.strong.some((p) => compact.includes(p))) return true;
  if (!rule.weak?.length) return false;
  const weakHit = rule.weak.some((p) => compact.includes(p));
  return weakHit && (rule.context ?? []).some((c) => lower.includes(c));
}

/** La première app citée (les apps sont essayées dans l'ordre donné). */
export function findApp<T extends AppRule>(caption: string, handle: string, apps: readonly T[]): T | undefined {
  return apps.find((a) => citesApp(caption, handle, a));
}

/** Médiane d'une liste de vues (undefined si trop peu de vidéos pour s'y fier). */
export function medianViews(views: readonly number[]): number | undefined {
  if (views.length < MEDIAN_MIN_VIDEOS) return undefined;
  const s = [...views].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Vues ÷ médiane du compte (au moins 200) ; undefined sans médiane fiable. */
export function multiplierOf(views: number, median: number | undefined): number | undefined {
  return median === undefined ? undefined : views / Math.max(median, MEDIAN_FLOOR);
}

/** À promouvoir dans Signaux : assez vue, et 3× sa médiane (ou 10× ses abonnés sans médiane). */
export function shouldPromote(views: number, multiplier: number | undefined, ratio: number): boolean {
  if (views < PROMOTE_MIN_VIEWS) return false;
  return multiplier !== undefined ? multiplier >= PROMOTE_MULTIPLIER : ratio >= 10;
}

/**
 * Prochain relevé d'un compte : chaque jour s'il a publié ces 3 derniers jours,
 * tous les 3 jours s'il est calme, chaque semaine s'il dort depuis plus de 14 jours.
 * Un compte relevé sans aucune vidéo repasse dans 3 jours (le premier relevé d'un
 * compte ajouté, lui, est immédiat : c'est son `nextReadAt` d'insertion).
 */
export function nextReadAt(lastPostAt: number | undefined, now: number): number {
  if (lastPostAt === undefined) return now + 3 * DAY;
  const idle = now - lastPostAt;
  if (idle <= 3 * DAY) return now + DAY;
  if (idle <= 14 * DAY) return now + 3 * DAY;
  return now + 7 * DAY;
}

/** Trois relevés d'affilée en échec (compte supprimé, privé) : le compte passe en pause. */
export const MAX_READ_ERRORS = 3;

/** « #thecringe » → recherche de hashtag ; sinon mot-clé. */
export function searchKind(s: string): { kind: "hashtag" | "keyword"; value: string } {
  return s.startsWith("#") ? { kind: "hashtag", value: s.slice(1) } : { kind: "keyword", value: s };
}

/** Pages lues par recherche de réseau (30 vidéos par page en mot-clé). */
export const NETWORK_PAGES = 2;
/** Un réseau se recherche à nouveau au bout d'une semaine. */
export const NETWORK_REFRESH_MS = 7 * DAY;
