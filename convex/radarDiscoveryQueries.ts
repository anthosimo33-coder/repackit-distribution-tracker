/**
 * NOUVEAU RADAR — la rotation des recherches de découverte. Module SERVEUR seul :
 * ce sont des tournures dans la langue de chaque marché, pas du texte d'écran,
 * et aucun composant ne l'importe (la garde i18n les prendrait pour de l'interface).
 */
import type { DiscoveryQuery } from "./radarSignalsMath";

const q = (lang: string, region: string, list: string[]): DiscoveryQuery[] =>
  list.map((query) => ({ query, region, lang }));

/**
 * Des tournures qui accompagnent une vidéo d'app, 12 par marché. Chacune passe
 * une fois par jour avec le réglage par défaut (60 recherches/jour) ; au-delà, la
 * rotation reprend du début. La région aide TikTok sans filtrer l'origine des
 * vidéos (doc ScrapeCreators) : c'est la langue de la tournure qui trie.
 */
export const DISCOVERY_QUERIES: readonly DiscoveryQuery[] = [
  ...q("fr", "FR", ["cette app", "l'application", "cette appli", "application qui", "télécharge l'app", "app gratuite", "j'ai trouvé une app", "meilleure app", "app pour couple", "app iphone", "app qui te dit", "applications à avoir"]),
  ...q("pt", "BR", ["esse app", "esse aplicativo", "aplicativo que", "baixa o app", "app grátis", "melhor app", "achei um app", "app para casal", "app iphone", "app que mostra", "aplicativo novo", "apps que toda menina"]),
  ...q("es", "MX", ["esta app", "esta aplicación", "app que", "descarga la app", "app gratis", "mejor app", "encontré una app", "app para parejas", "app iphone", "app que te dice", "aplicación nueva", "apps que toda chica"]),
  ...q("es", "ES", ["esta app", "esta aplicación", "app que", "descárgate la app", "app gratis", "la mejor app", "he encontrado una app", "app para parejas", "app iphone", "app que te dice", "aplicación nueva", "apps que tienes que tener"]),
  ...q("en", "US", ["this app", "app that", "download this app", "free app", "best app", "found an app", "app for couples", "iphone app", "app that tells you", "new app", "apps every girl", "apps you need"]),
];
