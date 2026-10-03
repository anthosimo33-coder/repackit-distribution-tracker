import { formatMoney } from "../convex/moneyFormat";
import type { MoneyByCurrency } from "../convex/payCurrency";

/**
 * TOTAUX PAR DEVISE — pour les écrans qui additionnent la paie de plusieurs
 * créatrices (Paiements, annuaire, accueil).
 *
 * Depuis les barèmes en devise, une créatrice payée en euros et une autre en
 * dollars peuvent se côtoyer dans le même projet. Additionner leurs dus ferait
 * un chiffre qui n'existe dans aucune banque : on vire des euros d'un côté, des
 * dollars de l'autre. Ces totaux se donnent donc PAR DEVISE, jamais fondus —
 * « 1 200,00 € · 3 400,00 $ ». Un écran où tout le monde est payé dans la même
 * devise affiche exactement ce qu'il affichait avant.
 *
 * La somme vit dans convex/payCurrency (pure, partagée avec les outils MCP).
 */
export { sumByCurrency } from "../convex/payCurrency";
export type { MoneyByCurrency } from "../convex/payCurrency";

/**
 * « 1 200,00 € · 3 400,00 $ » — chaque montant dans SA devise. Sans aucun
 * montant, « 0 » dans `fallbackCurrency` (la devise du projet, d'ordinaire).
 */
export function formatMoneyByCurrency(
  totals: MoneyByCurrency,
  locale?: string,
  fallbackCurrency?: string | null,
  separator = " · ",
): string {
  if (totals.length === 0) return formatMoney(0, fallbackCurrency, locale);
  return totals.map((t) => formatMoney(t.amount, t.currency, locale)).join(separator);
}

/** Le total est-il non nul dans au moins une devise ? */
export function hasAmount(totals: MoneyByCurrency): boolean {
  return totals.some((t) => t.amount > 0);
}
