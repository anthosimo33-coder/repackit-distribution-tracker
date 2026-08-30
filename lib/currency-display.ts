import { formatMoney } from "./format-rate";
import {
  currencySymbol,
  payAmountInRevenueCurrency,
  type DisplayAmount,
} from "./currency";
import { formatNumber } from "./format";

/**
 * LE SEUL module autorisé à formater un montant dans la devise de PAIE.
 *
 * Le hub affiche tout dans la devise du REVENU (l'euro). Les coûts créatrices
 * sont libellés en dollars dans la donnée : ils passent donc tous par ici, qui
 * convertit au taux du projet et rend la mention « 10,62 $ converti ».
 *
 * Le défaut vécu (prod, 2026-08-30) : « Coût d'acquisition » et « Coût complet
 * du moteur » sortaient en dollars, posés à côté de « Revenu net par client » en
 * euros comme s'ils étaient comparables — 10,62 $ face à 11,10 €, soit 9,13 €
 * une fois converti. L'erreur se lisait dans le MAUVAIS SENS : la marge réelle
 * était meilleure que ce que l'écran montrait. Sept montants étaient concernés,
 * pas deux. La conversion existait pourtant déjà (RPM promo, Rétention) : ce qui
 * manquait, c'était un passage OBLIGÉ — d'où ce module, et la garde de
 * lib/currency-hardcode.test.ts qui interdit `formatMoney(x, payCurrency)`
 * dans TOUT composant de components/analytics/ : la seule voie est ce module.
 *
 * Il vit dans lib/ et non à côté des composants pour une raison pratique : la
 * config vitest ne couvre que lib/, et ces quatre fonctions — pures, sans JSX —
 * sont précisément ce qu'il faut tester (un libellé qui dirait « converti » sur
 * un montant qui ne l'est pas serait invisible à l'œil).
 *
 * Le montant N'EST PAS converti quand le projet n'a pas de taux réglé
 * (`fxRateToRevenue` absent) : il reste alors en dollars et la mention le DIT,
 * plutôt que d'afficher un euro inventé.
 */

/** Contexte devises d'un écran : la paie, le revenu, et le taux qui les relie. */
export interface CurrencyContext {
  payCurrency: string | null | undefined;
  revenueCurrency: string | null | undefined;
  fxRateToRevenue: number | null | undefined;
}

/** Convertit un montant de paie pour l'affichage (null passe en null). */
export function toDisplayAmount(
  amount: number | null | undefined,
  ctx: CurrencyContext,
): DisplayAmount | null {
  if (amount == null) return null;
  return payAmountInRevenueCurrency(
    amount,
    ctx.payCurrency,
    ctx.revenueCurrency,
    ctx.fxRateToRevenue,
  );
}

/** Le montant, dans la devise d'affichage. « — » si absent. */
export function convertedValue(d: DisplayAmount | null): string {
  if (d === null) return "—";
  return formatMoney(d.value, d.currency);
}

/**
 * La provenance, à écrire à côté de la valeur : « 10,62 $ converti » quand une
 * conversion a eu lieu, « non converti — aucun taux de change réglé sur le
 * projet » quand elle était impossible. Chaîne vide si paie et revenu sont déjà
 * dans la même devise (il n'y a rien à signaler).
 */
export function conversionNote(d: DisplayAmount | null): string {
  if (d === null) return "";
  if (d.converted) {
    return `${formatMoney(d.sourceValue, d.sourceCurrency)} converti`;
  }
  if (d.rate === null) {
    return "non converti — aucun taux de change réglé sur le projet";
  }
  return "";
}

/**
 * Le taux du projet, en toutes lettres — à écrire UNE fois par écran, sous les
 * montants convertis. Chaîne vide quand il n'y a rien à dire.
 */
export function rateNote(ctx: CurrencyContext): string {
  const symPay = currencySymbol(ctx.payCurrency);
  const symRevenue = currencySymbol(ctx.revenueCurrency);
  const probe = payAmountInRevenueCurrency(
    1,
    ctx.payCurrency,
    ctx.revenueCurrency,
    ctx.fxRateToRevenue,
  );
  if (probe.rate === null) {
    return "aucun taux de change réglé sur le projet : les coûts restent en devise de paie";
  }
  if (probe.rate === 1) return "revenu et paie dans la même devise, aucune conversion";
  if (symPay === "" || symRevenue === "") return "";
  return `taux du projet : 1 ${symPay} = ${formatNumber(probe.rate)} ${symRevenue}`;
}
