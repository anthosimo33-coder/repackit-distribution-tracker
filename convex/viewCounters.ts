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

/** Libellés d'usage — la carte DÉCLARE lequel elle lit (règle A2). */
export const VIEW_COUNTER_USAGE = {
  totales: "Affichage et suivi",
  payables: "Fixe + CPM",
  promo: "Tous les taux de conversion",
  paliers: "Bonus paliers créatrice",
} as const;
