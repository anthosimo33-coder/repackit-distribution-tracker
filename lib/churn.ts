/**
 * CHURN — logique PURE (testée Vitest, aucune dép Convex/React).
 *
 * Deux états à ne PAS confondre (le point central) :
 *  - RÉSILIÉ : la personne a annulé mais garde l'accès jusqu'à la fin de la période
 *    payée. Elle peut encore changer d'avis.
 *  - EXPIRÉ : la période est terminée, l'accès est perdu. C'est le VRAI churn.
 *
 * Source qui fait foi = l'état des memberships Whop (whopMemberships), croisé avec
 * les paiements (première date, nombre) pour les délais et le renouvellement.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;

export type ChurnState = "active" | "resiliated" | "expired" | "unknown";

export interface MembershipInput {
  membershipId: string;
  planId: string | null;
  status: string;
  valid: boolean | null;
  /** Fin d'accès / de la période courante (ms). */
  accessEndsAt: number | null;
  /** Annulation par l'utilisateur (ms). null = pas d'annulation connue. */
  canceledAt: number | null;
  /** Premier paiement encaissé (ms) — depuis whopPayments. null si aucun. */
  firstPaidAt: number | null;
  /** Nb de paiements encaissés (≥ 2 = a renouvelé au moins une fois). */
  paidCount: number;
  /** Cadence de l'offre en jours (7 / 30…) si connue — base de « arrivé à échéance ». */
  intervalDays: number | null;
}

export interface ChurnParams {
  now: number;
  /** Début de la fenêtre « sur la période ». */
  periodStartMs: number;
  /**
   * Réparation du webhook (ms). Un paiement AVANT cette date n'accordait pas
   * l'accès automatiquement : `paidDuringOutage` le signale au niveau de chaque
   * résiliation. Ce n'est qu'un PROXY (la vérif d'accès applicatif par personne
   * n'est pas ingérée) ; le délai paiement→annulation est le fait le plus parlant.
   */
  webhookFixMs: number;
  /** Horizon (ms) pour « perdront l'accès prochainement » (ex. 7 jours). */
  horizonMs: number;
  /** Sous ce nombre d'abonnements arrivés à échéance, aucun taux n'est interprétable. */
  sampleThreshold: number;
}

export interface ChurnByPlan {
  planId: string;
  clients: number;
  resiliations: number;
  expirations: number;
}

/** Détail d'une résiliation — le délai raconte l'histoire (3 min ≠ 5 jours). */
export interface ResiliationDetail {
  membershipId: string;
  planId: string;
  firstPaidAt: number | null;
  canceledAt: number;
  /** Délai premier paiement → annulation (ms). null si paiement inconnu. */
  delayMs: number | null;
  accessEndsAt: number | null;
  /** Payé pendant la panne du webhook (accès non provisionné auto) — PROXY, pas une vérif d'accès. */
  paidDuringOutage: boolean;
}

/** Un client qui perdra l'accès bientôt (résilié, période bientôt finie). */
export interface UpcomingExpiration {
  membershipId: string;
  planId: string;
  accessEndsAt: number;
}

export interface ChurnResult {
  /** Clients payants (dénominateur des taux). */
  clients: number;
  /** Annulations sur la période (accès pas forcément encore perdu). */
  resiliations: number;
  /** Expirations sur la période (accès perdu = vrai churn). */
  expirations: number;
  /** resiliations / clients, en %. null si aucun client. */
  cancelRate: number | null;
  /** Délai premier paiement → annulation (MS), médiane et 9 sur 10. L'UI formate min/h/j. */
  medMsToCancel: number | null;
  p90MsToCancel: number | null;
  /** Détail par résiliation (trié par délai croissant : les quasi-immédiates d'abord). */
  resiliationDetails: ResiliationDetail[];
  /** Résiliés dont l'accès expire dans l'horizon (perte à venir, encore récupérables). */
  upcomingExpirations: UpcomingExpiration[];
  /** Clients payants projetés après ces expirations = clients − upcomingExpirations. */
  projectedClients: number;
  /** Abonnements ARRIVÉS À ÉCHÉANCE (une période complète écoulée). */
  reachedTerm: number;
  /** Parmi eux, ceux qui ont renouvelé (≥ 2 paiements). */
  renewed: number;
  /** renewed / reachedTerm, en %. null si aucun arrivé à échéance. */
  renewalRate: number | null;
  /** Nombre moyen de renouvellements (paiements au-delà du premier) chez les arrivés à échéance. */
  avgRenewals: number | null;
  byPlan: ChurnByPlan[];
  /** reachedTerm ≥ seuil : les taux de renouvellement sont interprétables. */
  sampleSufficient: boolean;
}

/** État de churn d'un membership à l'instant `now`. */
export function classifyMembership(m: MembershipInput, now: number): ChurnState {
  const accessLost =
    m.valid === false ||
    m.status === "expired" ||
    m.status === "completed" ||
    (m.accessEndsAt !== null && m.accessEndsAt < now);
  if (accessLost) return "expired";
  const canceled =
    m.canceledAt !== null || m.status === "canceled" || m.status === "cancelled";
  if (canceled) return "resiliated";
  const active =
    m.valid === true ||
    m.status === "active" ||
    m.status === "trialing" ||
    (m.accessEndsAt !== null && m.accessEndsAt >= now);
  return active ? "active" : "unknown";
}

/** Quantile (nearest-rank) d'une liste ; null si vide. */
function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** Un membership arrivé à échéance a laissé passer AU MOINS une période complète. */
function hasReachedTerm(m: MembershipInput, now: number): boolean {
  return (
    m.firstPaidAt !== null &&
    m.intervalDays !== null &&
    m.intervalDays > 0 &&
    now - m.firstPaidAt >= m.intervalDays * DAY_MS
  );
}

/**
 * Métriques de churn. Ne compte que les memberships PAYANTS (au moins un paiement
 * encaissé). Les résiliations dues à la panne du webhook sont comptées à part
 * (`bugAttributed`) SANS être retirées, pour ne pas polluer la lecture.
 */
export function computeChurn(
  memberships: MembershipInput[],
  params: ChurnParams,
): ChurnResult {
  const { now, periodStartMs, webhookFixMs, horizonMs, sampleThreshold } = params;
  const paying = memberships.filter((m) => m.paidCount > 0);
  const clients = paying.length;

  let resiliations = 0;
  let expirations = 0;
  const msToCancel: number[] = [];
  const resiliationDetails: ResiliationDetail[] = [];
  const upcomingExpirations: UpcomingExpiration[] = [];
  const byPlan = new Map<string, ChurnByPlan>();
  const planOf = (m: MembershipInput) => m.planId ?? "(sans offre)";
  const bumpPlan = (m: MembershipInput, key: keyof Omit<ChurnByPlan, "planId">) => {
    const p = byPlan.get(planOf(m)) ?? {
      planId: planOf(m),
      clients: 0,
      resiliations: 0,
      expirations: 0,
    };
    p[key] += 1;
    byPlan.set(planOf(m), p);
  };

  for (const m of paying) {
    bumpPlan(m, "clients");
    const state = classifyMembership(m, now);
    const canceledInPeriod =
      m.canceledAt !== null &&
      m.canceledAt >= periodStartMs &&
      m.canceledAt <= now;
    if (canceledInPeriod && m.canceledAt !== null) {
      resiliations += 1;
      bumpPlan(m, "resiliations");
      const delayMs =
        m.firstPaidAt !== null && m.canceledAt >= m.firstPaidAt
          ? m.canceledAt - m.firstPaidAt
          : null;
      if (delayMs !== null) msToCancel.push(delayMs);
      resiliationDetails.push({
        membershipId: m.membershipId,
        planId: planOf(m),
        firstPaidAt: m.firstPaidAt,
        canceledAt: m.canceledAt,
        delayMs,
        accessEndsAt: m.accessEndsAt,
        paidDuringOutage: m.firstPaidAt !== null && m.firstPaidAt < webhookFixMs,
      });
    }
    const expiredInPeriod =
      state === "expired" &&
      m.accessEndsAt !== null &&
      m.accessEndsAt >= periodStartMs &&
      m.accessEndsAt <= now;
    if (expiredInPeriod) {
      expirations += 1;
      bumpPlan(m, "expirations");
    }
    // Perte À VENIR : résilié (accès encore valide) dont la période finit dans l'horizon.
    if (
      state === "resiliated" &&
      m.accessEndsAt !== null &&
      m.accessEndsAt >= now &&
      m.accessEndsAt <= now + horizonMs
    ) {
      upcomingExpirations.push({
        membershipId: m.membershipId,
        planId: planOf(m),
        accessEndsAt: m.accessEndsAt,
      });
    }
  }

  const reachedTermList = paying.filter((m) => hasReachedTerm(m, now));
  const reachedTerm = reachedTermList.length;
  const renewed = reachedTermList.filter((m) => m.paidCount >= 2).length;
  const totalRenewals = reachedTermList.reduce(
    (s, m) => s + Math.max(0, m.paidCount - 1),
    0,
  );

  msToCancel.sort((a, b) => a - b);
  resiliationDetails.sort(
    (a, b) => (a.delayMs ?? Infinity) - (b.delayMs ?? Infinity),
  );
  upcomingExpirations.sort((a, b) => a.accessEndsAt - b.accessEndsAt);

  return {
    clients,
    resiliations,
    expirations,
    cancelRate: clients > 0 ? round1((resiliations / clients) * 100) : null,
    medMsToCancel: quantile(msToCancel, 0.5),
    p90MsToCancel: quantile(msToCancel, 0.9),
    resiliationDetails,
    upcomingExpirations,
    projectedClients: Math.max(0, clients - upcomingExpirations.length),
    reachedTerm,
    renewed,
    renewalRate: reachedTerm > 0 ? round1((renewed / reachedTerm) * 100) : null,
    avgRenewals: reachedTerm > 0 ? Math.round((totalRenewals / reachedTerm) * 100) / 100 : null,
    byPlan: [...byPlan.values()].sort((a, b) => b.clients - a.clients),
    sampleSufficient: reachedTerm >= sampleThreshold,
  };
}

/** Cadence d'une offre (libellé Whop) en JOURS. null si inconnue. */
export function intervalToDays(interval: string | null | undefined): number | null {
  switch ((interval ?? "").trim().toLowerCase()) {
    case "jour":
      return 1;
    case "semaine":
      return 7;
    case "mois":
      return 30;
    case "trimestre":
      return 91;
    case "an":
    case "année":
      return 365;
    default:
      return null;
  }
}
