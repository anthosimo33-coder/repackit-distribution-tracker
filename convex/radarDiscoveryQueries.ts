/**
 * NOUVEAU RADAR — la rotation des recherches de découverte. Module SERVEUR seul :
 * ce sont des tournures dans la langue de chaque marché, pas du texte d'écran,
 * et aucun composant ne l'importe (la garde i18n les prendrait pour de l'interface).
 */
import type { ThemeKey } from "./radarSignalFilters";
import { foundByLabel, type DiscoveryQuery } from "./radarSignalsMath";

const q = (lang: string, region: string, list: string[]): DiscoveryQuery[] =>
  list.map((query) => ({ query, region, lang }));

/**
 * Des tournures qui accompagnent une vidéo d'app, 12 par marché. La région aide
 * TikTok sans filtrer l'origine des vidéos (doc ScrapeCreators) : c'est la langue
 * de la tournure qui trie.
 */
export const DISCOVERY_QUERIES: readonly DiscoveryQuery[] = [
  ...q("fr", "FR", ["cette app", "l'application", "cette appli", "application qui", "télécharge l'app", "app gratuite", "j'ai trouvé une app", "meilleure app", "app pour couple", "app iphone", "app qui te dit", "applications à avoir"]),
  ...q("pt", "BR", ["esse app", "esse aplicativo", "aplicativo que", "baixa o app", "app grátis", "melhor app", "achei um app", "app para casal", "app iphone", "app que mostra", "aplicativo novo", "apps que toda menina"]),
  ...q("es", "MX", ["esta app", "esta aplicación", "app que", "descarga la app", "app gratis", "mejor app", "encontré una app", "app para parejas", "app iphone", "app que te dice", "aplicación nueva", "apps que toda chica"]),
  ...q("es", "ES", ["esta app", "esta aplicación", "app que", "descárgate la app", "app gratis", "la mejor app", "he encontrado una app", "app para parejas", "app iphone", "app que te dice", "aplicación nueva", "apps que tienes que tener"]),
  ...q("en", "US", ["this app", "app that", "download this app", "free app", "best app", "found an app", "app for couples", "iphone app", "app that tells you", "new app", "apps every girl", "apps you need"]),
];

/**
 * Les tournures DE NICHE : du 06 au 09/11/2026, les 8 vidéos trouvées par la
 * découverte et rattachées à une app venaient toutes d'elles (« app pour
 * couple » dans chaque marché, « achei um app », « app that tells you ») — les
 * 53 autres : 167 crédits sur 225 sans une seule vidéo de la niche.
 */
const NICHE: readonly string[] = ["app pour couple", "app para casal", "app para parejas", "app for couples", "achei um app", "app that tells you"];
const isNiche = (d: DiscoveryQuery) => NICHE.includes(d.query);

/**
 * Les tournures « app pour couple », dans chaque marché : les seules dont les
 * trouvailles entrent dans la file Aujourd'hui (radarDisplay.todayGroups). Lu le
 * 10/11/2026 sur les 130 vidéos de la découverte de la semaine : celles-ci
 * montrent toutes une app de couple ou de rencontre (Love8, amora, Hinge…) ;
 * les autres tournures ramènent du foot, des fonds d'écran et des tutoriels de
 * code — « achei um app » et « app that tells you » compris (0 sur 7).
 */
const RELATION: readonly string[] = ["app pour couple", "app para casal", "app para parejas", "app for couples"];

/** La vidéo a-t-elle été trouvée par une recherche « app pour couple » ? (`foundBy` : « app for couples·us »). */
export function isRelationFind(foundBy: readonly string[]): boolean {
  return foundBy.some((f) => RELATION.includes(f.split("·")[0]));
}

// ─── Thème « argent » ────────────────────────────────────────────────────────

/**
 * Le thème « argent » (12/11/2026) : side hustle, revenus en ligne, business à
 * côté de son travail. Le fondateur veut voir ce sujet dans TOUT TikTok, pas
 * seulement autour des apps suivies : la découverte ne cherchait que des
 * tournures d'app (« cette app », « app pour couple »), et sur 90 jours le
 * Radar n'avait relevé que 8 vidéos parlant d'argent. Chaque tournure passe
 * chaque jour (30 vidéos de la semaine les plus aimées par recherche) : les
 * méthodes (achat-revente, dropshipping, UGC, affiliation TikTok Shop,
 * clipping) et les mots du sujet lui-même.
 *
 * Choisies sur une passe réelle du 12/11/2026 (80 tournures, 322 vidéos gardées,
 * ~87 % dans le sujet). Retirées parce qu'elles ne gardaient rien ou surtout du
 * bruit : « revenus complémentaires », « argent à côté » (salle de sport),
 * « revenda » (voitures, doramas), « trabalhar em casa », « como eu faturei »,
 * « afiliado tiktok shop » au Brésil, « how to make money », « work from home »
 * (vie de bureau), « emprender » et « cómo ganar dinero » au Mexique. La région
 * MX renvoie parfois 0 vidéo (« ganar dinero » : 25 puis 0) : c'est la région,
 * pas la tournure — elles restent.
 */
export const MONEY_QUERIES: readonly DiscoveryQuery[] = [
  ...q("fr", "FR", ["side hustle", "gagner de l'argent en ligne", "argent en ligne", "revenu passif", "business en ligne", "idée de business", "business à lancer", "petit business", "achat revente", "revente vinted", "dropshipping", "créatrice ugc", "affiliation tiktok shop", "travailler de chez soi", "comment j'ai gagné"]),
  ...q("pt", "BR", ["renda extra", "renda extra em casa", "ganhar dinheiro", "ganhar dinheiro na internet", "dinheiro online", "renda passiva", "negócio online", "ideia de negócio", "como ganhar dinheiro", "quanto eu ganhei", "ganhar em dólar", "criadora ugc", "dropshipping", "app que paga"]),
  ...q("es", "MX", ["ingresos extra", "ganar dinero", "ganar dinero desde casa", "ganar dinero en internet", "dinero extra", "ingresos pasivos", "negocio en línea", "idea de negocio", "app para ganar dinero", "creadora ugc", "afiliado tiktok shop", "dropshipping", "app que paga", "trabajo desde casa", "side hustle"]),
  ...q("es", "ES", ["ganar dinero", "ingresos extra", "dinero extra", "ingresos pasivos", "negocio online", "idea de negocio", "cómo ganar dinero", "ganar dinero por internet", "trabajar desde casa", "emprender", "creadora ugc", "tiktok shop afiliado", "dropshipping", "compraventa", "app que paga", "segundo sueldo"]),
  ...q("en", "US", ["side hustle", "side hustle ideas", "make money online", "make money with ai", "how i make money", "passive income", "extra income", "business idea", "faceless account", "ugc creator", "tiktok shop affiliate", "clipping", "dropshipping", "apps that pay you", "digital products", "online business"]),
];

const MONEY_LABELS: ReadonlySet<string> = new Set(MONEY_QUERIES.map(foundByLabel));

/**
 * Les hashtags qui rangent une vidéo dans le thème « argent » même quand une
 * autre recherche l'a trouvée (un compte suivi, une tournure d'app) : ceux que
 * ces vidéos portent (#sidehustle, #makemoneyonline, #rendaextra, #ugccreator
 * chez Fluencify…). Sans accent, en minuscules. Écartés : #workfromhome (vie de
 * bureau à la maison), #ugc seul (les vidéos d'app des créatrices le portent).
 */
export const MONEY_HASHTAGS: ReadonlySet<string> = new Set([
  "sidehustle", "sidehustles", "sidehustleideas", "makemoneyonline", "makemoney", "makemoneyfromhome", "passiveincome", "extraincome", "moneytok", "onlinebusiness", "onlinemoney", "ugccreator", "ugcjourney", "tiktokshopaffiliate", "dropshipping",
  "argentenligne", "gagnerdelargent", "revenupassif", "revenuspassifs", "revenucomplementaire", "businessenligne", "achatrevente", "argentfacile",
  "rendaextra", "ganhardinheiro", "dinheiroonline", "rendapassiva", "ganharemdolar",
  "ingresosextra", "ganardinero", "dineroextra", "ingresospasivos", "ganadinero",
]);

const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Les hashtags d'une légende, sans accent, en minuscules. */
export function hashtagsOf(caption: string): string[] {
  return Array.from(caption.matchAll(/#([\p{L}\p{N}_]+)/gu), (m) => plain(m[1]));
}

/**
 * Les thèmes d'une vidéo : « argent » si une recherche du thème l'a trouvée
 * (`foundBy` : « side hustle·us ») ou si sa légende porte un hashtag du thème.
 */
export function signalThemes(foundBy: readonly string[], caption: string): ThemeKey[] {
  const money = foundBy.some((f) => MONEY_LABELS.has(f)) || hashtagsOf(caption).some((t) => MONEY_HASHTAGS.has(t));
  return money ? ["argent"] : [];
}

// ─── Ordre de passage ────────────────────────────────────────────────────────

/** Tournures hors niche passées entre deux tours des tournures de niche. */
export const ROTATION_OTHERS_PER_ROUND = 13;

/**
 * L'ordre de passage : à chaque tour, les 7 tournures de niche et les tournures
 * quotidiennes (`daily` : les 76 du thème « argent »), puis 13 des 53 autres, et
 * ainsi de suite. Un tour fait 96 recherches : au réglage par défaut (100/jour),
 * la niche et l'argent passent chaque jour, les autres tous les 4 jours.
 */
export function discoveryRotation(
  all: readonly DiscoveryQuery[] = DISCOVERY_QUERIES,
  perRound = ROTATION_OTHERS_PER_ROUND,
  daily: readonly DiscoveryQuery[] = [],
): DiscoveryQuery[] {
  const everyRound = [...all.filter(isNiche), ...daily];
  const others = all.filter((d) => !isNiche(d));
  if (everyRound.length === 0) return [...others];
  const out: DiscoveryQuery[] = [];
  for (let i = 0; i < others.length || i === 0; i += perRound) out.push(...everyRound, ...others.slice(i, i + perRound));
  return out;
}

export const DISCOVERY_ROTATION: readonly DiscoveryQuery[] = discoveryRotation(DISCOVERY_QUERIES, ROTATION_OTHERS_PER_ROUND, MONEY_QUERIES);
