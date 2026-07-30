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

/** Revenu SÉCURISÉ (cf lib/whop-revenue) : "paid" seul. Litige = à risque, exclu. */
function isSecuredRevenue(status: WhopStatus): boolean {
  return status === "paid";
}

/** Client ayant PAYÉ (cf lib/whop-revenue) : paid|disputed. Base du COMPTE clients. */
export function isCustomerPaid(status: WhopStatus): boolean {
  return status === "paid" || status === "disputed";
}

/** Contribution au net SÉCURISÉ, litige EXCLU (cf lib/whop-revenue — identique). */
export function whopNetContribution(p: WhopPaymentLike): number {
  if (!isSecuredRevenue(p.status)) return 0;
  const net = finite(p.netAmount) - Math.max(0, finite(p.refundedAmount));
  return round2(Math.max(0, net));
}

/** Montant encaissé client (paid|disputed) pour le COMPTE clients (cf lib — identique). */
export function whopCollectedAmount(p: WhopPaymentLike): number {
  if (!isCustomerPaid(p.status)) return 0;
  const net = finite(p.netAmount) - Math.max(0, finite(p.refundedAmount));
  return round2(Math.max(0, net));
}

/** Revenu agrégé pour UNE devise (cf lib/whop-revenue — DOIT rester identique). */
export interface WhopCurrencyRevenue {
  currency: string;
  net: number;
  gross: number;
  /** Frais EFFECTIFS = brut − net settlé (JAMAIS feeAmount, à 0/non fiable). */
  fees: number;
  /** Taux de frais = fees / brut (FRACTION 0–1). null si brut nul. */
  feeRate: number | null;
  refunded: number;
  /** Montant des litiges EN COURS (net − remboursé), À RISQUE, EXCLU de `net`. */
  disputed: number;
  paymentCount: number;
  refundCount: number;
  /** Nombre de litiges en cours (statut "disputed"). */
  disputedCount: number;
}

export interface WhopRevenueSummary {
  net: number;
  gross: number;
  /** Frais effectifs (brut − net settlé), jamais feeAmount. 0 si mixte. */
  fees: number;
  /** Taux de frais (fraction 0–1). null si brut nul OU devises mixtes. */
  feeRate: number | null;
  refunded: number;
  /** Montant total des litiges EN COURS (À RISQUE), EXCLU de `net`. 0 si mixte. */
  disputed: number;
  paymentCount: number;
  refundCount: number;
  /** Nombre de litiges en cours, toutes devises. */
  disputedCount: number;
  /** Devise si UNE seule encaissée ; null si aucune OU plusieurs (mixte). */
  currency: string | null;
  currencies: string[];
  /** true = plusieurs devises → sommes NON additionnables (=0). Lire byCurrency. */
  mixedCurrency: boolean;
  byCurrency: WhopCurrencyRevenue[];
}

/**
 * Agrège une liste de paiements PAR DEVISE (cf lib/whop-revenue — DOIT rester
 * identique). Taux de frais = brut − net (jamais feeAmount). Multi-devise ⇒
 * sommes à 0 + mixedCurrency (on ne mélange jamais les devises, A5).
 */
export function summarizeWhopRevenue(
  payments: WhopPaymentLike[],
): WhopRevenueSummary {
  type Acc = {
    gross: number;
    netSettled: number;
    net: number;
    refunded: number;
    disputed: number;
    paymentCount: number;
    refundCount: number;
    disputedCount: number;
  };
  const buckets = new Map<string, Acc>();
  const bucketOf = (cur: string): Acc => {
    let a = buckets.get(cur);
    if (!a) {
      a = {
        gross: 0,
        netSettled: 0,
        net: 0,
        refunded: 0,
        disputed: 0,
        paymentCount: 0,
        refundCount: 0,
        disputedCount: 0,
      };
      buckets.set(cur, a);
    }
    return a;
  };

  for (const p of payments) {
    const cur = p.currency && p.currency !== "" ? p.currency : "(inconnue)";
    const a = bucketOf(cur);
    const refundedAmt = Math.max(0, finite(p.refundedAmount));
    a.refunded = round2(a.refunded + refundedAmt);
    if (p.status === "refunded" || refundedAmt > 0) a.refundCount += 1;
    // Litige EN COURS : montant À RISQUE, suivi à part et EXCLU du net sécurisé.
    if (p.status === "disputed") {
      a.disputed = round2(
        a.disputed + Math.max(0, finite(p.netAmount) - refundedAmt),
      );
      a.disputedCount += 1;
    }
    if (isSecuredRevenue(p.status)) {
      a.gross = round2(a.gross + finite(p.grossAmount));
      a.netSettled = round2(a.netSettled + finite(p.netAmount));
      a.net = round2(a.net + whopNetContribution(p));
      a.paymentCount += 1;
    }
  }

  const byCurrency: WhopCurrencyRevenue[] = [...buckets.entries()].map(
    ([currency, a]) => {
      const fees = round2(a.gross - a.netSettled);
      return {
        currency,
        net: a.net,
        gross: a.gross,
        fees,
        feeRate: a.gross > 0 ? Math.round((fees / a.gross) * 10000) / 10000 : null,
        refunded: a.refunded,
        disputed: a.disputed,
        paymentCount: a.paymentCount,
        refundCount: a.refundCount,
        disputedCount: a.disputedCount,
      };
    },
  );

  const collected = byCurrency.filter((c) => c.paymentCount > 0);
  const currencies = collected.map((c) => c.currency);
  const paymentCount = byCurrency.reduce((s, c) => s + c.paymentCount, 0);
  const refundCount = byCurrency.reduce((s, c) => s + c.refundCount, 0);
  const disputedCount = byCurrency.reduce((s, c) => s + c.disputedCount, 0);

  if (currencies.length > 1) {
    return {
      net: 0,
      gross: 0,
      fees: 0,
      feeRate: null,
      refunded: 0,
      disputed: 0,
      paymentCount,
      refundCount,
      disputedCount,
      currency: null,
      currencies,
      mixedCurrency: true,
      byCurrency,
    };
  }

  const one = collected[0] ?? null;
  const refunded = round2(byCurrency.reduce((s, c) => s + c.refunded, 0));
  const disputed = round2(byCurrency.reduce((s, c) => s + c.disputed, 0));
  return {
    net: one ? one.net : 0,
    gross: one ? one.gross : 0,
    fees: one ? one.fees : 0,
    feeRate: one ? one.feeRate : null,
    refunded,
    disputed,
    paymentCount,
    refundCount,
    disputedCount,
    currency: one ? one.currency : null,
    currencies,
    mixedCurrency: false,
    byCurrency,
  };
}
