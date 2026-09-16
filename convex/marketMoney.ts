/**
 * MONTANTS D'UN SOUS-LOT de paiements, dans la devise du revenu — logique PURE.
 *
 * ⚠️ POURQUOI PAS `summarizeWhopRevenue(sousLot, fx)`. Le résumé ne convertit
 * que quand SON lot mélange plusieurs devises. L'onglet Pays résume des lots
 * d'un seul pays, d'un seul plan, voire d'un seul paiement : un lot 100 % dinars
 * ou 100 % dollars ressortait dans sa devise d'origine, affiché en euros.
 * Constaté le 16/09/2026 : « 599,00 € » de prix et « 1 605,83 € » de revenu net
 * pour trois abonnements serbes (≈ 13,70 €), et chaque paiement en dollars
 * compté un pour un en euros dans le revenu par marché, la tendance mensuelle et
 * la valeur client.
 *
 * Le RÉFÉRENTIEL est le résumé de TOUT l'historique du projet : c'est lui qui
 * sait vers quelle devise convertir et à quel taux. Chaque sous-lot est ensuite
 * sommé paiement par paiement dans cette devise.
 */
import type { Doc } from "./_generated/dataModel";
import {
  whopNetInSummaryCurrency,
  type WhopPaymentLike,
  type WhopRevenueSummary,
} from "./whopRevenue";

type Referentiel = Pick<WhopRevenueSummary, "conversions" | "mixedCurrency">;

/** Net encaissé d'un sous-lot, dans la devise du référentiel. */
export function netInReference(
  lignes: readonly (WhopPaymentLike | Doc<"whopPayments">)[],
  referentiel: Referentiel,
): number {
  // Devises non convertibles : le même zéro que le résumé, jamais une somme de
  // dollars et d'euros.
  if (referentiel.mixedCurrency) return 0;
  let total = 0;
  for (const p of lignes) total += whopNetInSummaryCurrency(p, referentiel);
  return Math.round(total * 100) / 100;
}

/** Montant BRUT d'un paiement, dans la devise du référentiel. */
export function grossInReference(
  p: WhopPaymentLike | Doc<"whopPayments">,
  referentiel: Referentiel,
): number {
  const cur = p.currency?.trim().toLowerCase();
  const c = referentiel.conversions.find((x) => x.from === cur);
  return c ? p.grossAmount * c.rate : p.grossAmount;
}
