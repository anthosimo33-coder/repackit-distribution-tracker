/**
 * NOUVEAU RADAR — la rotation des recherches de découverte. Module SERVEUR seul :
 * ce sont des tournures dans la langue de chaque marché, pas du texte d'écran,
 * et aucun composant ne l'importe (la garde i18n les prendrait pour de l'interface).
 */
import type { DiscoveryQuery } from "./radarSignalsMath";

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

/** Tournures hors niche passées entre deux tours des tournures de niche. */
export const ROTATION_OTHERS_PER_ROUND = 13;

/**
 * L'ordre de passage : les 7 tournures de niche, puis 13 des 53 autres, et ainsi
 * de suite. Au réglage par défaut (20 recherches/jour), les tournures de niche
 * passent chaque jour et les autres tous les 4 jours — au lieu de 60 par jour,
 * chacune chaque jour.
 */
export function discoveryRotation(all: readonly DiscoveryQuery[] = DISCOVERY_QUERIES, perRound = ROTATION_OTHERS_PER_ROUND): DiscoveryQuery[] {
  const niche = all.filter(isNiche);
  const others = all.filter((d) => !isNiche(d));
  if (niche.length === 0) return [...others];
  const out: DiscoveryQuery[] = [];
  for (let i = 0; i < others.length || i === 0; i += perRound) out.push(...niche, ...others.slice(i, i + perRound));
  return out;
}

export const DISCOVERY_ROTATION: readonly DiscoveryQuery[] = discoveryRotation();
