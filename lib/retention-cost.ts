/**
 * COÛT D'ACQUISITION PAR CLIENT de l'onglet Rétention — logique PURE.
 *
 * ⚠️ CE MODULE EXISTE À CAUSE D'UN DÉFAUT LIVRÉ EN PROD (PR #167, corrigé ici).
 * L'onglet recevait l'attribution FENÊTRÉE par le sélecteur de période, et
 * calculait :
 *
 *     (coût promo DE LA FENÊTRE + bonus DE LA FENÊTRE) ÷ clients payants Whop
 *
 * où « clients payants Whop » n'a jamais été fenêtré. Réduire la période à sept
 * jours divisait donc sept jours de coût par la totalité des clients acquis
 * depuis le début : le coût d'acquisition s'effondrait vers zéro. Et il était
 * affiché à côté du « revenu à ce jour », lui aussi cumulé depuis toujours, avec
 * un RATIO entre les deux — un ratio faux dès que la fenêtre n'était pas « tout ».
 *
 * La règle tenue ici : un numérateur ne se divise que par un dénominateur de la
 * MÊME population. Tant que Whop ne rend pas ses clients par jour sur cet
 * onglet, le coût doit être celui de TOUTE la profondeur, comme son
 * dénominateur. Passer une attribution fenêtrée rend `null`, pas un chiffre.
 */

import { coversEverything, type AnalyticsWindow, type DataRange } from "./analytics-window";

export interface AcquisitionCostInput {
  /** Coût des vidéos PROMO. `null` = au moins un coût par vidéo inconnu. */
  promo: number | null;
  /** Bonus de paliers et primes de défi. `null` = non calculable. */
  promoBonus: number | null;
  /**
   * Fenêtre appliquée à `promo` et `promoBonus`. `null` = aucune, les montants
   * portent sur toute la profondeur. C'est CE champ qui rend le défaut
   * détectable au lieu d'invisible.
   */
  window: AnalyticsWindow | null;
}

/**
 * Coût d'acquisition par client payant, dans la devise de PAIE.
 *
 * `payingMembers` vient de Whop et vaut pour TOUTE la profondeur : le coût doit
 * donc porter sur la même. Rend `null` quand ce n'est pas le cas — un tiret dit
 * la vérité, un quotient de deux populations différentes ment.
 */
export function acquisitionCostPerClient(
  costs: AcquisitionCostInput,
  payingMembers: number,
  range: DataRange | null,
): number | null {
  if (costs.window !== null && !coversEverything(costs.window, range)) {
    return null;
  }
  if (costs.promo === null || costs.promoBonus === null) return null;
  if (payingMembers <= 0) return null;
  return Math.round(((costs.promo + costs.promoBonus) / payingMembers) * 100) / 100;
}
