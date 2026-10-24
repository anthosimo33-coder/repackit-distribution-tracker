/**
 * REVENU PROJETÉ PAR ASSIGNÉ du test A/B — à J28 et J42, à côté de « Net par
 * assigné ». Logique PURE (testée Vitest depuis lib/ab-projection.test.ts).
 *
 * ⚠️ POURQUOI UNE SECONDE LECTURE. « Net par assigné » compte l'argent ENCAISSÉ
 * À DATE. Une offre ponctuelle (Pass 7 jours, 12,99 €) encaisse tout le jour de
 * l'achat ; un abonnement hebdomadaire encaisse ses renouvellements semaine
 * après semaine. Pendant ~4 semaines, l'encaissé à date favorise donc l'offre
 * one-shot quelle que soit la valeur réelle des deux — c'est ce qui faisait
 * lire le pass devant sur la carte alors que l'hebdo passe devant dès ~J28
 * (deep-dive du 24/10/2026, test `paywall_pass_2026_10`).
 *
 * La projection compare les deux bras à la MÊME échéance :
 *
 *   revenu projeté par assigné à Jk = conversion du bras (nouveaux clients ÷
 *   assignés) × net cumulé moyen PAR ABONNEMENT de son offre à Jk
 *
 * La courbe vient de Whop (paiements × abonnements), sur les seuls abonnements
 * ASSEZ ÂGÉS pour avoir vécu leur jour k. L'offre d'un bras = les plans Whop de
 * la famille que ce bras vend (table apprise des personnes stables, cf
 * `AbPlanFamily`) — pas les plans achetés par ses clients : le bras pass a vendu
 * deux hebdos par la grille en dollars, et les hebdos d'une année entière
 * auraient noyé la courbe de ses 130 pass.
 *
 * Rien n'est projeté sous `PROJECTION_MIN_SUBSCRIPTIONS` abonnements, et le
 * nombre d'abonnements derrière chaque point (n) sort TOUJOURS avec lui : une
 * moyenne de trois abonnements se lirait comme une courbe.
 *
 * Référence prod au 24/10/2026, bras hard (paywall_ab_2026_08_v2), tous plans :
 * J7 13,21 · J14 15,46 · J28 18,64 · J42 21,93 € (n = 244).
 */
import {
  isInternalWhopMembership,
  type InternalAccountsConfig,
} from "./internalAccounts";
import { planFamilyOf, type AbPlanFamily } from "./abAttribution";
import {
  whopNetContribution,
  whopNetInSummaryCurrency,
  type WhopPaymentLike,
  type WhopRevenueSummary,
  type WhopStatus,
} from "./whopRevenue";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Échéances de la courbe. La carte en projette deux ; les autres situent la courbe. */
export const PROJECTION_DAYS = [7, 14, 28, 42] as const;
/** Les deux échéances projetées « à côté » du net par assigné. */
export const PROJECTION_HEADLINE_DAYS = [28, 42] as const;
/** Sous ce nombre d'abonnements assez âgés, un point n'est PAS projeté. */
export const PROJECTION_MIN_SUBSCRIPTIONS = 10;

/**
 * Un abonnement a « commencé » dès qu'un paiement a été ENCAISSÉ au moins une
 * fois — même remboursé ou contesté depuis : c'est un client que la conversion
 * compte, son net à 0 doit peser dans la moyenne. Un abonnement sans aucun
 * encaissement (checkout abandonné, 476 « drafted » en prod au 24/10) n'en est
 * pas un : il diviserait la courbe par des gens qui n'ont jamais payé.
 */
const STARTED: ReadonlySet<WhopStatus> = new Set(["paid", "disputed", "refunded"]);

export interface ProjectionPaymentLike extends WhopPaymentLike {
  membershipId?: string;
  paidAt: number;
}

export interface ProjectionMembershipLike {
  whopMembershipId: string;
  planId?: string;
  abForced?: boolean;
}

/** Un point de la courbe d'UN plan : SOMME (pas moyenne) et effectif. */
export interface PlanCurvePoint {
  day: number;
  /** Abonnements à ce plan ayant vécu tout leur jour `day`. */
  n: number;
  /**
   * Net cumulé de ces `n` abonnements à la fin de leur jour `day`, dans la
   * devise du référentiel. Une SOMME : c'est ce qui permet d'additionner des
   * plans (EUR, USD) avant de diviser. `null` = devises non convertibles (A5).
   */
  net: number | null;
}

export interface PlanNetCurve {
  planId: string;
  points: PlanCurvePoint[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Courbe de net cumulé PAR PLAN Whop, sur TOUS les abonnements du projet
 * (internes et sessions forcées exclus), quels que soient leur bras et leur
 * expérience : c'est une propriété de l'OFFRE, pas du test.
 *
 * Jour 0 = jour du premier encaissement. « À Jk » = tout ce qui est encaissé
 * avant la fin du jour k, renouvellement du jour k compris (un hebdo se
 * renouvelle À J7 : l'exclure ferait de J7 le net d'un seul cycle). Un
 * abonnement n'entre au point k qu'une fois ce jour k RÉVOLU — sinon un
 * renouvellement pas encore échu se lirait comme un désabonnement.
 *
 * `ref` = le référentiel de change du résumé de Revenus (le même que
 * `abRevenueOf`) : un dollar et un dinar y sont ramenés au même taux.
 */
export function planNetCurves(input: {
  payments: readonly ProjectionPaymentLike[];
  memberships: readonly ProjectionMembershipLike[];
  nowMs: number;
  internalCfg: InternalAccountsConfig;
  ref: Pick<WhopRevenueSummary, "conversions" | "mixedCurrency">;
  days?: readonly number[];
}): PlanNetCurve[] {
  const days = input.days ?? PROJECTION_DAYS;
  const byMembership = new Map<string, ProjectionPaymentLike[]>();
  for (const p of input.payments) {
    if (!p.membershipId) continue;
    const list = byMembership.get(p.membershipId);
    if (list) list.push(p);
    else byMembership.set(p.membershipId, [p]);
  }
  const mixed = input.ref.mixedCurrency;
  const acc = new Map<string, { n: number; net: number | null }[]>();
  for (const m of input.memberships) {
    if (!m.planId) continue;
    if (m.abForced === true) continue;
    if (isInternalWhopMembership(m.whopMembershipId, input.internalCfg)) continue;
    const pays = byMembership.get(m.whopMembershipId) ?? [];
    let t0: number | null = null;
    for (const p of pays) {
      if (STARTED.has(p.status) && (t0 === null || p.paidAt < t0)) t0 = p.paidAt;
    }
    if (t0 === null) continue; // jamais encaissé : pas un abonnement
    const points =
      acc.get(m.planId) ?? days.map(() => ({ n: 0, net: 0 as number | null }));
    days.forEach((k, i) => {
      const endOfDayK = t0! + (k + 1) * DAY_MS;
      if (input.nowMs < endOfDayK) return; // jour k pas encore révolu
      let net: number | null = 0;
      for (const p of pays) {
        if (p.paidAt >= endOfDayK || whopNetContribution(p) <= 0) continue;
        net = mixed || net === null ? null : net + whopNetInSummaryCurrency(p, input.ref);
      }
      points[i].n += 1;
      points[i].net =
        points[i].net === null || net === null ? null : round2(points[i].net! + net);
    });
    acc.set(m.planId, points);
  }
  return [...acc.entries()]
    .map(([planId, points]) => ({
      planId,
      points: points.map((p, i) => ({ day: days[i], n: p.n, net: p.net })),
    }))
    .sort((a, b) => a.planId.localeCompare(b.planId));
}

/** Un point de la projection d'un bras. */
export interface ArmProjectionPoint {
  day: number;
  /** Abonnements de l'offre derrière ce point — À AFFICHER avec la valeur. */
  n: number;
  /** Net cumulé moyen par abonnement de l'offre ; `null` sous le seuil ou non additionnable. */
  netPerSubscription: number | null;
  /** Conversion × net par abonnement (4 décimales) ; `null` dès que l'un des deux manque. */
  perAssigned: number | null;
}

export interface ArmProjection {
  variant: string;
  /** Familles de plan vendues par ce bras (table apprise). Vide = offre inconnue. */
  families: string[];
  /** Plans Whop retenus pour la courbe de l'offre. */
  planIds: string[];
  /** Nouveaux clients ÷ assignés (ratio, pas %). `null` sans assigné. */
  conversion: number | null;
  points: ArmProjectionPoint[];
}

/**
 * Projection par bras. `purchases` sert UNIQUEMENT à connaître les plans Whop
 * de chaque famille (le slug PostHog `snytch_trio_weekly` ↔ `plan_…`), tous bras
 * confondus ; c'est `planFamilies` qui dit quelle famille appartient à quel bras.
 * Un plan d'une famille jamais vu acheté pendant le test n'est pas connu par son
 * slug : il sort de la courbe (limite assumée, plutôt que deviner sa famille par
 * son nom affiché).
 */
export function armProjections(input: {
  arms: readonly { variant: string; exposed: number; paid: number }[];
  purchases: readonly { plan: string; whopPlanId: string }[];
  planFamilies: readonly Pick<AbPlanFamily, "family" | "variant">[];
  curves: readonly PlanNetCurve[];
  days?: readonly number[];
  minSubscriptions?: number;
}): ArmProjection[] {
  const days = input.days ?? PROJECTION_DAYS;
  const min = input.minSubscriptions ?? PROJECTION_MIN_SUBSCRIPTIONS;
  const curveOf = new Map(input.curves.map((c) => [c.planId, c] as const));
  return input.arms.map((arm) => {
    const families = [
      ...new Set(
        input.planFamilies.filter((f) => f.variant === arm.variant).map((f) => f.family),
      ),
    ].sort();
    const planIds = [
      ...new Set(
        input.purchases
          .filter((p) => p.whopPlanId !== "" && families.includes(planFamilyOf(p.plan)))
          .map((p) => p.whopPlanId),
      ),
    ].sort();
    const conversion = arm.exposed > 0 ? arm.paid / arm.exposed : null;
    const points = days.map((day): ArmProjectionPoint => {
      let n = 0;
      let net: number | null = 0;
      for (const id of planIds) {
        const pt = curveOf.get(id)?.points.find((p) => p.day === day);
        if (!pt || pt.n === 0) continue;
        n += pt.n;
        net = net === null || pt.net === null ? null : net + pt.net;
      }
      const netPerSubscription = n >= min && net !== null ? round2(net / n) : null;
      return {
        day,
        n,
        netPerSubscription,
        // 4 décimales, pas 2 : par assigné, les deux bras tiennent dans le même
        // centime (0,23 € contre 0,23 € à J14 au 24/10) — l'arrondi d'affichage
        // reste à l'écran, le rapport des bras se calcule sur la valeur pleine.
        perAssigned:
          netPerSubscription !== null && conversion !== null
            ? Math.round(conversion * netPerSubscription * 10000) / 10000
            : null,
      };
    });
    return { variant: arm.variant, families, planIds, conversion, points };
  });
}
