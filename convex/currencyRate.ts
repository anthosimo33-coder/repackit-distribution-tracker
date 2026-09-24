/**
 * TAUX paie → revenu — module PUR (aucun import), partagé par l'écran (via
 * lib/currency) et le serveur (outil MCP `rentabilite`). A6 interdit
 * `convex/ → lib/`, pas l'inverse : la définition vit donc ici, et lib/currency
 * la ré-exporte. Une seule implémentation — deux copies finissent par ne plus
 * convertir pareil. Tests : lib/currency.test.ts.
 */

/** Deux codes devise désignent-ils la même monnaie (casse/espaces ignorés) ? */
export function sameCurrency(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Taux EFFECTIF pour exprimer la devise de la PAIE dans celle du REVENU :
 *  - mêmes devises → 1 (aucune conversion nécessaire) ;
 *  - devises différentes → le taux du projet (fxRateToRevenue) s'il est renseigné
 *    et strictement positif ;
 *  - sinon `null` = marge NON calculable (on ne mélange jamais deux devises).
 */
export function effectiveFxRate(
  payCurrency: string | null | undefined,
  revenueCurrency: string | null | undefined,
  fxRateToRevenue: number | null | undefined,
): number | null {
  if (sameCurrency(payCurrency, revenueCurrency)) return 1;
  if (typeof fxRateToRevenue === "number" && fxRateToRevenue > 0) {
    return fxRateToRevenue;
  }
  return null;
}
