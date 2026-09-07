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
 * MÊME population. Depuis que l'onglet sait réduire ses clients à une COHORTE
 * D'ACQUISITION, les deux peuvent être fenêtrés ensemble — et c'est la seule
 * autre combinaison acceptée. Toute autre rend `null`, pas un chiffre.
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
 * LA RÈGLE : le coût et les clients doivent porter sur LA MÊME PÉRIODE. Deux
 * façons d'y arriver, toutes deux acceptées :
 *  - les deux sur toute la profondeur (aucune fenêtre nulle part) ;
 *  - les deux sur la MÊME fenêtre — le coût filtré par le sélecteur, et les
 *    clients réduits à la cohorte acquise dans cette même période.
 *
 * Tout le reste rend `null`. Un coût de sept jours divisé par six semaines de
 * clients a été affiché en prod (#167) : il sortait douze fois trop bas, à côté
 * d'un « revenu à ce jour » cumulé, avec un ratio entre les deux.
 */
export function acquisitionCostPerClient(
  costs: AcquisitionCostInput,
  payingMembers: number,
  range: DataRange | null,
  /**
   * Fenêtre de la COHORTE de clients. `null` = les clients comptés sont ceux de
   * toute la profondeur.
   */
  clientWindow: AnalyticsWindow | null = null,
): number | null {
  const coutTotal =
    costs.window === null || coversEverything(costs.window, range);
  const clientsTotal =
    clientWindow === null || coversEverything(clientWindow, range);
  const memeFenetre =
    costs.window !== null &&
    clientWindow !== null &&
    costs.window.from === clientWindow.from &&
    costs.window.to === clientWindow.to;
  if (!((coutTotal && clientsTotal) || memeFenetre)) return null;
  if (costs.promo === null || costs.promoBonus === null) return null;
  if (payingMembers <= 0) return null;
  return Math.round(((costs.promo + costs.promoBonus) / payingMembers) * 100) / 100;
}
