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

/**
 * ISSUE d'une échéance — TROIS états, jamais deux. Un renouvellement tenté et
 * non encaissé (`past_due`, que Whop relance) n'est NI un succès NI un échec :
 * il est INDÉTERMINÉ. Le ranger d'un côté ou de l'autre change le taux du tout
 * au tout — vérifié en prod : 100 % en l'écartant, 55 % en le comptant en échec.
 */
export interface DueOutcomes {
  /** A payé au moins un cycle supplémentaire. */
  renewed: number;
  /** Accès EXPIRÉ sans nouveau paiement — échec constaté. */
  failed: number;
  /** Renouvellement tenté, pas encore encaissé — issue INCONNUE. */
  pending: number;
  /** Encore dans sa première période : n'a rien décidé. */
  notYetDue: number;
}

/** Une semaine d'acquisition et ce qu'elle a rapporté À CE JOUR. */
export interface CohortWeek {
  /** Clé de la semaine d'acquisition (fournie par `weekKeyOf`). */
  week: string;
  clients: number;
  /** Cycles encaissés cumulés par la cohorte. */
  cycles: number;
  net: number;
  /** Revenu net à ce jour rapporté au client de la cohorte. */
  netPerClient: number;
}

export interface RenewalStats {
  /** Issues des échéances — la base de tous les taux ci-dessous. */
  due: DueOutcomes;
  /**
   * Taux sur les échéances RÉSOLUES (renouvelées + échouées). C'est le taux
   * honnête : il ne se prononce pas sur ce qui n'est pas tranché. null si
   * aucune échéance n'est résolue.
   */
  renewalRateResolved: number | null;
  /**
   * BORNE BASSE — taux si TOUTES les échéances en attente finissaient en échec.
   * Affiché À CÔTÉ du taux résolu : entre les deux se trouve la vérité, et
   * n'en montrer qu'un seul serait un choix caché.
   */
  renewalRateWorstCase: number | null;
  /** Échéances tranchées (renouvelées + échouées) — taille d'échantillon du taux. */
  resolvedDueCount: number;
  /** Cycles moyens par client. DESCRIPTIF : écrasé par les abonnements jeunes. */
  averageCycles: number | null;
  cycleDistribution: CycleBucket[];
  /** Net moyen par paiement encaissé. */
  netPerPayment: number | null;
  /** Revenu net TOTAL encaissé (renouvellements compris). */
  netTotal: number;
  /**
   * 1 — REVENU À CE JOUR PAR CLIENT = net total / clients payants. Du RÉEL :
   * aucune projection, aucune hypothèse. Se lit tel quel, monte tout seul.
   */
  revenueToDatePerClient: number | null;
  /**
   * 2 — REVENU PROJETÉ PAR CLIENT au taux RÉSOLU. Nombre de cycles espéré =
   * 1 / (1 − taux), × net moyen par paiement. Dérivé du TAUX, pas d'une moyenne
   * de cycles que les abonnements jeunes écrasent.
   * null quand le taux vaut 1 : 1/(1−1) diverge. Un taux de 100 % sur un petit
   * échantillon ne veut pas dire « valeur infinie », il veut dire « pas encore
   * d'échec observé » — on ne projette pas là-dessus.
   */
  projectedPerClientResolved: number | null;
  /** 2 bis — même projection à la BORNE BASSE (attentes comptées en échec). */
  projectedPerClientWorstCase: number | null;
  /** 3 — Cohortes par semaine d'acquisition, plus ancienne d'abord. */
  cohorts: CohortWeek[];
  /**
   * MATURITÉ = part des clients ayant atteint au moins une échéance. Tant
   * qu'elle est basse, aucun taux ni aucune projection n'est interprétable :
   * c'est mesurer une espérance de vie sur une population encore vivante.
   */
  matureShare: number | null;
  /** Clients (abonnements) distincts ayant au moins un paiement encaissé. */
  payingMembers: number;
  /** Montant brut des renouvellements en attente — l'argent en suspens. */
  pendingRenewalAmount: number;
}

/**
 * Taux de renouvellement, revenu par client (réel et projeté) et cohortes.
 * L'état des abonnements Whop FAIT FOI pour l'échéance, les paiements pour les
 * cycles. `now` et `weekKeyOf` sont injectés (test déterministe, fuseau décidé
 * par l'appelant).
 */
export function computeRenewalStats(
  payments: WhopRenewalPaymentLike[],
  memberships: WhopMembershipLike[],
  opts: { now: number; weekKeyOf: (ms: number) => string },
): RenewalStats {
  const cyclesByMember = new Map<string, number>();
  const netByMember = new Map<string, number>();
  const firstPaidByMember = new Map<string, number>();
  /** Abonnements ayant une tentative de renouvellement NON encaissée en cours. */
  const pendingByMember = new Map<string, number>();
  let pendingRenewalAmount = 0;
  let paidPayments = 0;
  let netTotal = 0;

  for (const p of payments) {
    const isRenewal = whopBillingOrigin(p.billingReason) === "renewal";
    if (isRenewal && (p.status === "failed" || p.status === "pending")) {
      if (p.membershipId) {
        pendingByMember.set(
          p.membershipId,
          (pendingByMember.get(p.membershipId) ?? 0) + 1,
        );
      }
      pendingRenewalAmount = round2(pendingRenewalAmount + finite(p.grossAmount));
    }
    if (!isCustomerPaid(p.status)) continue;
    paidPayments += 1;
    const net = whopNetContribution(p);
    netTotal = round2(netTotal + net);
    const id = p.membershipId;
    if (!id) continue;
    cyclesByMember.set(id, (cyclesByMember.get(id) ?? 0) + 1);
    netByMember.set(id, round2((netByMember.get(id) ?? 0) + net));
    const prev = firstPaidByMember.get(id);
    if (prev === undefined || p.paidAt < prev) firstPaidByMember.set(id, p.paidAt);
  }

  // ─── Issues des échéances (trois états) ────────────────────────────────────
  const due: DueOutcomes = { renewed: 0, failed: 0, pending: 0, notYetDue: 0 };
  for (const m of memberships) {
    const cycles = cyclesByMember.get(m.whopMembershipId) ?? 0;
    if (cycles === 0) continue; // jamais payé : hors sujet du renouvellement
    if (cycles >= 2) {
      due.renewed += 1;
    } else if ((pendingByMember.get(m.whopMembershipId) ?? 0) > 0) {
      // Tentative en cours : l'issue n'est PAS connue, on ne tranche pas.
      due.pending += 1;
    } else if (m.accessEndsAt !== undefined && m.accessEndsAt <= opts.now) {
      due.failed += 1;
    } else {
      due.notYetDue += 1;
    }
  }

  const resolvedDueCount = due.renewed + due.failed;
  const renewalRateResolved =
    resolvedDueCount > 0
      ? Math.round((due.renewed / resolvedDueCount) * 10000) / 10000
      : null;
  const worstDenom = resolvedDueCount + due.pending;
  const renewalRateWorstCase =
    worstDenom > 0 ? Math.round((due.renewed / worstDenom) * 10000) / 10000 : null;

  const dist = new Map<number, number>();
  for (const n of cyclesByMember.values()) dist.set(n, (dist.get(n) ?? 0) + 1);
  const cycleDistribution = [...dist.entries()]
    .map(([cycles, members]) => ({ cycles, members }))
    .sort((a, b) => a.cycles - b.cycles);

  const payingMembers = cyclesByMember.size;
  const averageCycles =
    payingMembers > 0 ? Math.round((paidPayments / payingMembers) * 100) / 100 : null;
  const netPerPayment = paidPayments > 0 ? round2(netTotal / paidPayments) : null;

  /** Cycles espérés depuis un taux : 1/(1−t). null si t ≥ 1 (divergence). */
  const projectFrom = (rate: number | null): number | null => {
    if (rate === null || rate >= 1 || netPerPayment === null) return null;
    return round2(netPerPayment * (1 / (1 - rate)));
  };

  // ─── Cohortes par semaine d'ACQUISITION (1er paiement encaissé) ────────────
  const cohortAcc = new Map<string, { clients: number; cycles: number; net: number }>();
  for (const [id, first] of firstPaidByMember) {
    const week = opts.weekKeyOf(first);
    const a = cohortAcc.get(week) ?? { clients: 0, cycles: 0, net: 0 };
    a.clients += 1;
    a.cycles += cyclesByMember.get(id) ?? 0;
    a.net = round2(a.net + (netByMember.get(id) ?? 0));
    cohortAcc.set(week, a);
  }
  const cohorts: CohortWeek[] = [...cohortAcc.entries()]
    .map(([week, a]) => ({
      week,
      clients: a.clients,
      cycles: a.cycles,
      net: a.net,
      netPerClient: a.clients > 0 ? round2(a.net / a.clients) : 0,
    }))
    .sort((x, y) => x.week.localeCompare(y.week));

  const matured = due.renewed + due.failed + due.pending;
  return {
    due,
    renewalRateResolved,
    renewalRateWorstCase,
    resolvedDueCount,
    averageCycles,
    cycleDistribution,
    netPerPayment,
    netTotal,
    revenueToDatePerClient:
      payingMembers > 0 ? round2(netTotal / payingMembers) : null,
    projectedPerClientResolved: projectFrom(renewalRateResolved),
    projectedPerClientWorstCase: projectFrom(renewalRateWorstCase),
    cohorts,
    matureShare:
      payingMembers > 0 ? Math.round((matured / payingMembers) * 10000) / 10000 : null,
    payingMembers,
    pendingRenewalAmount,
  };
}
