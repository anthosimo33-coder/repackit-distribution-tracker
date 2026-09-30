/**
 * MISE EN FORME des sorties MCP — logique PURE, testée depuis lib/.
 *
 * Un client MCP (Claude) lit TOUT ce qu'on lui sert, et le paie en contexte :
 * une réponse qui noie trois lignes utiles dans quarante lignes à zéro coûte
 * cher et se lit mal. Ces fonctions décident de ce qui sort par défaut ; le
 * détail complet reste accessible par un argument explicite de l'outil.
 */

/**
 * Offres VENDUES d'un marché : les plus vendues d'abord, jamais les invendues.
 *
 * ⚠️ POURQUOI. L'agrégat Pays trie ses offres par PRIX croissant (lecture de
 * gamme, à l'écran). L'outil n'en gardait que les cinq premières : sur la
 * Francophonie de Snytch (51 clients, 30/09/2026), il ne restait que trois
 * offres à 0 € et deux à 4,99 €, toutes à 0 client — les offres réellement
 * vendues étaient coupées.
 */
export function offresVendues<P extends { clients: number; price: number }>(
  plans: readonly P[],
  max: number,
): { lignes: P[]; nonAffichees: number } {
  const vendues = plans
    .filter((p) => p.clients > 0)
    .sort((a, b) => b.clients - a.clients || a.price - b.price);
  return { lignes: vendues.slice(0, max), nonAffichees: Math.max(0, vendues.length - max) };
}

/** Ce qu'il faut d'un marché pour savoir s'il a eu la moindre activité. */
export interface ActiviteMarche {
  videos: number;
  cost: number;
  clients: number;
  payments: number;
  revenueNet: number;
  promoViews: number;
}

/**
 * Un marché SANS AUCUNE activité sur la période : ni dépense, ni vidéo, ni vue
 * promo, ni paiement. Seul le trafic PostHog l'a fait apparaître (un pays de
 * connexion). Sur Snytch, 9 lignes sur 20 — toutes à zéro.
 *
 * Un marché « sans dépense » qui ENCAISSE (clients organiques) reste une
 * vraie ligne : c'est une information, pas du bruit.
 */
export function marcheInactif(m: ActiviteMarche): boolean {
  return (
    m.videos === 0 &&
    m.cost === 0 &&
    m.clients === 0 &&
    m.payments === 0 &&
    m.revenueNet === 0 &&
    m.promoViews === 0
  );
}

/**
 * Posts ESSENTIELS d'un groupe (dashboard, posts des 48 dernières heures) :
 * seulement ceux qui ont déjà un relevé, les plus vus d'abord, `max` au plus.
 * Les posts en attente de relevé (0 vue, rien à lire) et le reste sont COMPTÉS,
 * pas listés. Sur Snytch le 30/09/2026, une créatrice avait 28 posts dont 10
 * sans relevé et 14 à zéro vue.
 */
export function postsEssentiels<P>(
  posts: readonly P[],
  opts: { mesure: (p: P) => boolean; vues: (p: P) => number; max: number },
): { gardes: P[]; enAttenteDeReleve: number; autres: number } {
  const mesures = posts.filter(opts.mesure);
  const tries = [...mesures].sort((a, b) => opts.vues(b) - opts.vues(a));
  return {
    gardes: tries.slice(0, opts.max),
    enAttenteDeReleve: posts.length - mesures.length,
    autres: Math.max(0, mesures.length - opts.max),
  };
}
