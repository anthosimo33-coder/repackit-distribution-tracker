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

/** Revenu agrégé pour UNE devise (jamais mélangé à une autre, règle A5). */
export interface WhopCurrencyRevenue {
  currency: string;
  /** PILOTAGE — Σ contributions nettes (après frais Whop ET remboursements). */
  net: number;
  /** Σ brut des paiements encaissés. */
  gross: number;
  /**
   * Frais EFFECTIFS = brut − net settlé (Σ netAmount). JAMAIS `feeAmount`, qui
   * est à 0 partout en prod et n'est pas fiable (règle A5). Exclut les
   * remboursements (calculé sur le net settlé, avant remboursement).
   */
  fees: number;
  /** Taux de frais = fees / brut (FRACTION 0–1, l'UI ×100). null si brut nul. */
  feeRate: number | null;
  refunded: number;
  paymentCount: number;
  refundCount: number;
}

export interface WhopRevenueSummary {
  /** PILOTAGE — Σ contributions nettes. 0 si plusieurs devises (voir mixedCurrency). */
  net: number;
  gross: number;
  /** Frais effectifs (brut − net settlé), jamais feeAmount. 0 si mixte. */
  fees: number;
  /** Taux de frais (fraction 0–1). null si brut nul OU devises mixtes. */
  feeRate: number | null;
  refunded: number;
  paymentCount: number;
  refundCount: number;
  /** Devise si UNE seule encaissée ; null si aucune OU plusieurs (mixte). */
  currency: string | null;
  /** Devises encaissées distinctes. */
  currencies: string[];
  /**
   * true = plusieurs devises encaissées → les sommes monétaires ci-dessus NE SONT
   * PAS additionnables et valent 0 (on ne mélange JAMAIS les devises, A5). Lire
   * `byCurrency` à la place.
   */
  mixedCurrency: boolean;
  /** Détail par devise (≥1 entrée dès qu'un paiement est encaissé). */
  byCurrency: WhopCurrencyRevenue[];
}

/**
 * Agrège une liste de paiements en revenu de pilotage, PAR DEVISE. Le taux de
 * frais se lit sur brut − net (jamais feeAmount). Si plusieurs devises sont
 * encaissées, les totaux monétaires valent 0 et `mixedCurrency` est vrai : on ne
 * somme JAMAIS des devises différentes (A5) — l'UI lit `byCurrency`. En pratique
 * une company Whop = une devise, donc le cas courant reste mono-devise.
 */
export function summarizeWhopRevenue(
  payments: WhopPaymentLike[],
): WhopRevenueSummary {
  type Acc = {
    gross: number;
    netSettled: number;
    net: number;
    refunded: number;
    paymentCount: number;
    refundCount: number;
  };
  const buckets = new Map<string, Acc>();
  const bucketOf = (cur: string): Acc => {
    let a = buckets.get(cur);
    if (!a) {
      a = { gross: 0, netSettled: 0, net: 0, refunded: 0, paymentCount: 0, refundCount: 0 };
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
    if (isCollected(p.status)) {
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
        paymentCount: a.paymentCount,
        refundCount: a.refundCount,
      };
    },
  );

  const collected = byCurrency.filter((c) => c.paymentCount > 0);
  const currencies = collected.map((c) => c.currency);
  // Comptes = grandeurs SANS dimension → additionnables même en multi-devise.
  const paymentCount = byCurrency.reduce((s, c) => s + c.paymentCount, 0);
  const refundCount = byCurrency.reduce((s, c) => s + c.refundCount, 0);

  if (currencies.length > 1) {
    // Multi-devise : on NE SOMME PAS les montants (A5).
    return {
      net: 0,
      gross: 0,
      fees: 0,
      feeRate: null,
      refunded: 0,
      paymentCount,
      refundCount,
      currency: null,
      currencies,
      mixedCurrency: true,
      byCurrency,
    };
  }

  // 0 ou 1 devise encaissée : les sommes sont valides (mono-devise).
  const one = collected[0] ?? null;
  const refunded = round2(byCurrency.reduce((s, c) => s + c.refunded, 0));
  return {
    net: one ? one.net : 0,
    gross: one ? one.gross : 0,
    fees: one ? one.fees : 0,
    feeRate: one ? one.feeRate : null,
    refunded,
    paymentCount,
    refundCount,
    currency: one ? one.currency : null,
    currencies,
    mixedCurrency: false,
    byCurrency,
  };
}
