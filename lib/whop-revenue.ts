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

// ─── Origine du revenu : acquisition vs rétention ────────────────────────────
// Whop distingue le PREMIER paiement d'un abonnement (`subscription_create`) de
// ses échéances suivantes (`subscription_cycle`). C'est la seule donnée qui
// sépare « j'ai gagné un client » de « un client m'a rapporté à nouveau » : sans
// elle, une journée faite uniquement de renouvellements affiche « 0 client
// payant » à côté d'un revenu non nul, sans rien pour l'expliquer.

/** Origine d'un paiement : acquisition, rétention, ou non renseignée. */
export type WhopBillingOrigin = "new" | "renewal" | "unknown";

/**
 * Origine d'un paiement d'après `billing_reason` Whop. Toute valeur inconnue —
 * y compris absente sur les paiements importés avant la capture du champ —
 * rend "unknown" : on ne DEVINE jamais qu'un paiement est une acquisition, un
 * renouvellement mal classé gonflerait le compte de nouveaux clients.
 */
export function whopBillingOrigin(billingReason?: string | null): WhopBillingOrigin {
  switch ((billingReason ?? "").trim().toLowerCase()) {
    case "subscription_create":
      return "new";
    case "subscription_cycle":
    case "subscription_update": // changement d'offre en cours de vie = pas une acquisition
      return "renewal";
    default:
      return "unknown";
  }
}

/** Statut NORMALISÉ d'un paiement Whop (dérivé du substatus granulaire). */
export type WhopStatus =
  | "paid" // encaissé (succeeded / partially_refunded / dispute gagnée)
  | "refunded" // remboursé ou clawback (dispute perdue) → 0 au net
  | "failed" // échoué / annulé / impayé → 0
  | "pending" // en attente → 0
  | "disputed" // litige EN COURS → À RISQUE : compté client, EXCLU du net
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

/**
 * Revenu SÉCURISÉ : uniquement "paid". Un litige EN COURS est de l'argent À
 * RISQUE — la banque peut le reprendre (clawback) et les frais de litige dépassent
 * souvent l'abonnement : on ne le compte JAMAIS comme revenu acquis. S'il est
 * gagné il repasse "paid" (recompté) ; perdu, "refunded" (déjà 0). C'est la
 * réponse à « le net affiche-t-il du revenu que je ne toucherai jamais ? » : non.
 */
function isSecuredRevenue(status: WhopStatus): boolean {
  return status === "paid";
}

/**
 * Un paiement représente-t-il un CLIENT qui a effectivement payé (l'argent est
 * arrivé sur le solde) ? "paid" OU "disputed" — un litige en cours est un RISQUE,
 * pas un non-paiement : le client a bien payé. Base du COMPTE de clients (jamais
 * du revenu, cf whopNetContribution qui, lui, exclut les litiges).
 */
export function isCustomerPaid(status: WhopStatus): boolean {
  return status === "paid" || status === "disputed";
}

/**
 * Contribution au revenu net SÉCURISÉ de pilotage :
 *  - non sécurisé (failed / pending / refunded / disputed / other) → 0 ;
 *  - sécurisé → net settlé (amount_after_fees) MOINS le remboursé partiel.
 * Planché à 0 (un remboursement dont la base dépasse le net — frais Whop non
 * restitués — ne rend pas la contribution d'un paiement absurde). Jamais NaN.
 * Les litiges EN COURS en sont EXCLUS (à risque) : ils vivent dans la carte
 * « Litiges et remboursements » (montant à risque), jamais dans le net.
 */
export function whopNetContribution(p: WhopPaymentLike): number {
  if (!isSecuredRevenue(p.status)) return 0;
  const net = finite(p.netAmount) - Math.max(0, finite(p.refundedAmount));
  return round2(Math.max(0, net));
}

/**
 * Montant ENCAISSÉ d'un paiement client (paid|disputed), remboursement déduit.
 * Sert au COMPTE de clients payants (un litige reste un client qui a payé) — PAS
 * au revenu de pilotage, pour lequel il faut whopNetContribution (sécurisé, litige
 * exclu). Sépare « combien de clients ont payé » de « combien j'encaisse sûrement ».
 */
export function whopCollectedAmount(p: WhopPaymentLike): number {
  if (!isCustomerPaid(p.status)) return 0;
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
  /** Montant des litiges EN COURS (net − remboursé), À RISQUE, EXCLU de `net`. */
  disputed: number;
  paymentCount: number;
  refundCount: number;
  /** Nombre de litiges en cours (statut "disputed"). */
  disputedCount: number;
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
  /** Montant total des litiges EN COURS (À RISQUE), EXCLU de `net`. 0 si mixte. */
  disputed: number;
  paymentCount: number;
  refundCount: number;
  /** Nombre de litiges en cours (statut "disputed"), toutes devises. */
  disputedCount: number;
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
    // Litige EN COURS : montant À RISQUE (net settlé − remboursé), suivi À PART et
    // EXCLU du net sécurisé ci-dessous — un litige n'est pas du revenu acquis.
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

  // Devise « encaissée » = au moins un paiement sécurisé (même règle que pour les
  // remboursements : on ne bascule pas en multi-devise sur un litige/refund seul).
  const collected = byCurrency.filter((c) => c.paymentCount > 0);
  const currencies = collected.map((c) => c.currency);
  // Comptes = grandeurs SANS dimension → additionnables même en multi-devise.
  const paymentCount = byCurrency.reduce((s, c) => s + c.paymentCount, 0);
  const refundCount = byCurrency.reduce((s, c) => s + c.refundCount, 0);
  const disputedCount = byCurrency.reduce((s, c) => s + c.disputedCount, 0);

  if (currencies.length > 1) {
    // Multi-devise : on NE SOMME PAS les montants (A5).
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

  // 0 ou 1 devise en jeu : les sommes sont valides (mono-devise).
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

// ─── Renouvellements : le moteur de rétention du revenu ──────────────────────
// Question à laquelle ces fonctions répondent : le moteur est-il viable ? Un
// client acquis à 9,34 $ ne l'est que s'il rapporte plus que ça sur sa durée de
// vie. Tant qu'aucun renouvellement n'était observé, la question était ouverte.

/** Paiement enrichi de ce qu'il faut pour distinguer acquisition et rétention. */
export interface WhopRenewalPaymentLike extends WhopPaymentLike {
  /** Ms epoch — sert au bucket par jour. */
  paidAt: number;
  /** `billing_reason` BRUT de Whop (cf. whopBillingOrigin). */
  billingReason?: string;
  /** Offre Whop — ventile les renouvellements par produit. */
  planId?: string;
  /** Abonnement Whop — clé de comptage des cycles par client. */
  membershipId?: string;
}

/** Revenu d'un jour, séparé par origine, avec son cumul depuis le début. */
export interface RevenueOriginDay {
  day: string;
  newNet: number;
  renewalNet: number;
  unknownNet: number;
  newCount: number;
  renewalCount: number;
  unknownCount: number;
  /** Cumuls inclusifs à la fin de ce jour (pour la courbe cumulée). */
  cumulativeNewNet: number;
  cumulativeRenewalNet: number;
}

export interface RevenueByOrigin {
  days: RevenueOriginDay[];
  newNet: number;
  renewalNet: number;
  unknownNet: number;
  newCount: number;
  renewalCount: number;
  unknownCount: number;
  /**
   * Part du revenu venant des renouvellements (FRACTION 0–1, l'UI ×100). null si
   * aucun revenu classé. Les paiements d'origine inconnue sont EXCLUS du
   * dénominateur : les compter comme acquisition écraserait la part de rétention
   * tant que l'historique d'avant la capture du champ n'est pas re-synchronisé.
   */
  renewalShare: number | null;
  /** Nombre de paiements dont l'origine n'est pas connue (historique non re-synchronisé). */
  unknownPayments: number;
}

/**
 * Revenu NOUVEAU contre revenu de RENOUVELLEMENT, par jour et en cumulé.
 * `dayKeyOf` décide du fuseau (le hub bucketise en Europe/Paris) : la fonction
 * reste pure et testable sans dépendre d'un fuseau.
 * Seuls les paiements SÉCURISÉS pèsent (whopNetContribution vaut 0 sinon), mais
 * un paiement non sécurisé ne compte pas non plus dans les effectifs.
 */
export function splitRevenueByOrigin(
  payments: WhopRenewalPaymentLike[],
  dayKeyOf: (ms: number) => string,
): RevenueByOrigin {
  const byDay = new Map<string, RevenueOriginDay>();
  const totals = { newNet: 0, renewalNet: 0, unknownNet: 0, newCount: 0, renewalCount: 0, unknownCount: 0 };

  for (const p of payments) {
    const net = whopNetContribution(p);
    if (net <= 0 && !isCustomerPaid(p.status)) continue;
    const day = dayKeyOf(p.paidAt);
    let d = byDay.get(day);
    if (!d) {
      d = {
        day,
        newNet: 0, renewalNet: 0, unknownNet: 0,
        newCount: 0, renewalCount: 0, unknownCount: 0,
        cumulativeNewNet: 0, cumulativeRenewalNet: 0,
      };
      byDay.set(day, d);
    }
    const origin = whopBillingOrigin(p.billingReason);
    if (origin === "new") {
      d.newNet = round2(d.newNet + net); d.newCount += 1;
      totals.newNet = round2(totals.newNet + net); totals.newCount += 1;
    } else if (origin === "renewal") {
      d.renewalNet = round2(d.renewalNet + net); d.renewalCount += 1;
      totals.renewalNet = round2(totals.renewalNet + net); totals.renewalCount += 1;
    } else {
      d.unknownNet = round2(d.unknownNet + net); d.unknownCount += 1;
      totals.unknownNet = round2(totals.unknownNet + net); totals.unknownCount += 1;
    }
  }

  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  let cn = 0, cr = 0;
  for (const d of days) {
    cn = round2(cn + d.newNet);
    cr = round2(cr + d.renewalNet);
    d.cumulativeNewNet = cn;
    d.cumulativeRenewalNet = cr;
  }

  const classified = round2(totals.newNet + totals.renewalNet);
  return {
    days,
    ...totals,
    renewalShare: classified > 0 ? Math.round((totals.renewalNet / classified) * 10000) / 10000 : null,
    unknownPayments: totals.unknownCount,
  };
}

/** Renouvellements d'une offre : combien, pour combien. */
export interface RenewalsByPlan {
  planId: string;
  renewalCount: number;
  renewalNet: number;
  /** Clients distincts ayant renouvelé sur cette offre. */
  members: number;
}

/** Ventile les RENOUVELLEMENTS par offre Whop (le libellé est joint côté appelant). */
export function renewalsByPlan(payments: WhopRenewalPaymentLike[]): RenewalsByPlan[] {
  const acc = new Map<string, { n: number; net: number; mem: Set<string> }>();
  for (const p of payments) {
    if (whopBillingOrigin(p.billingReason) !== "renewal") continue;
    const net = whopNetContribution(p);
    if (net <= 0 && !isCustomerPaid(p.status)) continue;
    const key = p.planId ?? "(offre inconnue)";
    let a = acc.get(key);
    if (!a) { a = { n: 0, net: 0, mem: new Set() }; acc.set(key, a); }
    a.n += 1;
    a.net = round2(a.net + net);
    if (p.membershipId) a.mem.add(p.membershipId);
  }
  return [...acc.entries()]
    .map(([planId, a]) => ({ planId, renewalCount: a.n, renewalNet: a.net, members: a.mem.size }))
    .sort((x, y) => y.renewalNet - x.renewalNet);
}

/** Abonnement Whop, vu par le moteur de renouvellement (état = fait foi). */
export interface WhopMembershipLike {
  whopMembershipId: string;
  planId?: string;
  /** Fin d'accès de la période COURANTE (ms). Avance à chaque renouvellement. */
  accessEndsAt?: number;
}

/** Distribution des cycles : combien de clients ont payé exactement N fois. */
export interface CycleBucket {
  cycles: number;
  members: number;
}

export interface RenewalStats {
  /**
   * Abonnements ARRIVÉS À ÉCHÉANCE : ceux qui ont réellement fait face à une
   * décision de renouvellement. Deux cas, et seulement deux :
   *  - ils ont renouvelé (≥ 2 paiements encaissés) ;
   *  - leur accès a EXPIRÉ sans nouveau paiement (accessEndsAt dans le passé).
   * Un abonnement encore dans sa première période (accessEndsAt à venir, un seul
   * paiement) n'a rien décidé : le compter en échec écraserait le taux.
   */
  dueSubscriptions: number;
  /** Parmi eux, ceux qui ont renouvelé au moins une fois. */
  renewedSubscriptions: number;
  /** dueSubscriptions > 0 ? renewed / due : null. FRACTION 0–1, l'UI ×100. */
  renewalRate: number | null;
  /** Abonnements encore dans leur première période — n'ont pas encore décidé. */
  notYetDue: number;
  /** Cycles moyens par client payant (paiements encaissés / clients). null si aucun. */
  averageCycles: number | null;
  /** Distribution : combien de clients à 1, 2, 3… paiements. Triée par cycles. */
  cycleDistribution: CycleBucket[];
  /** Net moyen par paiement encaissé. null si aucun. */
  netPerPayment: number | null;
  /**
   * Revenu sur la durée de vie = net moyen par paiement × cycles moyens. null si
   * indéterminable. C'est une LECTURE DU PASSÉ, pas une projection : avec des
   * abonnements encore jeunes elle SOUS-ESTIME la valeur finale.
   */
  lifetimeValue: number | null;
  /** Clients (abonnements) distincts ayant au moins un paiement encaissé. */
  payingMembers: number;
  /**
   * Renouvellements TENTÉS mais PAS encaissés (statut failed/pending — Whop
   * relance un `past_due` plusieurs jours). Ce ne sont ni des churns confirmés
   * ni du revenu : de l'argent EN SUSPENS. Les ignorer ferait lire un taux de
   * renouvellement flatteur alors que des échéances sont en train d'échouer.
   */
  failedRenewalAttempts: number;
  /** Montant brut de ces tentatives — le montant à relancer. */
  failedRenewalAmount: number;
}

/**
 * Taux de renouvellement, cycles par client et revenu sur la durée de vie.
 * L'état des abonnements Whop FAIT FOI pour l'échéance ; les paiements font foi
 * pour les cycles. `now` est injecté (test déterministe).
 */
export function computeRenewalStats(
  payments: WhopRenewalPaymentLike[],
  memberships: WhopMembershipLike[],
  now: number,
): RenewalStats {
  // Cycles encaissés par abonnement.
  const cyclesByMember = new Map<string, number>();
  let paidPayments = 0;
  let paidNet = 0;
  let failedRenewalAttempts = 0;
  let failedRenewalAmount = 0;
  for (const p of payments) {
    // Renouvellement tenté et NON encaissé : ni churn ni revenu, argent en suspens.
    if (
      whopBillingOrigin(p.billingReason) === "renewal" &&
      (p.status === "failed" || p.status === "pending")
    ) {
      failedRenewalAttempts += 1;
      failedRenewalAmount = round2(failedRenewalAmount + finite(p.grossAmount));
    }
    if (!isCustomerPaid(p.status)) continue;
    paidPayments += 1;
    paidNet = round2(paidNet + whopNetContribution(p));
    const id = p.membershipId;
    if (!id) continue;
    cyclesByMember.set(id, (cyclesByMember.get(id) ?? 0) + 1);
  }

  let due = 0;
  let renewed = 0;
  let notYetDue = 0;
  for (const m of memberships) {
    const cycles = cyclesByMember.get(m.whopMembershipId) ?? 0;
    if (cycles === 0) continue; // jamais payé : hors sujet du renouvellement
    const hasRenewed = cycles >= 2;
    const lapsed = m.accessEndsAt !== undefined && m.accessEndsAt <= now;
    if (hasRenewed) { due += 1; renewed += 1; }
    else if (lapsed) { due += 1; }
    else { notYetDue += 1; }
  }

  const dist = new Map<number, number>();
  for (const n of cyclesByMember.values()) dist.set(n, (dist.get(n) ?? 0) + 1);
  const cycleDistribution = [...dist.entries()]
    .map(([cycles, members]) => ({ cycles, members }))
    .sort((a, b) => a.cycles - b.cycles);

  const payingMembers = cyclesByMember.size;
  const averageCycles = payingMembers > 0 ? Math.round((paidPayments / payingMembers) * 100) / 100 : null;
  const netPerPayment = paidPayments > 0 ? round2(paidNet / paidPayments) : null;

  return {
    dueSubscriptions: due,
    renewedSubscriptions: renewed,
    renewalRate: due > 0 ? Math.round((renewed / due) * 10000) / 10000 : null,
    notYetDue,
    averageCycles,
    cycleDistribution,
    netPerPayment,
    lifetimeValue:
      netPerPayment !== null && averageCycles !== null
        ? round2(netPerPayment * averageCycles)
        : null,
    payingMembers,
    failedRenewalAttempts,
    failedRenewalAmount,
  };
}
