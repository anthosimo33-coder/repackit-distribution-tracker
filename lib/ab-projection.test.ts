import { describe, expect, it } from "vitest";
import {
  armProjections,
  planNetCurves,
  PROJECTION_MIN_SUBSCRIPTIONS,
  type PlanNetCurve,
  type ProjectionMembershipLike,
  type ProjectionPaymentLike,
} from "../convex/abProjection";
import { projectFx, summarizeWhopRevenue } from "../convex/whopRevenue";
import type { InternalAccountsConfig } from "../convex/internalAccounts";

/**
 * Revenu PROJETÉ par assigné (onglet Offres & tests, MCP `offres`).
 *
 * Le défaut corrigé : « Net / assigné » compte l'encaissé À DATE, ce qui
 * favorise une offre ponctuelle (Pass 7 jours, payé d'un coup) tant que les
 * renouvellements de l'hebdo ne sont pas tombés — environ quatre semaines sur
 * le test paywall_pass_2026_10. Les entrées ont la forme de la prod : plans
 * `plan_…` réels de Snytch, nets après frais Whop, renouvellement hebdo émis
 * quelques minutes APRÈS les 7 jours, dollars au taux du projet.
 */
const DAY = 86_400_000;
const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 1, 14, 3);
const HEBDO_EUR = "plan_8Eo6l4YYhkeI5";
const HEBDO_USD = "plan_HFtrxkHt9BQMn";
const MENSUEL_EUR = "plan_WOE4g8VkBjtgy";
const PASS_EUR = "plan_BHa0QD8ANOD6L";
const NO_INTERNAL: InternalAccountsConfig = { handles: [], whopMembershipIds: [] };
const SNYTCH_FX = projectFx({ payCurrency: "usd", fxRateToRevenue: 0.86 });

function paiement(
  membershipId: string,
  paidAt: number,
  net: number,
  extra: Partial<ProjectionPaymentLike> = {},
): ProjectionPaymentLike {
  return {
    membershipId,
    paidAt,
    currency: "eur",
    status: "paid",
    grossAmount: net,
    feeAmount: 0,
    netAmount: net,
    refundedAmount: 0,
    ...extra,
  };
}

const courbes = (
  payments: ProjectionPaymentLike[],
  memberships: ProjectionMembershipLike[],
  nowMs: number,
  internalCfg = NO_INTERNAL,
) =>
  planNetCurves({
    payments,
    memberships,
    nowMs,
    internalCfg,
    ref: summarizeWhopRevenue(payments, SNYTCH_FX),
  });

const point = (c: PlanNetCurve[], planId: string, day: number) =>
  c.find((x) => x.planId === planId)?.points.find((p) => p.day === day);

describe("planNetCurves — net cumulé par abonnement, jour 0 = premier encaissement", () => {
  it("un hebdo renouvelé À J7 (quelques minutes après) compte ce renouvellement dans J7", () => {
    // La référence prod (J7 13,21 €) n'est atteinte qu'en comptant le jour 7 :
    // sans lui, J7 ne vaudrait qu'un cycle.
    const pay = [
      paiement("mem_a", T0, 9.27),
      paiement("mem_a", T0 + 7 * DAY + 4 * MIN, 9.27),
      paiement("mem_a", T0 + 14 * DAY + 6 * MIN, 9.27),
    ];
    const c = courbes(pay, [{ whopMembershipId: "mem_a", planId: HEBDO_EUR }], T0 + 60 * DAY);
    expect(point(c, HEBDO_EUR, 7)).toEqual({ day: 7, n: 1, net: 18.54 });
    expect(point(c, HEBDO_EUR, 14)).toEqual({ day: 14, n: 1, net: 27.81 });
    expect(point(c, HEBDO_EUR, 28)).toEqual({ day: 28, n: 1, net: 27.81 });
  });

  it("un abonnement n'entre au point k qu'une fois son jour k RÉVOLU", () => {
    // À J7 + 12 h, le jour 7 n'est pas fini : un renouvellement en relance
    // passerait pour un désabonnement.
    const pay = [paiement("mem_a", T0, 9.27)];
    const m = [{ whopMembershipId: "mem_a", planId: HEBDO_EUR }];
    expect(point(courbes(pay, m, T0 + 7 * DAY + 12 * 60 * MIN), HEBDO_EUR, 7)?.n).toBe(0);
    // Contre-épreuve : un jour plus tard, il compte.
    expect(point(courbes(pay, m, T0 + 8 * DAY + MIN), HEBDO_EUR, 7)?.n).toBe(1);
  });

  it("un checkout jamais encaissé n'est pas un abonnement ; un remboursé, si (net 0)", () => {
    // 476 memberships « drafted » en prod au 24/10 : les compter divisait la
    // courbe par des gens qui n'ont jamais payé.
    const pay = [
      paiement("mem_paye", T0, 9.27),
      paiement("mem_draft", T0, 0, { status: "failed" }),
      paiement("mem_rembourse", T0, 9.27, { status: "refunded", refundedAmount: 9.27 }),
    ];
    const c = courbes(
      pay,
      [
        { whopMembershipId: "mem_paye", planId: HEBDO_EUR },
        { whopMembershipId: "mem_draft", planId: HEBDO_EUR },
        { whopMembershipId: "mem_sans_paiement", planId: HEBDO_EUR },
        { whopMembershipId: "mem_rembourse", planId: HEBDO_EUR },
      ],
      T0 + 30 * DAY,
    );
    expect(point(c, HEBDO_EUR, 7)).toEqual({ day: 7, n: 2, net: 9.27 });
  });

  it("le jour 0 est le premier ENCAISSEMENT, pas la première tentative", () => {
    // Échec le 1er, encaissé 3 jours plus tard : le renouvellement à J7 de
    // l'encaissement tombe dans J7, pas dans J10.
    const pay = [
      paiement("mem_a", T0, 0, { status: "failed" }),
      paiement("mem_a", T0 + 3 * DAY, 9.27),
      paiement("mem_a", T0 + 10 * DAY + 5 * MIN, 9.27),
    ];
    const c = courbes(pay, [{ whopMembershipId: "mem_a", planId: HEBDO_EUR }], T0 + 40 * DAY);
    expect(point(c, HEBDO_EUR, 7)?.net).toBe(18.54);
  });

  it("ramène les dollars au taux du projet, avant toute somme", () => {
    // Le référentiel est celui du lot du PROJET (euros + dollars), comme dans
    // abRevenueOf : seul, un lot en dollars aurait le dollar pour devise.
    const pay = [paiement("mem_eu", T0, 9.27), paiement("mem_us", T0, 11.15, { currency: "usd" })];
    const c = courbes(
      pay,
      [
        { whopMembershipId: "mem_eu", planId: HEBDO_EUR },
        { whopMembershipId: "mem_us", planId: HEBDO_USD },
      ],
      T0 + 30 * DAY,
    );
    expect(point(c, HEBDO_USD, 7)?.net).toBe(9.59); // 11,15 × 0,86
    expect(point(c, HEBDO_EUR, 7)?.net).toBe(9.27);
  });

  it("écarte les abonnements internes et les sessions de QA à bras forcé", () => {
    const pay = [paiement("mem_int", T0, 9.27), paiement("mem_qa", T0, 9.27), paiement("mem_ok", T0, 9.27)];
    const c = courbes(
      pay,
      [
        { whopMembershipId: "mem_int", planId: HEBDO_EUR },
        { whopMembershipId: "mem_qa", planId: HEBDO_EUR, abForced: true },
        { whopMembershipId: "mem_ok", planId: HEBDO_EUR },
      ],
      T0 + 30 * DAY,
      { handles: [], whopMembershipIds: ["mem_int"] },
    );
    expect(point(c, HEBDO_EUR, 7)?.n).toBe(1);
  });

  it("devise encaissée sans taux : somme null (A5), effectif intact", () => {
    const pay = [paiement("mem_a", T0, 9.27), paiement("mem_b", T0, 599, { currency: "rsd" })];
    const c = courbes(
      pay,
      [
        { whopMembershipId: "mem_a", planId: HEBDO_EUR },
        { whopMembershipId: "mem_b", planId: HEBDO_EUR },
      ],
      T0 + 30 * DAY,
    );
    expect(point(c, HEBDO_EUR, 7)).toEqual({ day: 7, n: 2, net: null });
  });
});

/** Une courbe de plan à partir de (n, net moyen) par jour — la forme rendue par planNetCurves. */
const curve = (planId: string, pts: [number, number, number][]): PlanNetCurve => ({
  planId,
  points: pts.map(([day, n, mean]) => ({ day, n, net: Math.round(n * mean * 100) / 100 })),
});

describe("armProjections — conversion du bras × courbe de SON offre", () => {
  // Prod au 24/10/2026 : 120 / 8 123 hard, 131 / 7 869 pass, table apprise
  // trio → hard, pass → pass. Le bras pass a vendu deux hebdos (grille en
  // dollars sans pass du 07 au 13/10) : ils ne doivent PAS entrer dans sa courbe.
  const arms = [
    { variant: "hard", exposed: 8123, paid: 120 },
    { variant: "pass", exposed: 7869, paid: 131 },
  ];
  const purchases = [
    { plan: "snytch_trio_weekly", whopPlanId: HEBDO_EUR },
    { plan: "snytch_trio_monthly", whopPlanId: MENSUEL_EUR },
    { plan: "snytch_trio_weekly", whopPlanId: HEBDO_USD },
    { plan: "snytch_pass_7d", whopPlanId: PASS_EUR },
    { plan: "snytch_trio_weekly", whopPlanId: HEBDO_EUR }, // achat d'un client du bras pass
  ];
  const planFamilies = [
    { family: "trio", variant: "hard" },
    { family: "pass", variant: "pass" },
  ];
  const curves = [
    curve(HEBDO_EUR, [[7, 420, 12.4], [14, 360, 15.1], [28, 300, 18.4], [42, 210, 21.1]]),
    curve(MENSUEL_EUR, [[7, 60, 27.9], [14, 50, 27.9], [28, 40, 27.9], [42, 22, 44.0]]),
    curve(HEBDO_USD, [[7, 22, 9.6], [14, 14, 12.0], [28, 8, 14.4], [42, 5, 16.8]]),
    curve(PASS_EUR, [[7, 81, 12.97], [14, 6, 13.5], [28, 0, 0], [42, 0, 0]]),
  ];
  const [hard, pass] = armProjections({ arms, purchases, planFamilies, curves });

  it("l'offre d'un bras = les plans de SA famille, pas les plans achetés par ses clients", () => {
    expect(hard.families).toEqual(["trio"]);
    expect(hard.planIds).toEqual([HEBDO_EUR, HEBDO_USD, MENSUEL_EUR].sort());
    expect(pass.families).toEqual(["pass"]);
    expect(pass.planIds).toEqual([PASS_EUR]);
  });

  it("mutualise les plans de l'offre (sommes ÷ effectifs), puis multiplie par la conversion", () => {
    const j28 = hard.points.find((p) => p.day === 28)!;
    expect(j28.n).toBe(348);
    const attendu = (300 * 18.4 + 40 * 27.9 + 8 * 14.4) / 348;
    expect(j28.netPerSubscription).toBe(Math.round(attendu * 100) / 100);
    expect(j28.perAssigned).toBeCloseTo((120 / 8123) * j28.netPerSubscription!, 4);
  });

  it("rien n'est projeté sous 10 abonnements — et le n sort quand même", () => {
    const p14 = pass.points.find((p) => p.day === 14)!;
    expect(p14).toEqual({ day: 14, n: 6, netPerSubscription: null, perAssigned: null });
    expect(pass.points.find((p) => p.day === 28)).toEqual({ day: 28, n: 0, netPerSubscription: null, perAssigned: null });
    // Contre-épreuve au seuil exact.
    const [auSeuil] = armProjections({
      arms: [arms[1]],
      purchases,
      planFamilies,
      curves: [curve(PASS_EUR, [[14, PROJECTION_MIN_SUBSCRIPTIONS, 13.5]])],
      days: [14],
    });
    expect(auSeuil.points[0]).toMatchObject({ n: 10, netPerSubscription: 13.5 });
  });

  it("PRÉSENCE : à J7, le pass est projeté et devance l'hebdo ; l'hebdo le rattrape ensuite", () => {
    const p7 = pass.points.find((p) => p.day === 7)!;
    const h7 = hard.points.find((p) => p.day === 7)!;
    expect(p7.perAssigned).not.toBeNull();
    expect(p7.perAssigned!).toBeGreaterThan(h7.perAssigned!);
  });

  it("garde 4 décimales : les deux bras tiennent dans le même centime", () => {
    const h14 = hard.points.find((p) => p.day === 14)!;
    expect(h14.perAssigned! * 10000).toBeCloseTo(Math.round(h14.perAssigned! * 10000), 6);
    expect(Number.isInteger(h14.perAssigned! * 100)).toBe(false);
  });

  it("sans table de familles (cache d'avant le 24/10), aucune offre, aucune projection", () => {
    const [h] = armProjections({ arms, purchases, planFamilies: [], curves });
    expect(h.families).toEqual([]);
    expect(h.points.every((p) => p.perAssigned === null && p.n === 0)).toBe(true);
  });

  it("une courbe non additionnable (null) ne se projette pas", () => {
    const [h] = armProjections({
      arms: [arms[0]],
      purchases,
      planFamilies,
      curves: [{ planId: HEBDO_EUR, points: [{ day: 7, n: 400, net: null }] }],
      days: [7],
    });
    expect(h.points[0]).toEqual({ day: 7, n: 400, netPerSubscription: null, perAssigned: null });
  });
});
