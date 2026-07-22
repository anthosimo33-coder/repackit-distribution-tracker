/**
 * Revenu Whop — RÉPLIQUE SERVEUR de lib/whop-revenue.ts (règle A6 : un module
 * convex/ ne peut pas importer lib/). DOIT rester IDENTIQUE (mêmes valeurs, même
 * sémantique). Les tests de référence vivent côté lib (lib/whop-revenue.test.ts).
 *
 * Pas de fonction Convex ici : pures fonctions importées par convex/whopApi.ts
 * (normalisation à l'import) et convex/whopSync.ts (agrégation au read).
 */

export type WhopStatus =
  | "paid"
  | "refunded"
  | "failed"
  | "pending"
  | "disputed"
  | "other";

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

/** Normalise un statut Whop (substatus granulaire, fallback status). Cf lib. */
export function normalizeWhopStatus(raw: string): WhopStatus {
  switch (raw.trim().toLowerCase()) {
    case "succeeded":
    case "paid":
    case "partially_refunded":
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
      return "other";
  }
}

export interface WhopPaymentLike {
  status: WhopStatus;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  refundedAmount: number;
  currency?: string;
}

function isCollected(status: WhopStatus): boolean {
  return status === "paid" || status === "disputed";
}

/** Contribution nette d'un paiement (cf lib/whop-revenue — DOIT rester identique). */
export function whopNetContribution(p: WhopPaymentLike): number {
  if (!isCollected(p.status)) return 0;
  const net = finite(p.netAmount) - Math.max(0, finite(p.refundedAmount));
  return round2(Math.max(0, net));
}

export interface WhopRevenueSummary {
  net: number;
  gross: number;
  fees: number;
  refunded: number;
  paymentCount: number;
  refundCount: number;
  currency: string | null;
}

/** Agrège une liste de paiements (cf lib/whop-revenue — DOIT rester identique). */
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
