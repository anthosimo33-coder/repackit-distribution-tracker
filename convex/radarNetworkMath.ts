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
  /**
   * Tournures courantes (avec leurs espaces) qui contiennent le nom sans le
   * citer : retirées du texte avant de chercher. « his recent following » n'est
   * pas RecentFollow (09/11/2026 : 17 vidéos sur 246, dont celles de followpeek.com).
   */
  not?: readonly string[];
};

export type SeedApp = AppRule & {
  slug: string;
  name: string;
  /** Slugs des projets dont l'app est concurrente. */
  rivalOf: readonly string[];
  /** Recherches de son réseau : mots-clés, et « #hashtag » pour une recherche de hashtag. */
  searches: readonly string[];
  /**
   * Slugs sous lesquels l'app a été ajoutée à la main par erreur : un doublon
   * (« Voca A » pour Voca AI, le nom de la mention coupé d'une lettre) ou un nom
   * à slogan (« Serializd | TV tracking app »). L'app prend le bon slug, ou le
   * doublon est fondu dans l'app (radarSignals.syncSeedApp).
   */
  formerSlugs?: readonly string[];
};

/**
 * Les apps de départ, concurrentes en tête (l'ordre compte : `findApp` prend la
 * première citée).
 * - Snytch (savoir qui quelqu'un suit) : The Ick, CheatLove, RecentFollow, les
 *   apps du sourcing du 30/10/2026 (FollowSpy, Lurk, Katch, Susly), FollowOtter
 *   (app à part, décidé le 09/11/2026 : ses 13 comptes « prénom.girltea » et
 *   « prénom.girlcode », 8,7 M vues en 30 jours, étaient rangés sous FollowSpy
 *   sans la citer), et Snitch, Crush Tracker (surtout en pub Meta) et Sunsay
 *   (citée par des comptes « prénom.stalk » sur #tromperie), sans réseau TikTok
 *   visible le 06/11/2026 : suivies pour le voir naître.
 * - Stalkie, Snitchy et Shady sont des JEUX D'ENQUÊTE (fouiller un téléphone),
 *   pas des suiveurs d'abonnements : déclassées le 09/11/2026 — elles ne sont
 *   plus concurrentes de Snytch (ni places réservées, ni alerte, ni chiffres des
 *   concurrents) mais restent suivies comme les autres apps, pour leurs formats.
 * - BLUSH (lire une conversation, souffler la réponse) : What Brandon Thinks,
 *   The Cringe, et les apps de textos vérifiées le 06/11/2026 (Rizz App : comptes
 *   « histoires de textos » jusqu'à 2,3 M vues ; Plug AI ; Rizz Master et Flert
 *   Now au Brésil), et WRizz et Wing AI (décidé le 10/11/2026 : suivies à la
 *   main depuis la veille, 61 et 6 comptes).
 * - Apps de couple (Loverzz, Love8) : pas des concurrentes, suivies pour leurs
 *   formats — c'est la niche que ramène la découverte (« app pour couple »).
 * - Hors niche, même métier (armées de comptes dédiés) : celles du sourcing, et
 *   celles qu'une recherche du 06/11/2026 montre citées par plusieurs comptes ce
 *   mois-ci (Knowunity, Bible Chat, Cal AI, Glam AI, Finch), et Quittr, Umax et
 *   Creed (« prénom.prayer »), connues pour leurs comptes dédiés ; Astra AI et
 *   Retain Cards (révisions), demandées par le fondateur le 10/11/2026.
 * Signatures de pseudo relevées : The Ick « prénom + secretaccount », Voca AI
 * « prénom.vocaai », Lurk « prénom.lurk », FollowSpy et RecentFollow « prénom.chisme »,
 * Retain Cards « etudie.avec.prénom », Astra AI « study/learn with prénom » avec un
 * dièse à quatre chiffres en légende (#4402, #4502 : le numéro de la vidéo fournie).
 */
// Jamais un mot contenu dans un motif faible (« cheat » est dans « cheatlove ») :
// il se servirait de contexte à lui-même.
const STALK_CONTEXT = ["insta", "follow", "abonn", "tromp", "stalk", "infid", "infiel", "secret", "copain", "mec"];
const CHAT_CONTEXT = ["app", "whatsapp", "chat", "conv", "couple", "relation", "situationship", "toxic", "privateacc", "ex ", "#ex"];
const TEXT_CONTEXT = ["rizz", "text", "chat", "conversa", "crush", "date", "girl", "huzz", "cantada"];
const MEAL_CONTEXT = ["calor", "food", "meal", "comida", "refei", "repas", "diet", "macro"];
const LOOKS_CONTEXT = ["looksmax", "face", "rating", "jaw", "glow", "app"];
const FAITH_CONTEXT = ["prayer", "oração", "oracao", "bible", "bíblia", "biblia", "deus", "god", "jesus"];
// Ni « univers » (l'astrologie dit « the universe ») ni « tutor » (« tutorial ») : ils laisseraient passer les homonymes.
// « learnw » est le pseudo « learnwith… » ou « learnw.… », jamais « learn what » ; « belajar » et « opiskel » : étudier en indonésien, en finnois.
const STUDY_CONTEXT = ["stud", "étud", "etud", "exam", "révis", "revis", "lern", "leren", "school", "schule", "scuola", "escuela", "escola", "lycée", "lycee", "universit", "flashcard", "karteikarte", "fiches", "math", "homework", "gcse", "learnw", "prüf", "belajar", "opiskel"];

const SNYTCH = ["snytch"] as const;
const BLUSH = ["blush"] as const;

export const SEED_APPS: readonly SeedApp[] = [
  { slug: "theick", name: "The Ick", rivalOf: SNYTCH, strong: ["theickio", "theick.io"], weak: ["theick"], context: STALK_CONTEXT, searches: ["theickio", "theick tromperie", "theick insta", "#theickio", "#theick"] },
  { slug: "cheatlove", name: "CheatLove", rivalOf: SNYTCH, strong: ["cheatloveio", "cheatlove.io"], weak: ["cheatlove"], context: STALK_CONTEXT, searches: ["cheatlove", "cheatlove tromperie", "#cheatlove"] },
  { slug: "recentfollow", name: "RecentFollow", rivalOf: SNYTCH, strong: ["recentfollow"], not: ["recent following", "recent follows", "recent follower", "recently follow"], searches: ["recentfollow", "recent follow app", "#recentfollow"] },
  { slug: "followspy", name: "FollowSpy", rivalOf: SNYTCH, strong: ["followspy"], searches: ["followspy", "#followspy"] },
  // « Follow Otter » s'écrit aussi en deux mots : la forme collée couvre les deux.
  { slug: "followotter", name: "FollowOtter", rivalOf: SNYTCH, strong: ["followotter"], searches: ["followotter", "follow otter app", "#followotter"] },
  // « lurk » seul est de l'argot anglais : le pseudo « prénom.lurk » suffit.
  { slug: "lurk", name: "Lurk", rivalOf: SNYTCH, strong: [".lurk", "@lurk", "lurkambassador", "lurkapp"], searches: ["lurk app stalk", "lurk instagram"] },
  { slug: "katch", name: "Katch", rivalOf: SNYTCH, strong: ["katch.io", "katchio", "katchembaixador"], weak: ["katch"], context: STALK_CONTEXT, searches: ["katch.io", "katchio"] },
  { slug: "susly", name: "Susly", rivalOf: SNYTCH, strong: ["susly"], searches: ["susly", "susly app"] },
  // « Snitch app » est aussi une marque de vêtements indienne : le domaine seul
  // (« creators.getsnitchy.app » ne le contient pas : Snitchy garde ses vidéos).
  { slug: "snitch", name: "Snitch", rivalOf: SNYTCH, strong: ["snitchapp.io"], searches: ["snitch app instagram", "snitchapp"] },
  { slug: "crushtracker", name: "Crush Tracker", rivalOf: SNYTCH, strong: ["crushtracker"], searches: ["crush tracker app"] },
  // « Sunsay » est aussi un chanteur et une marque d'énergie : seul, il lui faut un mot de contexte.
  { slug: "sunsay", name: "Sunsay", rivalOf: SNYTCH, strong: ["sunsay.app", "sunsayapp", "@sunsay"], weak: ["sunsay"], context: STALK_CONTEXT, searches: ["sunsay app", "sunsay"] },
  { slug: "whatbrandonthinks", name: "What Brandon Thinks", rivalOf: BLUSH, strong: ["whatbrandonthinks"], searches: ["whatbrandonthinks", "what brandon thinks whatsapp", "#whatbrandonthinks"], formerSlugs: ["whatbrandonthink"] },
  { slug: "thecringe", name: "The Cringe", rivalOf: BLUSH, strong: ["thecringeapp"], weak: ["thecringe"], context: CHAT_CONTEXT, searches: ["thecringe", "the cringe app whatsapp", "#thecringe"] },
  // WRizz et Wing AI soufflent la réponse à un texto : ajoutées à la main le 09/11/2026, concurrentes de
  // BLUSH depuis le 10/11. « wrizz » seul se lit dans « W rizz », « new rizz » et @shadowrizzler70 (43 des
  // 311 vidéos qui le contenaient) : il faut l'arobase, le dièse ou le site. Placée AVANT Rizz App, dont
  // les motifs sont dans « wrizz.app » et « #wrizzapp ».
  { slug: "wrizz", name: "WRizz", rivalOf: BLUSH, strong: ["@wrizz", "#wrizz", "wrizzapp", "wrizz.app", "wrizzz.app"], searches: ["wrizz", "wrizz app", "#wrizz"] },
  // Citée « @WingAI », « #wingai » ou « @wingai_app » ; « wingai » seul est dans « following AI ».
  { slug: "wingaiapp", name: "Wing AI", rivalOf: BLUSH, strong: ["@wingai", "#wingai", "wingaiapp"], searches: ["wingai", "wing ai app", "#wingai"] },
  { slug: "rizzapp", name: "Rizz App", rivalOf: BLUSH, strong: ["rizz.app", "rizzapp"], not: ["wrizz"], searches: ["rizz app", "rizz.app", "#rizzapp"] },
  { slug: "plugai", name: "Plug AI", rivalOf: BLUSH, strong: ["@plugai"], weak: ["plugai"], context: TEXT_CONTEXT, searches: ["plug ai rizz", "#plugai"] },
  { slug: "rizzmaster", name: "Rizz Master", rivalOf: BLUSH, strong: ["rizzmaster"], searches: ["rizz master app"] },
  { slug: "flertnow", name: "Flert Now", rivalOf: BLUSH, strong: ["flertnow"], searches: ["flert now"] },
  // Jeux d'enquête, déclassés le 09/11/2026 : suivis pour leurs formats, plus concurrents de Snytch.
  { slug: "stalkie", name: "Stalkie", rivalOf: [], strong: ["stalkie"], searches: ["stalkie", "stalkie app", "#stalkie"] },
  { slug: "snitchy", name: "Snitchy", rivalOf: [], strong: ["snitchy"], searches: ["snitchy", "#snitchy"] },
  { slug: "shady", name: "Shady", rivalOf: [], strong: ["shadyapp", "usoshady", "usashady", "conshady", "shadysabe"], weak: ["shady", "shody"], context: STALK_CONTEXT, searches: ["shady app stalk", "shady instagram"] },
  // Le jeu d'enquête que poussent les comptes de Stalkie ; « leaked » seul est un mot courant.
  { slug: "leakeddms", name: "Leaked DMs", rivalOf: [], strong: ["leakeddms"], searches: ["leaked dms detective game", "#leakeddms"], formerSlugs: ["leakeddmsdetectivegame"] },
  // « Voca A » (09/11/2026) : 12 de ses 14 comptes citaient #vocaa (un lycée mexicain), « invoca a… », un cosplay.
  { slug: "vocaai", name: "Voca AI", rivalOf: [], strong: ["vocaai"], searches: ["voca ai", "#vocaai"], formerSlugs: ["vocaa"] },
  { slug: "praktika", name: "Praktika", rivalOf: [], strong: ["praktika"], searches: ["praktika", "#praktika"] },
  { slug: "fluencify", name: "Fluencify", rivalOf: [], strong: ["fluencify"], searches: ["fluencify"] },
  { slug: "airlearn", name: "Airlearn", rivalOf: [], strong: ["airlearn"], searches: ["airlearn"] },
  { slug: "knowunity", name: "Knowunity", rivalOf: [], strong: ["knowunity"], searches: ["knowunity", "#knowunity"] },
  // Astra AI (tuteur d'examens, Slovénie) et Retain Cards (fiches de révision, Allemagne), demandées par le
  // fondateur le 10/11/2026 : deux programmes créateurs qui montent des comptes d'étude dédiés, surtout en
  // France (Astra : vidéos fournies, 0,30 € les 1 000 vues ; Retain : fixe par vidéo + prime). Légendes lues
  // ce jour-là sous #astraai et #retaincards.
  // « Astra AI » est aussi une app de portrait d'âme sœur, une d'avatars vidéo et un assistant : hors des
  // pseudos officiels et du site, il lui faut un mot d'étude à côté.
  { slug: "astraai", name: "Astra AI", rivalOf: [], strong: ["astraai.co", "astraai.de", "astraaiofficial", "astraaies", "astraaisi"], weak: ["astraai"], context: STUDY_CONTEXT, searches: ["astra ai", "astra ai révision", "#astraai"] },
  // « retain cards » au pluriel est le nom ; au singulier (« retain cardio »), il lui faut un mot d'étude.
  { slug: "retaincards", name: "Retain Cards", rivalOf: [], strong: ["retaincards", "retain.cards"], weak: ["retaincard"], context: STUDY_CONTEXT, searches: ["retain cards", "retain cards révision", "#retaincards"] },
  { slug: "biblechat", name: "Bible Chat", rivalOf: [], strong: ["biblechat"], searches: ["bible chat app", "#biblechat"] },
  { slug: "calai", name: "Cal AI", rivalOf: [], strong: ["@calai", "#calai", "calaiapp"], weak: ["calai"], context: MEAL_CONTEXT, searches: ["cal ai app"] },
  { slug: "glamai", name: "Glam AI", rivalOf: [], strong: ["glamai"], searches: ["glam ai app"] },
  { slug: "finch", name: "Finch", rivalOf: [], strong: ["finchapp", "finchcare", "finchselfcare"], searches: ["finch app self care"] },
  { slug: "airbuds", name: "Airbuds", rivalOf: [], strong: ["airbuds"], searches: ["airbuds", "#airbuds"] },
  { slug: "serializd", name: "Serializd", rivalOf: [], strong: ["serializd"], searches: ["serializd", "#serializd"], formerSlugs: ["serializdtvtrackingapp"] },
  { slug: "flo", name: "Flo", rivalOf: [], strong: ["floapp", "embaixadoraflo", "flohealth", "flo.health"], searches: ["#floapp", "#embaixadoraflo"] },
  { slug: "sweatcoin", name: "Sweatcoin", rivalOf: [], strong: ["sweatcoin"], searches: ["sweatcoin"] },
  { slug: "kairo", name: "Kairo Alarme", rivalOf: [], strong: ["kairoalarme", "joinkairo", "kairoapp"], searches: ["kairo alarme"] },
  { slug: "safenow", name: "SafeNow", rivalOf: [], strong: ["safenow"], searches: ["safenow app"] },
  { slug: "loverzz", name: "Loverzz", rivalOf: [], strong: ["loverzz"], searches: ["loverzz"] },
  // Love8, app de couple à distance comme Loverzz (écrire sur l'écran de l'autre), repérée le 10/11/2026
  // dans les trouvailles : des comptes « prénom + love8 », jusqu'à 1,6 M vues, que le Radar ne proposait
  // pas (ils l'écrivent à l'écran, « App : Love8 », au lieu de la mentionner). « love8 » seul se lit dans
  // « I love 8… » : il faut l'arobase, le dièse, « app » à côté, ou le pseudo « prénom.love8 ».
  { slug: "love8", name: "Love8", rivalOf: [], strong: ["@love8", "#love8", "love8app", "app:love8", ".love8"], searches: ["love8 app", "love8 couple", "#love8"] },
  { slug: "palima", name: "Palima", rivalOf: [], strong: ["palima"], searches: ["palima app"] },
  { slug: "quittr", name: "Quittr", rivalOf: [], strong: ["quittr"], searches: ["quittr", "#quittr"] },
  { slug: "umax", name: "Umax", rivalOf: [], strong: ["umaxapp", "@umax"], weak: ["umax"], context: LOOKS_CONTEXT, searches: ["umax app", "#umax"] },
  { slug: "creed", name: "Creed", rivalOf: [], strong: ["creedapp", "creed.app"], weak: ["creed"], context: FAITH_CONTEXT, searches: ["creed app oração", "creed app prayer"] },
  // Thème « argent » (12/11/2026) : les deux apps « gagne de l'argent » que cite le fondateur. Shortfy (vidéos
  // IA « YouTube Kids », « 1 000 € par jour ») pousse des comptes dédiés : 5 vidéos, 4,3 M vues la semaine du
  // 12/11 sous #shortfy. TrendSaaS (idées de SaaS + prompt) : 3 vidéos en 3 mois sur TikTok, 9 177 vues au plus
  // — sous le seuil de la découverte ; sa croissance passe par la pub, que le Radar cherche ici sous son nom.
  { slug: "shortfy", name: "Shortfy", rivalOf: [], strong: ["shortfy"], searches: ["shortfy", "#shortfy", "shortfy.io"] },
  { slug: "trendsaas", name: "TrendSaaS", rivalOf: [], strong: ["trendsaas"], searches: ["trendsaas", "trendsaas.ai"] },
  // Les 5 premières apps trouvées par les classements de l'App Store et confirmées par le fondateur (13/11/2026) :
  // trois apps de révision francophones, une app de langues (66 000 vidéos sous #pingoai), un compteur de
  // calories, une app de rencontre. Aucune n'est concurrente d'un projet. « diane ai » seul n'est pas un motif
  // (« Diane aime… ») ; « bpm » non plus (les battements par minute : 105 000 vidéos sous #bpm, 104 sous #bpmapp).
  { slug: "koroai", name: "Koro AI", rivalOf: [], strong: ["koroai"], searches: ["koro ai", "#koroai"] },
  { slug: "dianeai", name: "Diane AI", rivalOf: [], strong: ["#dianeai", "@dianeai", "dianeaiapp", "diane.app"], searches: ["diane ai app", "#dianeaiapp", "#dianeai"] },
  { slug: "pingoai", name: "Pingo AI", rivalOf: [], strong: ["pingoai", "usepingo"], searches: ["pingo ai", "#pingoai"] },
  { slug: "bitepal", name: "Bitepal", rivalOf: [], strong: ["bitepal"], searches: ["bitepal", "#bitepal", "#bitepalapp"] },
  { slug: "bpmapp", name: "bpm", rivalOf: [], strong: ["bpmapp", "bpm.app"], searches: ["#bpmapp", "bpm app rencontre"] },
];

/**
 * Comptes suivis au plus (tous réseaux) : le budget des relevés est calé dessus
 * (9 000 relevés/jour suivent 15 000 comptes au rythme mesuré le 13/11/2026 :
 * 0,62 relevé par compte et par jour). 3 000 jusqu'au 13/11/2026 (2 385 pris) :
 * le Radar devient un produit vendu, il doit suivre des centaines d'apps.
 */
export const MAX_TRACKED = 15_000;
/**
 * Une app qui n'est concurrente d'aucun projet ne prend pas plus de 300 comptes
 * (100 jusqu'au 13/11/2026 : on veut tous les créateurs d'une app, Astra AI en a
 * 269), et toutes ensemble pas plus de 13 000 : 2 000 places restent aux
 * concurrentes. Les comptes de départ, ceux ajoutés à la main et les comptes
 * francophones (cf `capFree`) passent outre.
 */
export const MAX_PER_OTHER_APP = 300;
export const MAX_OTHER_TOTAL = 13_000;

/** Ce que l'onglet Comptes suivis montre du réseau d'une app, calculé sur ses comptes et rangé sur l'app. */
export type AppNet = {
  accounts: number;
  active: number;
  posts7d: number;
  best?: { handle: string; url: string; views: number; multiplier: number; publishedAt: number };
  /** Les pays d'où ses comptes publient, les plus représentés d'abord (5 au plus). */
  countries?: { code: string; accounts: number }[];
};

const COUNTRY_CODE = /^[A-Z]{2}$/;
/** Pays gardés dans le résumé d'un réseau. */
export const NET_COUNTRIES_MAX = 5;

/**
 * Le pays d'où un compte publie : celui que TikTok donne le plus souvent à ses vidéos (le « pays de création »
 * de chaque vidéo, lu au relevé). Jusqu'au 13/11/2026 le Radar ne rangeait un compte que par LANGUE : un compte
 * qui publie en anglais depuis la France passait pour américain, et l'espagnol ne distinguait que l'Espagne du
 * reste. À égalité, le pays déjà connu reste ; sans aucune vidéo située, aussi.
 */
export function accountCountry(regions: readonly (string | undefined | null)[], previous?: string): string | undefined {
  const counts = new Map<string, number>();
  for (const r of regions) {
    const code = (r ?? "").trim().toUpperCase();
    if (COUNTRY_CODE.test(code)) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  if (counts.size === 0) return previous;
  const top = Math.max(...counts.values());
  const best = [...counts].filter(([, n]) => n === top).map(([code]) => code);
  return previous && best.includes(previous) ? previous : best[0];
}

/**
 * Le résumé d'un réseau : comptes, comptes actifs, publications de la semaine, meilleure vidéo (le plus fort
 * multiplicateur). Jusqu'au 13/11/2026 l'écran relisait TOUS les comptes suivis à chaque affichage (1,5 Mo pour
 * 2 385 comptes, et à chaque relevé d'un compte) : avec 15 000 comptes la lecture ne passe plus. Le résumé est
 * rangé sur l'app (`radarApps.net`) et refait quand ses comptes changent, puis chaque heure.
 */
export function appNet(
  accounts: readonly { handle: string; status: "active" | "paused"; posts7d?: number; country?: string; best7d?: { url: string; views: number; multiplier: number; publishedAt: number } }[],
): AppNet {
  let best: AppNet["best"];
  const byCountry = new Map<string, number>();
  for (const t of accounts) {
    const b = t.best7d;
    if (b && (!best || b.multiplier > best.multiplier)) best = { handle: t.handle, url: b.url, views: b.views, multiplier: b.multiplier, publishedAt: b.publishedAt };
    // Les comptes encore relevés disent où l'app est poussée aujourd'hui.
    if (t.status === "active" && t.country) byCountry.set(t.country, (byCountry.get(t.country) ?? 0) + 1);
  }
  const countries = [...byCountry]
    .map(([code, n]) => ({ code, accounts: n }))
    .sort((a, b) => b.accounts - a.accounts || a.code.localeCompare(b.code))
    .slice(0, NET_COUNTRIES_MAX);
  return {
    accounts: accounts.length,
    active: accounts.filter((t) => t.status === "active").length,
    posts7d: accounts.reduce((sum, t) => sum + (t.posts7d ?? 0), 0),
    ...(best ? { best } : {}),
    ...(countries.length ? { countries } : {}),
  };
}

/** Deux résumés disent-ils la même chose ? (on n'écrit que ce qui change.) */
export function sameAppNet(a: AppNet | undefined, b: AppNet): boolean {
  if (!a) return false;
  const x = a.best;
  const y = b.best;
  const sameBest = x === undefined || y === undefined ? x === y : x.handle === y.handle && x.url === y.url && x.views === y.views && x.multiplier === y.multiplier && x.publishedAt === y.publishedAt;
  const sameCountries = JSON.stringify(a.countries ?? []) === JSON.stringify(b.countries ?? []);
  return a.accounts === b.accounts && a.active === b.active && a.posts7d === b.posts7d && sameBest && sameCountries;
}

/**
 * Fait le même travail sur chaque élément, `size` à la fois, dans l'ordre. `work` rend « stop » pour tout
 * arrêter (plus de crédits) ; `alive` est relu avant chaque élément (le temps qu'il reste à la tâche). Rend le
 * nombre d'éléments commencés. Les relevés de comptes partaient un par un : 258 par heure ne tiennent pas dans
 * les 10 minutes d'une tâche.
 */
export async function pooled<T>(items: readonly T[], size: number, work: (item: T) => Promise<"stop" | void>, alive: () => boolean = () => true): Promise<number> {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < items.length && alive()) {
      const item = items[next++];
      if ((await work(item)) === "stop") stopped = true;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, items.length)) }, worker));
  return next;
}

/**
 * Les langues dont les comptes entrent même quand leur app non concurrente a fait
 * le plein : le français, marché des projets. Le 11/11/2026, les deux apps où il
 * y a le plus de créatrices françaises (Retain Cards, Astra AI) étaient au
 * plafond : la recherche du réseau ne pouvait plus leur en ajouter une seule.
 */
export const CAP_FREE_LANGS: readonly string[] = ["fr"];
export const capFree = (lang: string | undefined): boolean => lang !== undefined && CAP_FREE_LANGS.includes(lang);

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

/**
 * Le compte trouvé peut-il entrer dans le réseau de l'app ? `matchedBy` : comment
 * il a été trouvé ; `lang` : la langue de la vidéo qui l'a fait trouver. Le
 * plafond de tous les comptes suivis (MAX_TRACKED) vaut pour tous.
 */
export function canAttach(
  counts: { total: number; ofApp: number; others: number },
  rival: boolean,
  matchedBy: "caption" | "manual" | "seed",
  lang?: string,
): boolean {
  return canTrack(counts, rival, matchedBy !== "caption" || capFree(lang));
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

/**
 * Ce que la synchronisation fait d'une app de départ (radarSignals.ensureSeedApps) :
 *  - absente : créée ;
 *  - déjà « de départ » : réalignée sur le code quand un champ a changé ;
 *  - ajoutée À LA MAIN avant d'entrer dans cette liste (WRizz et Wing AI, le
 *    10/11/2026) : ADOPTÉE — elle devient une app de départ et suit le code (nom,
 *    concurrences, motifs, recherches) ; ses comptes et ses vidéos restent. Une
 *    app créée depuis l'écran ne peut pas prendre le slug d'une app déjà là : une
 *    app « à la main » qui porte le slug d'une app de départ la précède forcément.
 */
export type SeedSync = "create" | "adopt" | "align" | "keep";
export function seedSync(existing: { source: "seed" | "manual" } | null, sameFields: boolean): SeedSync {
  if (!existing) return "create";
  if (existing.source !== "seed") return "adopt";
  return sameFields ? "keep" : "align";
}

/** Une décision prise à la main, depuis l'écran d'un projet : cette app est (ou n'est pas) sa concurrente. */
/**
 * Un compte retiré de la liste de départ (radarSeedAccounts.SEED_REMOVED) est mis en pause — seulement s'il était
 * entré par elle et qu'il est encore relevé. Ajouté à la main ou trouvé par une légende, il est resté pour une
 * autre raison : on n'y touche pas. Déjà en pause, on ne réécrit rien (la synchro passe toutes les heures).
 */
export function seedRemoval(t: { matchedBy: "caption" | "manual" | "seed"; status: "active" | "paused" } | null): boolean {
  return t !== null && t.matchedBy === "seed" && t.status === "active";
}

/**
 * Un compte de la liste des mises en pause à la main (radarSeedAccounts.OFF_TOPIC_BY_HAND) est mis en pause s'il
 * est encore relevé — sauf si quelqu'un l'a réactivé depuis l'écran après une pause « hors sujet » (`keptByHand`) :
 * la synchro passe toutes les heures, elle ne doit pas défaire ce choix.
 */
export function handPause(t: { status: "active" | "paused"; keptByHand?: boolean } | null): boolean {
  return t !== null && t.status === "active" && t.keptByHand !== true;
}

/**
 * La langue déclarée à la main d'un compte (radarSeedAccounts.LANG_BY_HAND : langue → pseudos), s'il en a une.
 */
export function declaredLang(handle: string, byHand: Readonly<Record<string, readonly string[]>>): string | undefined {
  return Object.keys(byHand).find((lang) => byHand[lang].includes(handle));
}

/**
 * La langue d'un compte suivi, à son relevé. TikTok donne une langue à chaque légende ; celle du compte est la
 * plus fréquente (« autre » ne compte pas : aucune langue reconnue), et il n'en a pas si aucune légende n'en a.
 * Elle trompe dans deux cas, vus le 12/11/2026 : des légendes faites de hashtags n'ont aucune langue, et trois
 * mots d'anglais classent en anglais un compte dont tout le texte à l'écran est en français. La langue déclarée
 * à la main l'emporte donc toujours, relevé après relevé. Et quand ni l'une ni l'autre ne donne de langue, le
 * relevé lit celle du texte à l'écran de ses vidéos (convex/radarTextLang.screenLang).
 */
export function accountLang(handle: string, videoLangs: readonly string[], byHand: Readonly<Record<string, readonly string[]>>): string | undefined {
  const declared = declaredLang(handle, byHand);
  if (declared !== undefined) return declared;
  const langs = videoLangs.filter((l) => l !== "autre");
  const count = (lang: string) => langs.filter((x) => x === lang).length;
  return [...langs].sort((a, b) => count(b) - count(a))[0];
}

/**
 * La synchro pose la langue déclarée d'un compte suivi qui ne l'a pas : jamais relevé, sans langue, ou classé
 * ailleurs par TikTok. Elle passe toutes les heures : une fois posée, elle ne réécrit rien.
 */
export function needsDeclaredLang(t: { lang?: string } | null, lang: string): boolean {
  return t !== null && t.lang !== lang;
}

/**
 * Le rejugement automatique des comptes en pause « hors sujet » ne touche pas ceux mis en pause à la main : une
 * seule légende qui cite l'app (la vidéo sponsorisée qui les avait fait entrer) suffirait à les relancer.
 */
export function canRejudge(t: { pausedReason?: "offTopic" | "vetting"; handle: string }, byHand: readonly string[]): boolean {
  return t.pausedReason === "offTopic" && !byHand.includes(t.handle);
}

export type RivalChoice = { project: string; rival: boolean };

/**
 * Les projets dont une app est concurrente : ce que dit la liste de départ (ou
 * sa création), corrigé par ce que chaque équipe a décidé à la main — sa
 * décision l'emporte, pour son projet seulement. Le 10/11/2026, reclasser
 * WRizz, fondre un doublon ou suivre Love8 a demandé trois modifications du
 * code : l'équipe ne pouvait rien changer après la création d'une app, et la
 * synchronisation horaire aurait de toute façon rétabli la liste.
 */
export function effectiveRivalOf(base: readonly string[], byHand: readonly RivalChoice[]): string[] {
  const out = [...base];
  for (const c of byHand) {
    const i = out.indexOf(c.project);
    if (c.rival && i < 0) out.push(c.project);
    if (!c.rival && i >= 0) out.splice(i, 1);
  }
  return out;
}

/** La décision d'un projet remplace sa précédente ; celles des autres projets restent. */
export function withRivalChoice(byHand: readonly RivalChoice[], choice: RivalChoice): RivalChoice[] {
  return [...byHand.filter((c) => c.project !== choice.project), choice];
}

/** Minuscules ; `compact` sans espaces, tirets ni soulignés (« Recent Follow » → « recentfollow »). */
export function normalize(text: string) {
  const lower = text.toLowerCase();
  return { lower, compact: lower.replace(/[\s_\-]+/g, "") };
}

/** Le texte, déjà normalisé (`normalize`), cite-t-il l'app ? Pour juger un texte contre beaucoup d'apps. */
export function citesNormalized(n: { lower: string; compact: string }, rule: AppRule): boolean {
  const { lower, compact } = rule.not?.length ? normalize(rule.not.reduce((t, p) => t.split(p).join(" "), n.lower)) : n;
  if (rule.strong.some((p) => compact.includes(p))) return true;
  if (!rule.weak?.length) return false;
  const weakHit = rule.weak.some((p) => compact.includes(p));
  return weakHit && (rule.context ?? []).some((c) => lower.includes(c));
}

/** La légende ou le pseudo cite-t-il l'app ? */
export function citesApp(caption: string, handle: string, rule: AppRule): boolean {
  return citesNormalized(normalize(`${caption} ${handle}`), rule);
}

/**
 * Une vidéo est-elle DE l'app dont son compte fait partie du réseau ? Elle doit
 * la citer elle-même : légende, texte à l'écran, ce qui est dit, ou le pseudo du
 * compte. Un compte entré dans un réseau sur une seule légende publie aussi tout
 * autre chose — le 09/11/2026, un extrait de podcast Disney sous The Ick, un
 * tutoriel allemand sous The Cringe : sur 7 jours, 134 des 245 vidéos promues de
 * comptes rattachés par légende ne citaient pas leur app. Vérifié à chaque vidéo.
 */
export function videoCitesApp(v: { caption: string; hook?: string | null; transcript?: string | null; handle: string }, rule: AppRule): boolean {
  return citesApp([v.caption, v.hook ?? "", v.transcript ?? ""].join(" "), v.handle, rule);
}

/** Vidéos TikTok lues (avec leur texte) avant de juger qu'un compte ne cite jamais son app. */
export const OFF_TOPIC_MIN_VIDEOS = 9;

/**
 * Un compte entré dans un réseau sur UNE légende, dont aucune des vidéos lues
 * depuis (9 au moins) ne cite l'app : il parle d'autre chose, on arrête de le
 * relever (décidé le 09/11/2026 ; ce jour-là 168 comptes sur 893, ~128 crédits
 * par jour, contre une citation dans 90 % des vidéos chez les autres, en médiane).
 * Les comptes choisis à la main ou de la liste de départ ne sont jamais jugés.
 */
export function isOffTopic(
  matchedBy: "caption" | "manual" | "seed",
  videos: readonly { caption?: string; hook?: string; platform?: string }[],
  handle: string,
  rule: AppRule,
  bio?: string | null,
): boolean {
  return accountVerdict(matchedBy, videos, handle, rule, [], bio).kind === "offTopic";
}

/**
 * La bio du compte nomme-t-elle l'app ? Un compte qui écrit « J'utilise : shortfy.io » ou « Ambassadeur
 * shortfy.io » dans sa bio fait partie du réseau, même quand ses vidéos ne l'écrivent plus. Le 12/11/2026,
 * @gasp_viral (Shortfy) avait été mis en pause « hors sujet » : ses 10 dernières vidéos ne nomment Shortfy qu'à
 * l'oral, ni légende ni texte à l'écran. Ce jour-là, 3 comptes en pause « hors sujet » sur 202 avaient une bio qui
 * nomme leur app (lui, « Planning all my trips with @Palima », « Download Sweatcoin ») ; 385 des 1 005 comptes
 * actifs entrés par une légende sont dans le même cas.
 */
export function bioNamesApp(bio: string | null | undefined, rule: AppRule): boolean {
  return !!bio && citesNormalized(normalize(bio), rule);
}

/** Vidéos qui citent une AUTRE app suivie avant d'y ranger le compte, et combien de fois plus que la sienne. */
export const REASSIGN_MIN_VIDEOS = 3;
export const REASSIGN_DOMINANCE = 3;

export type AccountVerdict<T> = { kind: "keep" } | { kind: "move"; to: T; cited: number } | { kind: "offTopic" };

/**
 * Ce qu'on fait d'un compte entré dans un réseau sur une légende, au vu de ses
 * vidéos lues : il va dans le réseau de l'app qu'il cite NETTEMENT le plus.
 *  - une autre app suivie citée par au moins 3 vidéos, et au moins 3 fois plus
 *    que la sienne → il change de réseau (`move`). Le 09/11/2026, 13 comptes de
 *    FollowOtter étaient rangés sous FollowSpy sur une seule légende, et 5
 *    d'entre eux (4,3 M vues en 7 jours) avaient été mis en pause comme « hors
 *    sujet » : ils citaient une app, pas la bonne. « Nettement » : un compte
 *    Flert Now qui met #rizzapp sous chaque vidéo cite Rizz App plus souvent
 *    que la sienne sans en faire partie (rejoué sur la prod : il reste). Entre
 *    deux apps qui passent ce seuil, celle que le TEXTE des vidéos cite
 *    l'emporte sur celle que seul le pseudo évoque : @rizz_master4 écrit
 *    « using wrizz app » sous chaque vidéo, c'est un compte WRizz, pas Rizz
 *    Master (10/11/2026) ;
 *  - sinon, aucune vidéo lue (9 au moins) ne cite la sienne → `offTopic` ;
 *  - sinon → `keep`.
 * Les comptes choisis à la main ou de la liste de départ ne sont jamais jugés, ni ceux dont la BIO nomme leur
 * app (`bioNamesApp`) : ils restent dans son réseau.
 * `others` : les autres apps suivies (pas la sienne).
 */
export function accountVerdict<T extends AppRule>(
  matchedBy: "caption" | "manual" | "seed",
  videos: readonly { caption?: string; hook?: string; platform?: string }[],
  handle: string,
  own: AppRule,
  others: readonly T[],
  bio?: string | null,
): AccountVerdict<T> {
  if (matchedBy !== "caption") return { kind: "keep" };
  if (bioNamesApp(bio, own)) return { kind: "keep" };
  const read = videos.filter((v) => !v.platform && (v.caption !== undefined || v.hook !== undefined));
  let ownCount = 0;
  // Par autre app : vidéos qui la citent (pseudo compris), dont celles dont le TEXTE la cite.
  const counts = new Map<T, { cited: number; inText: number }>();
  for (const v of read) {
    const text = normalize(`${v.caption ?? ""} ${v.hook ?? ""}`);
    const n = normalize(`${v.caption ?? ""} ${v.hook ?? ""} ${handle}`);
    if (citesNormalized(n, own)) ownCount++;
    for (const a of others) {
      if (!citesNormalized(n, a)) continue;
      const c = counts.get(a) ?? { cited: 0, inText: 0 };
      counts.set(a, { cited: c.cited + 1, inText: c.inText + Number(citesNormalized(text, a)) });
    }
  }
  const best = [...counts]
    .sort((x, y) => y[1].inText - x[1].inText || y[1].cited - x[1].cited)
    .find(([, c]) => c.cited >= REASSIGN_MIN_VIDEOS && c.cited >= REASSIGN_DOMINANCE * Math.max(1, ownCount));
  if (best) return { kind: "move", to: best[0], cited: best[1].cited };
  if (read.length >= OFF_TOPIC_MIN_VIDEOS && ownCount === 0) return { kind: "offTopic" };
  return { kind: "keep" };
}

/** Concurrente d'autres projets, et pas de celui-ci (The Ick vue de BLUSH). */
export function rivalElsewhere(rivalOf: readonly string[], projectSlug: string): boolean {
  return rivalOf.length > 0 && !rivalOf.includes(projectSlug);
}

/** La première app citée (les apps sont essayées dans l'ordre donné). */
export function findApp<T extends AppRule>(caption: string, handle: string, apps: readonly T[]): T | undefined {
  const n = normalize(`${caption} ${handle}`);
  return apps.find((a) => citesNormalized(n, a));
}

/** L'app qu'une vidéo cite parmi les apps suivies (légende, texte à l'écran, ce qui est dit, pseudo). */
export function videoApp<T extends AppRule>(v: { caption: string; hook?: string | null; transcript?: string | null; handle: string }, apps: readonly T[]): T | undefined {
  return findApp([v.caption, v.hook ?? "", v.transcript ?? ""].join(" "), v.handle, apps);
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
 * tous les 3 jours s'il est calme, chaque semaine s'il dort depuis plus de 14 jours,
 * chaque mois s'il n'a rien publié depuis plus de 30 jours (13/11/2026 : 794 des 2 356 comptes
 * actifs en étaient là, relevés chaque semaine pour rien — 113 relevés par jour).
 * Un compte relevé sans aucune vidéo repasse dans 3 jours (le premier relevé d'un
 * compte ajouté, lui, est immédiat : c'est son `nextReadAt` d'insertion).
 */
export const DORMANT_AFTER_MS = 30 * DAY;
export const DORMANT_EVERY_MS = 30 * DAY;

export function nextReadAt(lastPostAt: number | undefined, now: number): number {
  if (lastPostAt === undefined) return now + 3 * DAY;
  const idle = now - lastPostAt;
  if (idle <= 3 * DAY) return now + DAY;
  if (idle <= 14 * DAY) return now + 3 * DAY;
  if (idle <= DORMANT_AFTER_MS) return now + 7 * DAY;
  return now + DORMANT_EVERY_MS;
}

/**
 * Le prochain relevé d'un compte ACTIF (une publication ces 3 derniers jours) est
 * CALÉ sur sa dernière publication : à publication + 18 h, puis toutes les 24 h,
 * jamais à moins de 6 h du relevé qu'on vient de faire.
 *  - une vidéo vue à moins de 12 h a ainsi un SECOND REGARD à H+18, quand on sait
 *    si elle part (« en train de partir » : moins de 24 h, 10× sa normale) ;
 *  - un compte qui publie à heure fixe est relevé chaque jour ~18 h après, au
 *    lieu de l'être à l'heure où il publie (avant : relevé + 24 h, soit 25,5 h en
 *    vrai avec la tâche horaire — la vidéo du jour était vue trop tôt pour être jugée).
 * Remplace le relevé toutes les 6 h des concurrentes actives du 09/11/2026
 * (#481), qui doublait la dépense des relevés. Rejoué avec cette fonction sur 7
 * jours de publications réelles des 466 comptes actifs : 71 % des vidéos ont un
 * regard entre H+12 et H+24 (35 % en relevé quotidien simple, 52 % avec le 6 h),
 * soit toutes celles vues avant H+24, pour 0,93 relevé par compte et par jour
 * (0,75 en quotidien, 1,55 avec le 6 h). Les comptes calmes gardent leur rythme.
 */
export const SECOND_LOOK_MS = 18 * HOUR;
export const MIN_READ_GAP_MS = 6 * HOUR;
/** Une vidéo de moins de 12 h n'a pas encore eu son regard entre H+12 et H+24. */
export const FRESH_VIDEO_MS = 12 * HOUR;

/**
 * `freshOldestAt` : la publication de sa plus ANCIENNE vidéo de moins de 12 h
 * (un compte qui publie deux fois par jour : chacune a son second regard).
 */
export function nextReadAtFor(lastPostAt: number | undefined, now: number, freshOldestAt?: number): number {
  if (lastPostAt === undefined || now - lastPostAt > 3 * DAY) return nextReadAt(lastPostAt, now);
  const earliest = now + MIN_READ_GAP_MS;
  if (freshOldestAt !== undefined && now - freshOldestAt < FRESH_VIDEO_MS) return Math.max(earliest, freshOldestAt + SECOND_LOOK_MS);
  const first = lastPostAt + SECOND_LOOK_MS;
  return first >= earliest ? first : first + Math.ceil((earliest - first) / DAY) * DAY;
}

/** Trois relevés d'affilée en échec (compte supprimé, privé) : le compte passe en pause. */
export const MAX_READ_ERRORS = 3;

/** « #thecringe » → recherche de hashtag ; sinon mot-clé. */
export function searchKind(s: string): { kind: "hashtag" | "keyword"; value: string } {
  return s.startsWith("#") ? { kind: "hashtag", value: s.slice(1) } : { kind: "keyword", value: s };
}

/**
 * Les régions d'une recherche de réseau : sans région (comme depuis le début),
 * puis la France. La région est le pays du relais par lequel ScrapeCreators
 * interroge TikTok : elle ne filtre pas l'origine des vidéos, elle fait remonter
 * ce que TikTok montre dans ce pays. Sans elle, les créatrices françaises sont
 * peu trouvées : 127 comptes francophones sur 1 950 actifs le 11/11/2026, alors
 * qu'une recherche à la main en a trouvé 37 de plus en une soirée.
 */
export const NETWORK_REGIONS: readonly (string | null)[] = [null, "FR"];

export type NetworkPass = { kind: "hashtag" | "keyword"; value: string; region: string | null; sort?: "date" };

/**
 * Les passes de la recherche du réseau d'une app : chacune de ses recherches, dans chaque région. En recherche
 * COMPLÈTE (`deep`, la première d'une app), chaque mot-clé repasse trié par date : la pertinence remonte les
 * vidéos qui ont marché, la date celles des petits comptes qui viennent de s'y mettre.
 */
export function networkPasses(searches: readonly string[], deep = false): NetworkPass[] {
  const base: NetworkPass[] = searches.flatMap((raw) => NETWORK_REGIONS.map((region) => ({ ...searchKind(raw), region })));
  if (!deep) return base;
  return [...base, ...base.filter((p) => p.kind === "keyword").map((p) => ({ ...p, sort: "date" as const }))];
}

/** Ce qu'un signal garde de la recherche qui l'a trouvé : « réseau Stalkie », « réseau Stalkie·fr » pour la passe France. */
export const networkFoundBy = (app: string, region: string | null): string => (region ? `réseau ${app}·${region.toLowerCase()}` : `réseau ${app}`);

/** Pages lues par recherche de réseau (30 vidéos par page en mot-clé) : 3 pour une concurrente, 2 sinon. */
export const networkPages = (rival: boolean) => (rival ? 3 : 2);

/**
 * La recherche COMPLÈTE d'une app, à son entrée dans le Radar : on veut TOUS ses comptes, même ceux à 300 vues.
 * Chaque recherche est lue page après page tant qu'elle ramène des comptes qu'on ne suivait pas — jusqu'à
 * DEEP_PAGES pages (≈ 300 à 450 vidéos), et on s'arrête après DEEP_DRY_PAGES pages d'affilée sans nouveau
 * compte. Le 12/11/2026, à la main sur Shortfy : #shortfy (246 vidéos) et #shortfyio (84) déroulés en entier
 * donnaient 22 comptes, les deux pages d'une recherche de routine 15. Les recherches suivantes (tous les 3 ou
 * 7 jours) restent courtes.
 */
export const DEEP_PAGES = 15;
export const DEEP_DRY_PAGES = 2;

/** Une app n'a pas encore eu sa recherche complète. */
export const needsDeepSearch = (app: { deepSearchedAt?: number }): boolean => app.deepSearchedAt === undefined;

/** Lit-on encore une page de cette recherche ? `page` : pages déjà lues ; `dry` : dernières pages d'affilée sans nouveau compte. */
export function nextSearchPage(read: { page: number; dry: number }, deep: boolean, rival: boolean): boolean {
  if (deep) return read.page < DEEP_PAGES && read.dry < DEEP_DRY_PAGES;
  return read.page < networkPages(rival);
}
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

/**
 * Clé de GABARIT d'un hook : ses 4 premiers mots (un « POV » d'ouverture ôté),
 * chiffres masqués. C'est la famille d'un hook : « Quand ton mec te dit X » et
 * « Quand ton mec te demande Y » sont le même gabarit, comme « POV : tu découvres
 * qui il suit » et « POV : tu découvres qui il suivait en secret ». Un format qui
 * circule se lit par gabarit, pas au mot près.
 */
export function hookTemplate(hook: string | undefined): string | null {
  const k = hookKey(hook);
  if (!k) return null;
  const words = k.replace(/\d+/g, "#").split(" ");
  const w = words[0] === "pov" ? words.slice(1) : words;
  return w.length >= 3 ? w.slice(0, 4).join(" ") : null;
}

/**
 * Un format QUI PÈTE : au moins 10 000 vues et 3 fois la médiane du compte chez
 * l'un de ses membres. Un son n'en est un que s'il est ORIGINAL (une voix, un
 * montage repris) : une musique à la mode reprise par 17 comptes de 7 apps
 * (« Paper Moon Static », 07/11/2026) n'est pas un format.
 */
export const HOT_MIN_VIEWS = 10_000;
export const HOT_MIN_MULTIPLIER = 3;
const ORIGINAL_SOUND = /^(original sound|son original|som original|sonido original|originalton|suono originale|оригинальный звук)/i;

export function isHotFormat(f: { kind: "hook" | "sound"; label: string; maxViews: number; bestMultiplier: number | null }): boolean {
  if (f.maxViews < HOT_MIN_VIEWS || (f.bestMultiplier ?? 0) < HOT_MIN_MULTIPLIER) return false;
  return f.kind === "hook" || ORIGINAL_SOUND.test(f.label.trim());
}

/**
 * Un format RÉUSSI se lit sur ses reprises, pas sur son meilleur coup (09/11/2026 :
 * « new obsession », 1,8 M vues au mieux, n'avait réussi que 3 reprises sur 23 ;
 * 8 formats sur 384 réussissaient au moins une reprise sur deux). Une reprise
 * réussit quand elle fait 3× la normale de son compte ; un format est réussi
 * avec au moins 3 reprises mesurées et une sur deux réussie.
 */
export const FORMAT_WIN_MULTIPLIER = 3;
export const FORMAT_MIN_MEASURED = 3;

export function formatSuccess(members: readonly { multiplier?: number | null }[]): { measured: number; wins: number; median: number | null; winning: boolean } {
  const ms = members.map((m) => m.multiplier).filter((x): x is number => typeof x === "number");
  const wins = ms.filter((x) => x >= FORMAT_WIN_MULTIPLIER).length;
  const sorted = [...ms].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { measured: ms.length, wins, median, winning: ms.length >= FORMAT_MIN_MEASURED && wins * 2 >= ms.length };
}

/** Un format DÉMARRE : 3 comptes l'ont publié dans les dernières 48 h. */
export const FORMAT_ALERT_ACCOUNTS = 3;
export const FORMAT_ALERT_WINDOW_MS = 48 * HOUR;

export function formatStarting(members: readonly { accountId: string; publishedAt: number }[], now: number): boolean {
  const recent = new Set(members.filter((m) => now - m.publishedAt <= FORMAT_ALERT_WINDOW_MS).map((m) => m.accountId));
  return recent.size >= FORMAT_ALERT_ACCOUNTS;
}

/**
 * Le compte Instagram qu'une bio TikTok donne : « IG: @x », « Insta : x »,
 * « instagram.com/x », « 📸 @x ». `null` sinon. Un compte « principal » cité
 * (« main: @x ») n'est pas l'Instagram du compte.
 */
export function igHandleFromBio(bio: string | undefined): string | null {
  if (!bio) return null;
  const url = bio.match(/instagram\.com\/([a-z0-9._]{2,30})/i);
  const tag = bio.match(/(?:^|[^a-z0-9])(?:ig|insta|instagram|📸)\s*[:：\-–]?\s*@?([a-z0-9._]{2,30})/i);
  const h = (url?.[1] ?? tag?.[1])?.toLowerCase().replace(/\.+$/, "");
  return h && /[a-z]/.test(h) && !["com", "gram", "me"].includes(h) ? h : null;
}

/** Domaines qui ne sont pas des apps (liens de bio, messageries). */
// Pages de liens, raccourcisseurs, cagnottes, messageries : jamais une app. (« onelink.me », « discord.gg » et
// « gofund.me » étaient en tête des sites repérés le 13/11/2026.)
const NOT_APP_DOMAINS = new Set([
  "beacons.ai", "snipfeed.co", "carrd.co", "komi.io", "linkin.bio", "hoo.be", "bento.me", "msha.ke", "lnk.bio", "solo.to", "fanfix.io", "throne.me",
  "onelink.me", "discord.gg", "gofund.me", "paypal.me", "cash.app", "linktr.ee", "stan.store", "whop.com", "t.co", "amzn.to", "youtu.be", "itch.io",
]);

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

/**
 * Le nom d'une app repérée par une mention : le pseudo affiché, sans l'arobase
 * ni le slogan qui le suit (« @Serializd | TV tracking app » → « Serializd »,
 * « @Leaked DMs || Detective game » → « Leaked DMs »). Pris entier, il donnait
 * le 09/11/2026 le motif « serializd|tvtrackingapp », que personne n'écrit.
 */
export function candidateName(label: string): string {
  const whole = label.replace(/^@/, "").trim();
  const name = whole.split(/\s*(?:\|+|·|•|—|–|:)\s*|\s+-\s+/)[0].trim();
  return name.length >= 3 ? name : whole;
}

/** Le nom proposé pour suivre une app repérée : le pseudo sans slogan, ou le domaine sans extension (« stalkie.io » → « Stalkie »). */
export function suggestedAppName(c: Pick<Candidate, "kind" | "label">): string {
  if (c.kind === "mention") return candidateName(c.label);
  const base = c.label.replace(/\.[a-z]+$/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Motifs d'une app créée depuis une app repérée : le domaine, et son nom sans extension. */
export function patternsOfCandidate(c: Pick<Candidate, "kind" | "label">): string[] {
  if (c.kind === "domain") {
    const base = normalize(c.label).compact;
    return [base, base.replace(/\.[a-z]+$/, "")].filter((p, i, a) => p.length >= 3 && a.indexOf(p) === i);
  }
  const base = normalize(candidateName(c.label)).compact;
  return base.length >= 3 ? [base] : [];
}

/**
 * L'app déjà suivie dont un motif CONTIENT celui-ci : toute vidéo qui la cite
 * citerait aussi la nouvelle. « vocaa » est dans « vocaai » (Voca AI),
 * « whatbrandonthink » dans « whatbrandonthinks » — les deux doublons du
 * 09/11/2026. L'inverse est permis : « wrizzapp » contient « rizzapp » et
 * c'est une autre app.
 */
export function shadowingApp<T extends Pick<AppRule, "strong">>(pattern: string, apps: readonly T[]): T | undefined {
  const p = pattern.replace(/^[@#]/, "");
  return apps.find((a) => a.strong.some((s) => s.replace(/^[@#]/, "").includes(p)));
}
