/**
 * Revenu Whop — logique PURE (testée Vitest, aucune dép Convex/React). SOURCE de
 * vérité de la NORMALISATION des statuts Whop + du calcul du NET de pilotage.
 *
 * Le NET (montant qui arrive réellement sur le solde APRÈS frais Whop) est le
 * chiffre de pilotage ; brut + frais sont conservés pour la transparence. Un
 * remboursement / paiement échoué NE GONFLE PAS le net (un remboursement le
 * FAIT BAISSER).
 *
 * ⚠️ Règle A6 — un module convex/ ne peut pas importer lib/. Ces fonctions sont
 * RÉPLIQUÉES à l'identique dans convex/whopRevenue.ts (normalisation à l'import +
 * agrégation au read). Toute évolution DOIT l'être des DEUX côtés. Les tests de
 * référence vivent ici (lib/whop-revenue.test.ts).
 */

/** Statut NORMALISÉ d'un paiement Whop (dérivé du substatus granulaire). */
export type WhopStatus =
  | "paid" // encaissé (succeeded / partially_refunded / dispute gagnée)
  | "refunded" // remboursé ou clawback (dispute perdue) → 0 au net
  | "failed" // échoué / annulé / impayé → 0
  | "pending" // en attente → 0
  | "disputed" // litige EN COURS (argent encore sur le solde) → compté
  | "other"; // inconnu / void / non résolu → 0

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

/**
 * Normalise un statut Whop (on privilégie le `substatus` granulaire, fallback
 * `status` grossier) vers notre union. Insensible à la casse. Inconnu → "other".
 * Basé sur l'API v1 Whop (ReceiptStatus + FriendlyReceiptStatus, cf recherche).
 */
export function normalizeWhopStatus(raw: string): WhopStatus {
  switch (raw.trim().toLowerCase()) {
    case "succeeded":
    case "paid":
    case "partially_refunded": // encaissé, le remboursé partiel est retranché via refundedAmount
    case "dispute_won":
    case "dispute_warning_closed":
    case "resolution_won":
      return "paid";
    case "refunded":
    case "auto_refunded":
    case "dispute_lost":
    case "dispute_closed":
    case "resolution_lost":
      return "refunded";
    case "failed":
    case "past_due":
    case "canceled":
    case "cancelled":
    case "price_too_low":
    case "uncollectible":
      return "failed";
    case "pending":
    case "incomplete":
    case "drafted":
    case "draft":
    case "open":
      return "pending";
    case "dispute_warning":
    case "dispute_needs_response":
    case "dispute_warning_needs_response":
    case "resolution_needs_response":
    case "dispute_under_review":
    case "dispute_warning_under_review":
    case "resolution_under_review":
    case "open_dispute":
    case "open_resolution":
      return "disputed";
    default:
      return "other"; // unresolved, void, valeurs futures → hors net
  }
}

/** Forme minimale d'un paiement pour le calcul du net (montants en devise). */
export interface WhopPaymentLike {
  status: WhopStatus;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  refundedAmount: number;
  currency?: string;
}

/** Un paiement est-il ENCAISSÉ (compte dans le revenu) ? */
function isCollected(status: WhopStatus): boolean {
  // "disputed" = litige en cours : l'argent est ENCORE sur le solde (pas encore
  // clawback) → compté. S'il devient perdu, il passe "refunded" → 0.
  return status === "paid" || status === "disputed";
}

/**
 * Contribution NETTE d'un paiement au revenu de pilotage :
 *  - non encaissé (failed / pending / refunded / other) → 0 (ne gonfle pas) ;
 *  - encaissé → net settlé (amount_after_fees) MOINS le remboursé partiel.
 * Planché à 0 (un remboursement dont la base dépasse le net — frais Whop non
 * restitués — ne rend pas la contribution d'un paiement absurde). Jamais NaN.
 */
export function whopNetContribution(p: WhopPaymentLike): number {
  if (!isCollected(p.status)) return 0;
  const net = finite(p.netAmount) - Math.max(0, finite(p.refundedAmount));
  return round2(Math.max(0, net));
}

export interface WhopRevenueSummary {
  /** PILOTAGE — Σ des contributions nettes (après frais Whop ET remboursements). */
  net: number;
  /** Σ brut des paiements encaissés (transparence). */
  gross: number;
  /** Σ frais Whop des paiements encaissés (transparence). */
  fees: number;
  /** Σ montants remboursés, TOUS paiements confondus (transparence). */
  refunded: number;
  /** Nb de paiements encaissés comptés dans le net. */
  paymentCount: number;
  /** Nb de paiements ayant un remboursement (partiel ou total). */
  refundCount: number;
  /** Devise (1re rencontrée ; une company Whop = une devise en pratique). */
  currency: string | null;
}

/**
 * Agrège une liste de paiements en revenu de pilotage. `net` est le chiffre de
 * pilotage (Σ contributions). brut/frais = paiements ENCAISSÉS uniquement ;
 * `refunded` inclut les remboursements totaux (dont les paiements passés
 * "refunded", exclus de brut/frais/net) → un remboursement FAIT BAISSER le net
 * (le paiement ne compte plus pour son ancien +net).
 */
export function summarizeWhopRevenue(
  payments: WhopPaymentLike[],
): WhopRevenueSummary {
  let net = 0;
  let gross = 0;
  let fees = 0;
  let refunded = 0;
  let paymentCount = 0;
  let refundCount = 0;
  let currency: string | null = null;
  for (const p of payments) {
    const refundedAmt = Math.max(0, finite(p.refundedAmount));
    refunded = round2(refunded + refundedAmt);
    if (p.status === "refunded" || refundedAmt > 0) refundCount += 1;
    if (isCollected(p.status)) {
      gross = round2(gross + finite(p.grossAmount));
      fees = round2(fees + finite(p.feeAmount));
      net = round2(net + whopNetContribution(p));
      paymentCount += 1;
      if (currency === null && p.currency) currency = p.currency;
    }
  }
  return { net, gross, fees, refunded, paymentCount, refundCount, currency };
}
