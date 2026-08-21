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

/**
 * Devises réellement ENCAISSÉES dans un lot (cf lib/whop-revenue — DOIT rester
 * identique). Sert de garde A5 aux agrégats qui accumulent whopNetContribution
 * sans passer par summarizeWhopRevenue : au-delà d'une devise, leurs sommes ne
 * sont pas additionnables. Les paiements non sécurisés valent 0 et ne comptent
 * donc pas — ce sont les mêmes lignes qui alimentent réellement les totaux.
 */
export function securedCurrenciesOf(
  payments: ReadonlyArray<{ status: WhopStatus; currency?: string }>,
): string[] {
  const set = new Set<string>();
  for (const p of payments) {
    if (!isSecuredRevenue(p.status)) continue;
    set.add(p.currency && p.currency !== "" ? p.currency : "(inconnue)");
  }
  return [...set].sort();
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
  /**
   * Devises PRÉSENTES dans le lot, quel que soit le statut — échec, remboursement
   * et litige compris. `currencies` ne retient que les devises ENCAISSÉES
   * (paymentCount > 0, donc status "paid") : une devise qui n'apparaît qu'en
   * échec ou en remboursement y est INVISIBLE. C'est ce qui rendait la garde A5
   * aveugle exactement aux lignes qui traversent `refunded`/`disputed`.
   */
  currenciesPresent: string[];
  /**
   * true = plusieurs devises présentes en base, même si une seule est encaissée.
   * NE zéroïse RIEN (sinon un simple paiement en échec dans une 2ᵉ devise
   * effacerait un revenu parfaitement calculable) : c'est un signal à afficher,
   * et la condition qui restreint `refunded`/`disputed` à la devise de `currency`.
   */
  mixedCurrencyPresent: boolean;
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
  // Devises PRÉSENTES : tout bucket créé, donc tout statut. Distinct de
  // `currencies` (encaissées seulement) — cf WhopRevenueSummary.
  const currenciesPresent = byCurrency.map((c) => c.currency).sort();
  const mixedCurrencyPresent = currenciesPresent.length > 1;
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
      currenciesPresent,
      mixedCurrencyPresent,
      byCurrency,
    };
  }

  const one = collected[0] ?? null;
  // GARDE A5 sur les remboursements et les litiges. Ces deux montants étaient
  // sommés sur TOUS les buckets de devise, alors que ni un remboursement ni un
  // litige n'incrémente paymentCount : une 2ᵉ devise présente UNIQUEMENT en
  // remboursement ou en litige passait donc la garde `mixedCurrency` (qui ne
  // voit que l'encaissé) et se retrouvait additionnée en silence, affichée avec
  // le symbole de l'autre devise et le contrôle de fiabilité au vert.
  //
  // Quand plusieurs devises sont présentes et qu'une seule est encaissée, on ne
  // retient QUE le bucket de cette devise — le reste est signalé par
  // mixedCurrencyPresent, jamais fondu dans le total. Devise unique ⇒ somme
  // inchangée. Aucune devise encaissée (mois entièrement remboursé, par ex.) ⇒
  // on somme toujours, sinon on masquerait un remboursement bien réel.
  const refundScope =
    mixedCurrencyPresent && one !== null
      ? byCurrency.filter((c) => c.currency === one.currency)
      : byCurrency;
  const refunded = round2(refundScope.reduce((s, c) => s + c.refunded, 0));
  const disputed = round2(refundScope.reduce((s, c) => s + c.disputed, 0));
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
    currenciesPresent,
    mixedCurrencyPresent,
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
  /** Cause de l'échec fournie par Whop (`failure_message`). */
  failureMessage?: string;
  /** Whop relancera-t-il ? false = échec DÉFINITIF, true = encore en jeu. */
  retryable?: boolean;
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
  /** Devises encaissées du lot. Au-delà d'une, les montants sont NON sommables. */
  securedCurrencies: string[];
  /** true ⇒ montants zéroïsés (garde A5) ; les COMPTES restent justes. */
  mixedCurrency: boolean;
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

  // GARDE A5 — cette fonction accumule whopNetContribution sans passer par
  // summarizeWhopRevenue : au-delà d'une devise encaissée, ses montants ne sont
  // pas additionnables. On zéroïse les MONTANTS et on garde les COMPTES (mêmes
  // conventions que summarizeWhopRevenue : un compte est sans dimension).
  const securedCurrencies = securedCurrenciesOf(payments);
  const mixedCurrency = securedCurrencies.length > 1;
  if (mixedCurrency) {
    for (const d of days) {
      d.newNet = 0;
      d.renewalNet = 0;
      d.unknownNet = 0;
      d.cumulativeNewNet = 0;
      d.cumulativeRenewalNet = 0;
    }
    return {
      days,
      newNet: 0,
      renewalNet: 0,
      unknownNet: 0,
      newCount: totals.newCount,
      renewalCount: totals.renewalCount,
      unknownCount: totals.unknownCount,
      renewalShare: null,
      unknownPayments: totals.unknownCount,
      securedCurrencies,
      mixedCurrency,
    };
  }

  const classified = round2(totals.newNet + totals.renewalNet);
  return {
    days,
    ...totals,
    renewalShare: classified > 0 ? Math.round((totals.renewalNet / classified) * 10000) / 10000 : null,
    unknownPayments: totals.unknownCount,
    securedCurrencies,
    mixedCurrency,
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
  // GARDE A5 — même famille que splitRevenueByOrigin : accumulation directe de
  // whopNetContribution, sans clé de devise. Au-delà d'une devise encaissée, le
  // net par offre n'est pas sommable → montants à 0, comptes conservés.
  const mixedCurrency = securedCurrenciesOf(payments).length > 1;
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
    .map(([planId, a]) => ({
      planId,
      renewalCount: a.n,
      renewalNet: mixedCurrency ? 0 : a.net,
      members: a.mem.size,
    }))
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

/**
 * Issues de renouvellement pour UNE offre. Deux offres au même taux global
 * peuvent cacher des comportements opposés : si la petite renouvelle deux fois
 * moins bien que la grande, c'est une décision de PRICING, indépendante de
 * tout test A/B.
 */
export interface RenewalsByPlanOutcome {
  planId: string;
  /** Abonnements de cette offre ayant renouvelé au moins une fois. */
  renewed: number;
  /** Échéances en cours de relance (issue inconnue). */
  pending: number;
  /** Échecs DÉFINITIFS (relances épuisées, ou accès expiré sans relance). */
  failed: number;
  /** renewed / (renewed + failed). null si aucune échéance tranchée. */
  rateResolved: number | null;
  /** Borne basse : renewed / (renewed + failed + pending). */
  rateWorstCase: number | null;
  /** Cause d'échec la PLUS FRÉQUENTE, telle que Whop la formule. null si aucune. */
  topFailureCause: string | null;
  /** Montant brut en suspens sur cette offre. */
  pendingAmount: number;
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
  /**
   * Cycles COMPTÉS mais ne rapportant RIEN au net : litige en cours ou
   * remboursement. Sans ce champ, une cohorte affiche « 2 cycles, 4,48 € » et
   * la soustraction paraît fausse alors qu'elle est juste — l'argent d'un
   * litige est à risque, pas encaissé.
   */
  cyclesWithoutNet: number;
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
   * 1 — REVENU À CE JOUR PAR CLIENT = net total / clients AU NET SÉCURISÉ.
   * Du RÉEL : aucune projection, aucune hypothèse.
   *
   * ⚠️ Le dénominateur est `securedMembers`, PAS `payingMembers` : le numérateur
   * exclut les litiges en cours (argent à risque), donc le dénominateur doit les
   * exclure aussi. Compter au dénominateur une personne dont l'argent ne compte
   * pas au numérateur tire la moyenne vers le bas sans que rien ne le dise —
   * mesuré en prod : 6,52 € au lieu de 6,92 €, soit 6 % de sous-estimation.
   */
  revenueToDatePerClient: number | null;
  /** Clients dont AU MOINS un paiement contribue au net sécurisé (dénominateur). */
  securedMembers: number;
  /**
   * Clients dont TOUT l'argent est en litige : comptés nulle part dans le ratio,
   * affichés à part. Les taire ferait disparaître des clients réels de l'écran.
   */
  atRiskOnlyMembers: number;
  /**
   * Devises DISTINCTES parmi les paiements sécurisés. > 1 = les montants ne sont
   * PAS additionnables (règle A5) et tout ratio est faux : l'UI doit refuser de
   * diviser plutôt que de rendre une somme de devises mélangées.
   */
  securedCurrencies: string[];
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
  /** Issues de renouvellement PAR OFFRE — révèle un problème de pricing. */
  byPlanOutcome: RenewalsByPlanOutcome[];
  /** Causes d'échec de renouvellement, les plus fréquentes d'abord. */
  failureCauses: { cause: string; count: number }[];
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
  /** Abonnements ayant au moins un paiement contribuant RÉELLEMENT au net. */
  const securedByMember = new Set<string>();
  const securedCurrencySet = new Set<string>();
  const firstPaidByMember = new Map<string, number>();
  /** Abonnements ayant une tentative de renouvellement NON encaissée en cours. */
  const pendingByMember = new Map<string, number>();
  /** Échecs DÉFINITIFS de renouvellement (Whop ne relancera plus). */
  const deadByMember = new Map<string, number>();
  /** Cycles encaissés ne rapportant RIEN au net (litige en cours, remboursement). */
  const zeroNetByMember = new Map<string, number>();
  /** Offre de l'abonnement, prise sur ses paiements. */
  const planByMember = new Map<string, string>();
  const pendingAmountByPlan = new Map<string, number>();
  const causeCounts = new Map<string, number>();
  const causeByPlan = new Map<string, Map<string, number>>();
  let pendingRenewalAmount = 0;
  let paidPayments = 0;
  let netTotal = 0;

  for (const p of payments) {
    if (p.membershipId && p.planId) planByMember.set(p.membershipId, p.planId);
    const isRenewal = whopBillingOrigin(p.billingReason) === "renewal";
    if (isRenewal && (p.status === "failed" || p.status === "pending")) {
      // `retryable === false` = relances épuisées → échec DÉFINITIF, pas une
      // attente. Sans cette distinction, un abandon confirmé resterait
      // éternellement « en cours » et n'entrerait jamais dans le taux.
      const dead = p.retryable === false;
      if (p.membershipId) {
        const m = dead ? deadByMember : pendingByMember;
        m.set(p.membershipId, (m.get(p.membershipId) ?? 0) + 1);
      }
      if (!dead) {
        pendingRenewalAmount = round2(pendingRenewalAmount + finite(p.grossAmount));
        if (p.planId) {
          pendingAmountByPlan.set(
            p.planId,
            round2((pendingAmountByPlan.get(p.planId) ?? 0) + finite(p.grossAmount)),
          );
        }
      }
      const cause = (p.failureMessage ?? "").trim();
      if (cause !== "") {
        causeCounts.set(cause, (causeCounts.get(cause) ?? 0) + 1);
        if (p.planId) {
          const m = causeByPlan.get(p.planId) ?? new Map<string, number>();
          m.set(cause, (m.get(cause) ?? 0) + 1);
          causeByPlan.set(p.planId, m);
        }
      }
    }
    if (!isCustomerPaid(p.status)) continue;
    paidPayments += 1;
    const net = whopNetContribution(p);
    netTotal = round2(netTotal + net);
    const id = p.membershipId;
    if (!id) continue;
    cyclesByMember.set(id, (cyclesByMember.get(id) ?? 0) + 1);
    if (net > 0) {
      securedByMember.add(id);
      securedCurrencySet.add(
        p.currency && p.currency !== "" ? p.currency : "(inconnue)",
      );
    }
    // Litige en cours : le client a payé (donc un cycle) mais l'argent est à
    // risque et vaut 0 au net. C'est ce décalage qui rend une cohorte illisible
    // si on ne l'affiche pas.
    if (net <= 0) zeroNetByMember.set(id, (zeroNetByMember.get(id) ?? 0) + 1);
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
    } else if ((deadByMember.get(m.whopMembershipId) ?? 0) > 0) {
      due.failed += 1; // relances épuisées : l'échéance est tranchée
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
  const cohortAcc = new Map<
    string,
    { clients: number; cycles: number; net: number; zero: number }
  >();
  for (const [id, first] of firstPaidByMember) {
    const week = opts.weekKeyOf(first);
    const a = cohortAcc.get(week) ?? { clients: 0, cycles: 0, net: 0, zero: 0 };
    a.clients += 1;
    a.cycles += cyclesByMember.get(id) ?? 0;
    a.zero += zeroNetByMember.get(id) ?? 0;
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
      cyclesWithoutNet: a.zero,
    }))
    .sort((x, y) => x.week.localeCompare(y.week));

  // ─── Issues PAR OFFRE : deux offres au même taux global peuvent diverger ──
  const planAcc = new Map<string, { renewed: number; pending: number; failed: number }>();
  for (const m of memberships) {
    const cycles = cyclesByMember.get(m.whopMembershipId) ?? 0;
    if (cycles === 0) continue;
    const planId = m.planId ?? planByMember.get(m.whopMembershipId);
    if (!planId) continue;
    const a = planAcc.get(planId) ?? { renewed: 0, pending: 0, failed: 0 };
    if (cycles >= 2) a.renewed += 1;
    else if ((deadByMember.get(m.whopMembershipId) ?? 0) > 0) a.failed += 1;
    else if ((pendingByMember.get(m.whopMembershipId) ?? 0) > 0) a.pending += 1;
    else if (m.accessEndsAt !== undefined && m.accessEndsAt <= opts.now) a.failed += 1;
    else continue; // pas encore due : hors taux
    planAcc.set(planId, a);
  }
  const topCause = (m: Map<string, number> | undefined): string | null => {
    if (!m || m.size === 0) return null;
    return [...m.entries()].sort((x, y) => y[1] - x[1])[0][0];
  };
  const byPlanOutcome: RenewalsByPlanOutcome[] = [...planAcc.entries()]
    .map(([planId, a]) => {
      const resolved = a.renewed + a.failed;
      const worst = resolved + a.pending;
      return {
        planId,
        renewed: a.renewed,
        pending: a.pending,
        failed: a.failed,
        rateResolved:
          resolved > 0 ? Math.round((a.renewed / resolved) * 10000) / 10000 : null,
        rateWorstCase:
          worst > 0 ? Math.round((a.renewed / worst) * 10000) / 10000 : null,
        topFailureCause: topCause(causeByPlan.get(planId)),
        pendingAmount: pendingAmountByPlan.get(planId) ?? 0,
      };
    })
    .sort((x, y) => y.renewed + y.pending + y.failed - (x.renewed + x.pending + x.failed));
  const failureCauses = [...causeCounts.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count);

  const matured = due.renewed + due.failed + due.pending;
  // GARDE A5 — `securedCurrencySet` existait déjà mais ne conditionnait QU'UN
  // champ sur douze (revenueToDatePerClient) : tous les autres montants étaient
  // sommés toutes devises confondues, y compris pendingRenewalAmount qui cumule
  // du grossAmount BRUT. On étend la garde à TOUT montant. Les taux, comptes et
  // distributions restent justes : ce sont des grandeurs sans dimension.
  const mixedCurrency = securedCurrencySet.size > 1;
  const money = (n: number) => (mixedCurrency ? 0 : n);
  return {
    due,
    renewalRateResolved,
    renewalRateWorstCase,
    resolvedDueCount,
    averageCycles,
    cycleDistribution,
    netPerPayment: mixedCurrency ? null : netPerPayment,
    netTotal: money(netTotal),
    revenueToDatePerClient:
      securedByMember.size > 0 && !mixedCurrency
        ? round2(netTotal / securedByMember.size)
        : null,
    securedMembers: securedByMember.size,
    atRiskOnlyMembers: payingMembers - securedByMember.size,
    securedCurrencies: [...securedCurrencySet].sort(),
    projectedPerClientResolved: mixedCurrency
      ? null
      : projectFrom(renewalRateResolved),
    projectedPerClientWorstCase: mixedCurrency
      ? null
      : projectFrom(renewalRateWorstCase),
    cohorts: mixedCurrency
      ? cohorts.map((c) => ({ ...c, net: 0, netPerClient: 0 }))
      : cohorts,
    matureShare:
      payingMembers > 0 ? Math.round((matured / payingMembers) * 10000) / 10000 : null,
    payingMembers,
    pendingRenewalAmount: money(pendingRenewalAmount),
    byPlanOutcome: mixedCurrency
      ? byPlanOutcome.map((p) => ({ ...p, pendingAmount: 0 }))
      : byPlanOutcome,
    failureCauses,
  };
}
