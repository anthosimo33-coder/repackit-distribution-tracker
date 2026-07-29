/**
 * DEVISES du produit — il y en a DEUX, jamais un défaut.
 *  - PAIE créatrices (fixe, CPM, bonus, paliers, dû, cycles) : DOLLARS, code dans
 *    projects.payCurrency ;
 *  - REVENU Whop (net encaissé, économie par offre, frais) : EUROS, code dans
 *    whopPayments.currency.
 *
 * Règle absolue : les deux ne sont JAMAIS additionnées ni comparées sans
 * conversion explicite. La marge (revenu − coût) croise les deux → elle n'existe
 * que si un taux de change les relie (projects.fxRateToRevenue), sinon elle n'est
 * pas calculée (jamais inventée).
 *
 * Module PUR (aucune dép Convex/React), testé côté lib.
 */

/** Symbole d'une devise (« $ », « € ») via Intl ; "" si code absent/inconnu. */
export function currencySymbol(currency?: string | null): string {
  if (!currency || currency.trim() === "") return "";
  try {
    const parts = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: currency.trim().toUpperCase(),
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? "";
  } catch {
    return "";
  }
}

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
