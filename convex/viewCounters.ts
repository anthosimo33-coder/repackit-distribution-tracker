/**
 * LES TROIS COMPTEURS DE VUES (règle A2) — jamais mélangés, jamais additionnés.
 *
 * Chaque compteur répond à UNE question et sert UN usage :
 *  - `totales`  : Σ de TOUTES les vues (warmup inclus) → paliers bonus créatrice ;
 *  - `payables` : Σ des vues des posts RÉMUNÉRÉS (isRemunerated) → moteur de paie ;
 *  - `promo`    : Σ des vues des posts en PHASE PROMO (isPromoPost) → TOUS les taux
 *    de conversion.
 *
 * `payables ≠ promo` dès qu'un post est warmup ET rémunéré (« cas Kelly ») : il
 * compte pour la paie mais PAS pour la promo. Les additionner n'a AUCUN sens
 * (double comptage) — `totales` n'est pas `payables + promo`.
 *
 * DÉFINITION DE LA PROMO — `isPromoPost` est le POINT UNIQUE. Aujourd'hui « promo
 * = non-warmup ». Quand `creators.datePromoStart` arrivera, on changera CETTE
 * fonction (promo = publié après la borne de date) et RIEN d'autre : aucun test
 * isWarmup n'est répété dans les agrégats.
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

export type ViewCountersInput = RemunerationFlags & { views: number };

export interface ViewCounters {
  /** Toutes vues (warmup incl.). Usage : paliers. NE PAS additionner aux autres. */
  totales: number;
  /** Vues des posts rémunérés. Usage : moteur de paie. */
  payables: number;
  /** Vues des posts en phase promo (non-warmup). Usage : taux de conversion. */
  promo: number;
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
  for (const it of items) {
    const v = Math.max(0, it.views);
    totales += v;
    if (isRemunerated(it)) payables += v;
    if (isPromoPost(it)) promo += v;
  }
  return { totales, payables, promo };
}

/** Libellés d'usage — la carte DÉCLARE lequel elle lit (règle A2). */
export const VIEW_COUNTER_USAGE = {
  totales: "Bonus paliers créatrice",
  payables: "Moteur de paie",
  promo: "Tous les taux de conversion",
} as const;
