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
 * Les apps de départ, concurrentes en tête (l'ordre compte : `findApp` prend la
 * première citée).
 * - Snytch (savoir qui quelqu'un suit) : The Ick, CheatLove, RecentFollow, les
 *   7 apps du sourcing du 30/10/2026 (Stalkie, FollowSpy, Snitchy, Shady, Lurk,
 *   Katch, Susly), et Snitch, Crush Tracker (surtout en pub Meta) et Sunsay (citée
 *   par des comptes « prénom.stalk » sur #tromperie), sans réseau TikTok visible
 *   le 06/11/2026 : suivies pour le voir naître.
 * - BLUSH (lire une conversation, souffler la réponse) : What Brandon Thinks,
 *   The Cringe, et les apps de textos vérifiées le 06/11/2026 (Rizz App : comptes
 *   « histoires de textos » jusqu'à 2,3 M vues ; Plug AI ; Rizz Master et Flert
 *   Now au Brésil).
 * - Hors niche, même métier (armées de comptes dédiés) : celles du sourcing, et
 *   celles qu'une recherche du 06/11/2026 montre citées par plusieurs comptes ce
 *   mois-ci (Knowunity, Bible Chat, Cal AI, Glam AI, Finch), et Quittr, Umax et
 *   Creed (« prénom.prayer »), connues pour leurs comptes dédiés.
 * Signatures de pseudo relevées : The Ick « prénom + secretaccount », Voca AI
 * « prénom.vocaai », Lurk « prénom.lurk », FollowSpy et RecentFollow « prénom.chisme ».
 */
// Jamais un mot contenu dans un motif faible (« cheat » est dans « cheatlove ») :
// il se servirait de contexte à lui-même.
const STALK_CONTEXT = ["insta", "follow", "abonn", "tromp", "stalk", "infid", "infiel", "secret", "copain", "mec"];
const CHAT_CONTEXT = ["app", "whatsapp", "chat", "conv", "couple", "relation", "situationship", "toxic", "privateacc", "ex ", "#ex"];
const TEXT_CONTEXT = ["rizz", "text", "chat", "conversa", "crush", "date", "girl", "huzz", "cantada"];
const MEAL_CONTEXT = ["calor", "food", "meal", "comida", "refei", "repas", "diet", "macro"];
const LOOKS_CONTEXT = ["looksmax", "face", "rating", "jaw", "glow", "app"];
const FAITH_CONTEXT = ["prayer", "oração", "oracao", "bible", "bíblia", "biblia", "deus", "god", "jesus"];

const SNYTCH = ["snytch"] as const;
const BLUSH = ["blush"] as const;

export const SEED_APPS: readonly SeedApp[] = [
  { slug: "theick", name: "The Ick", rivalOf: SNYTCH, strong: ["theickio", "theick.io"], weak: ["theick"], context: STALK_CONTEXT, searches: ["theickio", "theick tromperie", "theick insta", "#theickio", "#theick"] },
  { slug: "cheatlove", name: "CheatLove", rivalOf: SNYTCH, strong: ["cheatloveio", "cheatlove.io"], weak: ["cheatlove"], context: STALK_CONTEXT, searches: ["cheatlove", "cheatlove tromperie", "#cheatlove"] },
  { slug: "recentfollow", name: "RecentFollow", rivalOf: SNYTCH, strong: ["recentfollow"], searches: ["recentfollow", "recent follow app", "#recentfollow"] },
  { slug: "stalkie", name: "Stalkie", rivalOf: SNYTCH, strong: ["stalkie"], searches: ["stalkie", "stalkie app", "#stalkie"] },
  { slug: "followspy", name: "FollowSpy", rivalOf: SNYTCH, strong: ["followspy"], searches: ["followspy", "#followspy"] },
  { slug: "snitchy", name: "Snitchy", rivalOf: SNYTCH, strong: ["snitchy"], searches: ["snitchy", "#snitchy"] },
  { slug: "shady", name: "Shady", rivalOf: SNYTCH, strong: ["shadyapp", "usoshady", "usashady", "conshady", "shadysabe"], weak: ["shady", "shody"], context: STALK_CONTEXT, searches: ["shady app stalk", "shady instagram"] },
  // « lurk » seul est de l'argot anglais : le pseudo « prénom.lurk » suffit.
  { slug: "lurk", name: "Lurk", rivalOf: SNYTCH, strong: [".lurk", "@lurk", "lurkambassador", "lurkapp"], searches: ["lurk app stalk", "lurk instagram"] },
  { slug: "katch", name: "Katch", rivalOf: SNYTCH, strong: ["katch.io", "katchio", "katchembaixador"], weak: ["katch"], context: STALK_CONTEXT, searches: ["katch.io", "katchio"] },
  { slug: "susly", name: "Susly", rivalOf: SNYTCH, strong: ["susly"], searches: ["susly", "susly app"] },
  // Après Snitchy : « creators.getsnitchy.app » ne doit pas devenir Snitch.
  { slug: "snitch", name: "Snitch", rivalOf: SNYTCH, strong: ["snitchapp"], searches: ["snitch app instagram", "snitchapp"] },
  { slug: "crushtracker", name: "Crush Tracker", rivalOf: SNYTCH, strong: ["crushtracker"], searches: ["crush tracker app"] },
  { slug: "sunsay", name: "Sunsay", rivalOf: SNYTCH, strong: ["sunsay"], searches: ["sunsay app", "sunsay"] },
  { slug: "whatbrandonthinks", name: "What Brandon Thinks", rivalOf: BLUSH, strong: ["whatbrandonthinks"], searches: ["whatbrandonthinks", "what brandon thinks whatsapp", "#whatbrandonthinks"] },
  { slug: "thecringe", name: "The Cringe", rivalOf: BLUSH, strong: ["thecringeapp"], weak: ["thecringe"], context: CHAT_CONTEXT, searches: ["thecringe", "the cringe app whatsapp", "#thecringe"] },
  { slug: "rizzapp", name: "Rizz App", rivalOf: BLUSH, strong: ["rizz.app", "rizzapp"], searches: ["rizz app", "rizz.app", "#rizzapp"] },
  { slug: "plugai", name: "Plug AI", rivalOf: BLUSH, strong: ["@plugai"], weak: ["plugai"], context: TEXT_CONTEXT, searches: ["plug ai rizz", "#plugai"] },
  { slug: "rizzmaster", name: "Rizz Master", rivalOf: BLUSH, strong: ["rizzmaster"], searches: ["rizz master app"] },
  { slug: "flertnow", name: "Flert Now", rivalOf: BLUSH, strong: ["flertnow"], searches: ["flert now"] },
  { slug: "vocaai", name: "Voca AI", rivalOf: [], strong: ["vocaai"], searches: ["voca ai", "#vocaai"] },
  { slug: "praktika", name: "Praktika", rivalOf: [], strong: ["praktika"], searches: ["praktika", "#praktika"] },
  { slug: "fluencify", name: "Fluencify", rivalOf: [], strong: ["fluencify"], searches: ["fluencify"] },
  { slug: "airlearn", name: "Airlearn", rivalOf: [], strong: ["airlearn"], searches: ["airlearn"] },
  { slug: "knowunity", name: "Knowunity", rivalOf: [], strong: ["knowunity"], searches: ["knowunity", "#knowunity"] },
  { slug: "biblechat", name: "Bible Chat", rivalOf: [], strong: ["biblechat"], searches: ["bible chat app", "#biblechat"] },
  { slug: "calai", name: "Cal AI", rivalOf: [], strong: ["@calai", "#calai", "calaiapp"], weak: ["calai"], context: MEAL_CONTEXT, searches: ["cal ai app"] },
  { slug: "glamai", name: "Glam AI", rivalOf: [], strong: ["glamai"], searches: ["glam ai app"] },
  { slug: "finch", name: "Finch", rivalOf: [], strong: ["finchapp", "finchcare", "finchselfcare"], searches: ["finch app self care"] },
  { slug: "airbuds", name: "Airbuds", rivalOf: [], strong: ["airbuds"], searches: ["airbuds", "#airbuds"] },
  { slug: "flo", name: "Flo", rivalOf: [], strong: ["floapp", "embaixadoraflo", "flohealth", "flo.health"], searches: ["#floapp", "#embaixadoraflo"] },
  { slug: "sweatcoin", name: "Sweatcoin", rivalOf: [], strong: ["sweatcoin"], searches: ["sweatcoin"] },
  { slug: "kairo", name: "Kairo Alarme", rivalOf: [], strong: ["kairoalarme", "joinkairo", "kairoapp"], searches: ["kairo alarme"] },
  { slug: "safenow", name: "SafeNow", rivalOf: [], strong: ["safenow"], searches: ["safenow app"] },
  { slug: "loverzz", name: "Loverzz", rivalOf: [], strong: ["loverzz"], searches: ["loverzz"] },
  { slug: "palima", name: "Palima", rivalOf: [], strong: ["palima"], searches: ["palima app"] },
  { slug: "quittr", name: "Quittr", rivalOf: [], strong: ["quittr"], searches: ["quittr", "#quittr"] },
  { slug: "umax", name: "Umax", rivalOf: [], strong: ["umaxapp", "@umax"], weak: ["umax"], context: LOOKS_CONTEXT, searches: ["umax app", "#umax"] },
  { slug: "creed", name: "Creed", rivalOf: [], strong: ["creedapp", "creed.app"], weak: ["creed"], context: FAITH_CONTEXT, searches: ["creed app oração", "creed app prayer"] },
];

/**
 * Comptes suivis au plus (tous réseaux) : le budget des relevés est calé dessus
 * (2 000 relevés/jour suivent 3 000 comptes au rythme adaptatif). Le fondateur
 * veut le plus de données possible pour repérer les formats (06/11/2026).
 */
export const MAX_TRACKED = 3_000;
/**
 * Une app qui n'est concurrente d'aucun projet ne prend pas plus de 100 comptes,
 * et toutes ensemble pas plus de 1 800 : 1 200 places restent aux concurrentes.
 * Les comptes de départ et ceux ajoutés à la main passent outre.
 */
export const MAX_PER_OTHER_APP = 100;
export const MAX_OTHER_TOTAL = 1_800;

/** Le compte peut-il entrer ? `counts` : comptes suivis en tout, par app, et des apps non concurrentes. */
export function canTrack(
  counts: { total: number; ofApp: number; others: number },
  rival: boolean,
  bypassAppCaps: boolean,
): boolean {
  if (counts.total >= MAX_TRACKED) return false;
  if (rival || bypassAppCaps) return true;
  return counts.ofApp < MAX_PER_OTHER_APP && counts.others < MAX_OTHER_TOTAL;
}

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

/** Pages lues par recherche de réseau (30 vidéos par page en mot-clé) : 3 pour une concurrente, 2 sinon. */
export const networkPages = (rival: boolean) => (rival ? 3 : 2);
/** Un réseau se recherche à nouveau au bout de 3 jours pour une concurrente, d'une semaine sinon. */
export const networkRefreshMs = (rival: boolean) => (rival ? 3 : 7) * DAY;

// ─── Formats qui circulent, apps repérées ────────────────────────────────────

/** Un format partagé se lit sur les 14 derniers jours de publication. */
export const FORMAT_WINDOW_MS = 14 * DAY;
/** Membres gardés par format (les plus vus). */
export const FORMAT_MAX_MEMBERS = 40;

/**
 * Clé d'un hook (texte à l'écran) : minuscules, sans accents, emojis ni
 * ponctuation. `null` s'il est trop court pour dire un format (moins de 3 mots).
 */
export function hookKey(hook: string | undefined): string | null {
  if (!hook) return null;
  const k = hook
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return k.split(" ").length >= 3 && k.length >= 12 ? k : null;
}

/** Domaines qui ne sont pas des apps (liens de bio, messageries). */
const NOT_APP_DOMAINS = new Set(["beacons.ai", "snipfeed.co", "carrd.co", "komi.io", "linkin.bio", "hoo.be", "bento.me", "msha.ke", "lnk.bio", "solo.to", "fanfix.io", "throne.me"]);

/** Les domaines d'app cités (« followspy.ai », « creators.stalkie.io » → « stalkie.io »). */
export function domainsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/(?:^|[^a-z0-9.@-])(?:[a-z0-9-]+\.)*([a-z0-9][a-z0-9-]{2,30}\.(?:io|ai|app|co|me|so|gg))(?![a-z0-9])/g)) {
    if (!NOT_APP_DOMAINS.has(m[1])) out.add(m[1]);
  }
  return [...out];
}

export type Mention = { id: string; label: string };
export type Candidate = { key: string; kind: "mention" | "domain"; label: string };

/**
 * Ce qu'un compte cite et qui pourrait être une app : les comptes mentionnés dans
 * ses légendes (sauf lui-même) et les domaines de ses légendes et de sa bio.
 */
export function candidatesOf(s: { caption: string; authorId: string; mentions?: readonly Mention[]; authorBio?: string }): Candidate[] {
  const out = new Map<string, Candidate>();
  for (const m of s.mentions ?? []) {
    if (m.id && m.id !== s.authorId && m.label.length >= 3) out.set(`@${m.id}`, { key: `@${m.id}`, kind: "mention", label: m.label });
  }
  for (const d of domainsIn(`${s.caption} ${s.authorBio ?? ""}`)) out.set(d, { key: d, kind: "domain", label: d });
  return [...out.values()];
}

/** Motifs d'une app créée depuis une app repérée : le domaine, et son nom sans extension. */
export function patternsOfCandidate(c: Pick<Candidate, "kind" | "label">): string[] {
  const base = normalize(c.label.replace(/^@/, "")).compact;
  if (c.kind === "domain") return [base, base.replace(/\.[a-z]+$/, "")].filter((p, i, a) => p.length >= 3 && a.indexOf(p) === i);
  return base.length >= 3 ? [base] : [];
}
