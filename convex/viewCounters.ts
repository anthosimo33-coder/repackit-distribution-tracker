/**
 * LES QUATRE COMPTEURS DE VUES (règle A2) — jamais mélangés, jamais additionnés.
 *
 * Chaque compteur répond à UNE question et sert UN usage :
 *  - `totales`  : Σ de TOUTES les vues (warmup inclus) → AFFICHAGE et suivi ;
 *  - `payables` : Σ des vues des posts RÉMUNÉRÉS (isRemunerated) → fixe + CPM ;
 *  - `promo`    : Σ des vues des posts en PHASE PROMO (isPromoPost) → TOUS les taux
 *    de conversion ;
 *  - `paliers`  : Σ des vues RÉMUNÉRÉES **et** en phase promo (isBonusTierPost) →
 *    cumul des PALIERS de bonus créatrice.
 *
 * `payables ≠ promo` dès qu'un post est warmup ET rémunéré (« cas Kelly ») : il
 * compte pour la paie mais PAS pour la promo. Les additionner n'a AUCUN sens
 * (double comptage) — `totales` n'est pas `payables + promo`.
 *
 * ⚠️ `paliers ≠ payables` — même cas Kelly, et c'est TOUT L'OBJET du compteur :
 * un post warmup rémunéré est payé au fixe/CPM mais ne fait PAS avancer les
 * paliers. Décision produit : un bonus de vues ne se gagne que sur des vues de
 * promo effectivement rémunérées. `paliers ≤ payables` et `paliers ≤ promo`.
 * (Avant ce chantier, l'en-tête déclarait `totales` comme base des paliers ; le
 * code, lui, utilisait `payables` — les deux étaient faux.)
 *
 * DÉFINITION DE LA PROMO — `isPromoPost` est le POINT UNIQUE. Aujourd'hui « promo
 * = non-warmup ». Quand `creators.datePromoStart` arrivera, on changera CETTE
 * fonction (promo = publié après la borne de date) et RIEN d'autre : aucun test
 * isWarmup n'est répété dans les agrégats — `isBonusTierPost` suivra donc
 * automatiquement la nouvelle définition de la promo.
 *
 * Vit en convex/ (pricing + analyticsHub le consomment ; convex/ ne peut pas
 * importer lib/). Testé côté lib via `import ../convex/viewCounters`.
 */

import { isRemunerated, type RemunerationFlags } from "./remunerate";

export interface PromoFlags {
  /** Fait éditorial : le contenu ne mentionne pas l'app (hors promo). */
  isWarmup: boolean;
}

/**
 * Un post est-il en PHASE PROMO ? SEUL point de décision de la promo — à faire
 * évoluer vers `creators.datePromoStart` le moment venu (cf en-tête). Vérifié en
 * prod : « non-warmup » et « datePromoStart au 25/07 » donnent le même total (132 931).
 */
export function isPromoPost(p: PromoFlags): boolean {
  return !p.isWarmup;
}

/**
 * Un post fait-il avancer les PALIERS de bonus ? Il faut les DEUX : être
 * RÉMUNÉRÉ (fait financier) ET être en phase PROMO (fait éditorial). SEUL point
 * de décision des paliers — ni pricing ni progression ne re-testent isWarmup.
 *
 * Le cas qui motive la conjonction : un post warmup RÉMUNÉRÉ (« cas Kelly »,
 * isWarmup=true + remunere=true) est payé au fixe/CPM — `remunere` reste le fait
 * financier et n'est pas touché — mais ses vues ne comptent PAS pour les paliers.
 */
export function isBonusTierPost(p: RemunerationFlags): boolean {
  return isRemunerated(p) && isPromoPost(p);
}

export type ViewCountersInput = RemunerationFlags & { views: number };

export interface ViewCounters {
  /** Toutes vues (warmup incl.). Usage : affichage. NE PAS additionner aux autres. */
  totales: number;
  /** Vues des posts rémunérés. Usage : fixe + CPM. */
  payables: number;
  /** Vues des posts en phase promo (non-warmup). Usage : taux de conversion. */
  promo: number;
  /** Vues rémunérées ET en promo. Usage : cumul des paliers de bonus. */
  paliers: number;
}

/**
 * Les trois compteurs en UN passage, chacun sur sa base — mais JAMAIS additionnés
 * entre eux. `payables` et `promo` peuvent différer (cas Kelly) ; `totales` les
 * borne tous les deux (totales ≥ payables, totales ≥ promo) sans en être la somme.
 */
export function computeViewCounters(
  items: readonly ViewCountersInput[],
): ViewCounters {
  let totales = 0;
  let payables = 0;
  let promo = 0;
  let paliers = 0;
  for (const it of items) {
    const v = Math.max(0, it.views);
    totales += v;
    if (isRemunerated(it)) payables += v;
    if (isPromoPost(it)) promo += v;
    if (isBonusTierPost(it)) paliers += v;
  }
  return { totales, payables, promo, paliers };
}

/**
 * Ventilation des vues d'un projet en DEUX parts EXCLUSIVES et ADDITIVES —
 * `paidViews + unpaidViews === totales` — pour le dénominateur du RPM et le
 * toggle de la carte Rentabilité.
 *
 * QUEL compteur (règle A2 — la carte DÉCLARE lequel elle lit) : `payables`, PAS
 * `promo`. La carte Rentabilité met le revenu en face du COÛT ; son RPM répond
 * donc à « que me rapporte une vue que j'ai PAYÉE ? ». Lire `promo` répondrait à
 * « que rapporte une vue qui pouvait convertir ? » — une autre question, et une
 * qui rendrait invisible le retrait d'un post promo de la paie.
 *
 * ⚠️ La coupure est le fait FINANCIER (`isRemunerated`), PAS le fait éditorial
 * (`isWarmup`). Les deux ne coïncident pas : un post « pas warmup mais retiré de
 * la paie » (remunere=false) n'est pas monétisé, et un post « warmup mais payé »
 * (cas Kelly, remunere=true) l'est.
 *
 * C'est le défaut que cette fonction supprime : la carte Rentabilité ventilait
 * sur `p.isWarmup === true` en dur, alors que l'en-tête de ce module interdit
 * précisément de re-tester isWarmup dans un agrégat. Mesuré sur la prod du
 * 2026-09-02, le décalage allait dans les DEUX sens :
 *   - 7 posts / 398 357 vues NON rémunérés étaient comptés comme monétisés
 *     (277 857 sur le seul mois d'août, soit 23 % du mois) ;
 *   - 13 posts warmup explicitement PAYÉS en étaient exclus (694 000 vues sur
 *     juillet à eux seuls).
 *
 * Les deux parts sont ADDITIVES, contrairement aux quatre compteurs ci-dessus :
 * c'est une partition de `totales`, pas quatre lectures du même ensemble.
 */
export function viewsSplitOf(items: readonly ViewCountersInput[]): {
  /** Vues des posts RÉMUNÉRÉS (= compteur `payables`) — dénominateur du RPM. */
  paidViews: number;
  /** Vues des posts NON rémunérés (warmup, ou explicitement retirés de la paie). */
  unpaidViews: number;
} {
  const { totales, payables } = computeViewCounters(items);
  return { paidViews: payables, unpaidViews: totales - payables };
}

/** Libellés d'usage — la carte DÉCLARE lequel elle lit (règle A2). */
export const VIEW_COUNTER_USAGE = {
  totales: "Affichage et suivi",
  payables: "Fixe + CPM",
  promo: "Tous les taux de conversion",
  paliers: "Bonus paliers créatrice",
} as const;
