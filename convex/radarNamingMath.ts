/**
 * RADAR — LES PETITS RÉSEAUX : des logiciels poussés par de petits comptes neufs, sous le seuil de la découverte.
 * Règles pures, serveur seul (ses tournures de recherche ne sont pas de l'interface).
 *
 * Pourquoi : la découverte ne garde qu'une vidéo à plus de 10 000 vues et 10 fois les abonnés de son compte.
 * TrendSaaS, le 12/11/2026 : 16 comptes ouverts depuis octobre, 0 à 428 abonnés, 9 178 vues au mieux — invisible.
 * Shortfy : 13 de ses 22 comptes ont moins de 1 000 abonnés. Ces réseaux ont pourtant un point commun : chaque
 * vidéo doit NOMMER le produit, et presque toujours par les mêmes tournures (« le site c'est shortfy.io », « le
 * nom du site c'est TrendSaaS.ai », « l'ia c'est… »).
 *
 * Comment : chaque jour, ces tournures sont cherchées dans tout TikTok, les plus RÉCENTES d'abord, sans seuil de
 * vues. Chaque site cité par un petit compte (légende ou texte à l'écran) est compté par compte distinct
 * (radarAppCandidates, genre « domain ») : à deux comptes il apparaît dans les apps repérées. Une vidéo qui cite
 * une app déjà suivie rattache son compte à ce réseau.
 *
 * NON MESURÉ avant d'être branché (pas de clé du fournisseur en local) : la part du bruit, et si TrendSaaS serait
 * ressorti seul. Le témoin se lit dans `radarNamingStats` : chaque jour, combien de vidéos de ces recherches
 * citaient une app déjà suivie, et de combien de comptes.
 */

export type NamingQuery = { query: string; region: string; lang: string };

/** Les tournures qui nomment un produit, par marché. La région est le pays du relais du fournisseur. */
export const NAMING_QUERIES: readonly NamingQuery[] = [
  { query: "le site c'est", region: "FR", lang: "fr" },
  { query: "le nom du site c'est", region: "FR", lang: "fr" },
  { query: "l'ia c'est", region: "FR", lang: "fr" },
  { query: "le site s'appelle", region: "FR", lang: "fr" },
  { query: "l'ia que j'utilise", region: "FR", lang: "fr" },
  { query: "le site que j'utilise", region: "FR", lang: "fr" },
  { query: "the website is called", region: "US", lang: "en" },
  { query: "the site is called", region: "US", lang: "en" },
  { query: "the ai i use is", region: "US", lang: "en" },
  { query: "the tool i use is", region: "US", lang: "en" },
  { query: "la página se llama", region: "MX", lang: "es" },
  { query: "la ia se llama", region: "MX", lang: "es" },
  { query: "la web se llama", region: "ES", lang: "es" },
  { query: "o site se chama", region: "BR", lang: "pt" },
  { query: "o nome do site é", region: "BR", lang: "pt" },
  { query: "a ia que eu uso", region: "BR", lang: "pt" },
];

/** Un « petit compte » : moins de 10 000 abonnés. Au-dessus, c'est un influenceur de passage, pas un compte de réseau. */
export const SMALL_MAX_FANS = 10_000;
export const isSmallAccount = (fans: number): boolean => fans < SMALL_MAX_FANS;

/** Recherches par passage (deux passages par jour) : toutes les tournures, une page chacune (30 vidéos). */
export const NAMING_PER_RUN = NAMING_QUERIES.length;

/** Ce qu'une vidéo donne à lire pour y trouver un site : sa légende et son texte à l'écran. */
export const namingText = (v: { caption: string; hook?: string }): string => `${v.caption} ${v.hook ?? ""}`.trim();

export type KnownHit = { slug: string; videos: number; authors: string[] };
const MAX_AUTHORS = 30;

/** Le témoin du jour : les apps déjà suivies que ces recherches ont retrouvées, vidéos additionnées, comptes réunis. */
export function mergeKnown(prev: readonly KnownHit[], add: readonly { slug: string; author: string }[]): KnownHit[] {
  const out = new Map(prev.map((k) => [k.slug, { ...k, authors: [...k.authors] }]));
  for (const a of add) {
    const k = out.get(a.slug) ?? { slug: a.slug, videos: 0, authors: [] };
    k.videos++;
    if (!k.authors.includes(a.author) && k.authors.length < MAX_AUTHORS) k.authors.push(a.author);
    out.set(a.slug, k);
  }
  return [...out.values()].sort((x, y) => y.authors.length - x.authors.length || x.slug.localeCompare(y.slug));
}
