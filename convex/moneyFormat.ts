/**
 * Mise en forme d'un montant dans SA devise — déplacée de `lib/format-rate.ts`
 * (qui la ré-exporte) pour que le serveur et les outils MCP libellent un prix
 * exactement comme l'écran (règle A6 : le runtime Convex n'importe rien de lib/).
 */

/**
 * Langue de mise en forme par défaut. Tant qu'un appelant ne passe pas la
 * langue active, le rendu est celui d'avant l'i18n — à l'octet près.
 */
export const FORMAT_LOCALE_DEFAULT = "fr-FR";

/**
 * Montant formaté dans SA devise. Le code devise vient TOUJOURS de la donnée : la
 * paie créatrices est en DOLLARS (projects.payCurrency), le revenu Whop en EUROS
 * (whopPayments.currency). Il n'y a PAS de devise par défaut : appliquer une seule
 * devise partout affichait la paie ($) en euros (régression #157).
 *
 * `currency` absent ou vide → montant SANS symbole (jamais inventer une devise, on
 * préfère un nombre nu à un faux symbole). `narrowSymbol` donne « 4,99 $ » / « 4,99 €
 * » sans coller le code pays. Devise acceptée en minuscules (« usd », « eur »).
 */
export function formatMoney(
  n: number,
  currency?: string | null,
  /**
   * Langue de MISE EN FORME (séparateurs, position du symbole). Elle ne change
   * JAMAIS la devise : celle-ci vient de la transaction, jamais de la langue —
   * un payout en dollars reste en dollars dans une interface en français.
   *
   * Défaut « fr-FR » : le rendu actuel est strictement préservé tant qu'un
   * appelant ne passe pas explicitement la langue active. Les ~120 points
   * d'appel migrent écran par écran, avec l'extraction de chaque écran.
   */
  locale: string = FORMAT_LOCALE_DEFAULT,
): string {
  const code =
    currency && currency.trim() !== "" ? currency.trim().toUpperCase() : null;
  if (code === null) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
  }).format(n);
}
