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
export function currencySymbol(
  currency?: string | null,
  locale: string = "fr-FR",
): string {
  if (!currency || currency.trim() === "") return "";
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.trim().toUpperCase(),
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? "";
  } catch {
    return "";
  }
}

// Définis dans convex/currencyRate.ts (module pur partagé avec le serveur) :
// ré-exportés ici pour que les imports `@/lib/currency` restent valides.
export {
  effectiveFxRate,
  payAmountInRevenueCurrency,
  sameCurrency,
} from "../convex/currencyRate";
export type { DisplayAmount } from "../convex/currencyRate";

