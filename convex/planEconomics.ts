/**
 * ÉCONOMIE PAR ABONNEMENT — le calcul pur derrière la LTV réalisée, le revenu
 * mensuel par client et l'économie par offre de `getRevenueBreakdownCore`
 * (onglet Offres « Économie par offre », outil MCP `revenus`).
 *
 * Sorti de la query pour être testé sur des paiements réels (lib/
 * plan-economics-money.test.ts) : la query ne fait plus que lire la base.
 *
 * ⚠️ DEVISES. Le net d'un paiement est exprimé dans la devise DU paiement. Ce
 * calcul l'accumulait tel quel par abonnement : le 08/10/2026 sur Snytch (EUR
 * + USD + RSD), l'offre serbe à 599 RSD affichait 2 141,05 de net et 237,89 de
 * LTV — des dinars lus comme des euros —, et la LTV du projet montait avec.
 * Chaque net est désormais ramené à la devise du revenu par le MÊME référentiel
 * que le total de l'écran (`summarizeWhopRevenue` sur tous les paiements du
 * projet, au taux du projet). Tous les montants rendus ici sont dans
 * `ref.currency` — jamais dans la devise de l'offre, qui reste celle du PRIX.
 *
 * Une devise encaissée SANS taux laisse le revenu non additionnable (garde A5) :
 * tout montant passe à `null`, les compteurs (abonnés) restent justes. Un mois
 * est actif, un paiement est compté, sur le net BRUT : 0,50 RSD converti
 * s'arrondit à 0,00 € mais a bien été encaissé.
 */
import { monthKeyParis } from "./dateFr";
import {
  isSecuredRevenue,
  whopNetContribution,
  whopNetInSummaryCurrency,
  type WhopPaymentLike,
  type WhopRevenueSummary,
} from "./whopRevenue";

export interface PlanEconomicsPaymentLike extends WhopPaymentLike {
  paidAt: number;
  membershipId?: string;
  planId?: string;
}

/** Clé des paiements sans offre Whop. */
export const NO_PLAN_ID = "(sans plan)";

/** Montants dans la devise du revenu (`ref.currency`), `null` si non additionnables. */
export interface PlanMoney {
  /** Abonnements rattachés à l'offre (celle du premier paiement lu). */
  members: number;
  /** Net cumulé de ces abonnements. */
  netTotal: number | null;
  /** LTV RÉALISÉE = net cumulé / abonnements. */
  ltv: number | null;
  /** Net par mois-abonné actif (mois où l'abonnement a encaissé). */
  netPerMemberMonth: number | null;
  /** Net moyen par paiement encaissé SUR cette offre. */
  netPerPayment: number | null;
}

export interface MembershipEconomics {
  plans: Map<string, PlanMoney>;
  /** LTV réalisée toutes offres confondues. */
  ltv: number | null;
  /** Net moyen par abonnement et par mois actif (dénominateur du payback). */
  monthlyArpu: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function membershipEconomicsOf(
  payments: readonly PlanEconomicsPaymentLike[],
  ref: Pick<WhopRevenueSummary, "currency" | "conversions" | "mixedCurrency">,
): MembershipEconomics {
  // A5 : sans référentiel additionnable, aucun montant — `whopNetInSummaryCurrency`
  // rendrait alors le net dans la devise du paiement.
  const money = (n: number): number | null => (ref.mixedCurrency ? null : round2(n));
  const perMembership = new Map<
    string,
    { net: number; planId: string; months: Set<string> }
  >();
  // Net/paiement : sur TOUS les paiements de l'offre (abonnement ou pas).
  const perPlanPayments = new Map<string, { net: number; count: number }>();
  for (const p of payments) {
    const encaisse = whopNetContribution(p) > 0;
    const net = whopNetInSummaryCurrency(p, ref);
    const planKey = p.planId ?? NO_PLAN_ID;
    const pp = perPlanPayments.get(planKey) ?? { net: 0, count: 0 };
    pp.net += net;
    if (isSecuredRevenue(p.status)) pp.count += 1;
    perPlanPayments.set(planKey, pp);

    if (!p.membershipId) continue;
    const cur = perMembership.get(p.membershipId) ?? {
      net: 0,
      planId: planKey,
      months: new Set<string>(),
    };
    cur.net += net;
    if (encaisse) cur.months.add(monthKeyParis(p.paidAt));
    perMembership.set(p.membershipId, cur);
  }

  const byPlan = new Map<
    string,
    { members: number; netTotal: number; memberMonths: number }
  >();
  for (const m of perMembership.values()) {
    const cur = byPlan.get(m.planId) ?? {
      members: 0,
      netTotal: 0,
      memberMonths: 0,
    };
    cur.members += 1;
    cur.netTotal += m.net;
    cur.memberMonths += m.months.size;
    byPlan.set(m.planId, cur);
  }

  const plans = new Map<string, PlanMoney>();
  for (const [planId, x] of byPlan) {
    const pp = perPlanPayments.get(planId) ?? { net: 0, count: 0 };
    plans.set(planId, {
      members: x.members,
      netTotal: money(x.netTotal),
      ltv: x.members > 0 ? money(x.netTotal / x.members) : null,
      netPerMemberMonth:
        x.memberMonths > 0 ? money(x.netTotal / x.memberMonths) : null,
      netPerPayment: pp.count > 0 ? money(pp.net / pp.count) : null,
    });
  }

  const totalNet = [...perMembership.values()].reduce((s, m) => s + m.net, 0);
  const totalMembers = perMembership.size;
  const totalMemberMonths = [...perMembership.values()].reduce(
    (s, m) => s + m.months.size,
    0,
  );
  return {
    plans,
    ltv: totalMembers > 0 ? money(totalNet / totalMembers) : null,
    monthlyArpu:
      totalMemberMonths > 0 ? money(totalNet / totalMemberMonths) : null,
  };
}
