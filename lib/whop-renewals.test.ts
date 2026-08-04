import { describe, it, expect } from "vitest";
import {
  whopBillingOrigin,
  splitRevenueByOrigin,
  renewalsByPlan,
  computeRenewalStats,
  type WhopRenewalPaymentLike,
  type WhopMembershipLike,
} from "./whop-revenue";
// Réplique serveur (A6) importée en RELATIF : le test verrouille la parité.
import * as srv from "../convex/whopRevenue";

/**
 * MOTEUR DE RENOUVELLEMENT — la métrique qui décide si l'acquisition est
 * rentable. Les cas testés sont ceux qui, mal traités, donneraient un chiffre
 * FAUX ET CRÉDIBLE : un renouvellement compté comme acquisition, un abonnement
 * encore dans sa première période compté comme non-renouvelé, un historique
 * sans `billing_reason` silencieusement rangé en « nouveau ».
 */

const JOUR = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const J1 = Date.UTC(2026, 7, 1);
const J2 = Date.UTC(2026, 7, 2);
const J3 = Date.UTC(2026, 7, 3);

function pay(o: Partial<WhopRenewalPaymentLike> = {}): WhopRenewalPaymentLike {
  return {
    status: "paid",
    grossAmount: 7.99,
    feeAmount: 0,
    netAmount: 7.35,
    refundedAmount: 0,
    currency: "eur",
    paidAt: J1,
    ...o,
  };
}

describe("origine d'un paiement", () => {
  it("sépare acquisition et renouvellement", () => {
    expect(whopBillingOrigin("subscription_create")).toBe("new");
    expect(whopBillingOrigin("subscription_cycle")).toBe("renewal");
  });

  it("un changement d'offre n'est PAS une acquisition", () => {
    expect(whopBillingOrigin("subscription_update")).toBe("renewal");
  });

  it("absent ou inconnu → unknown, JAMAIS deviné en acquisition", () => {
    expect(whopBillingOrigin(undefined)).toBe("unknown");
    expect(whopBillingOrigin("")).toBe("unknown");
    expect(whopBillingOrigin("valeur_future_whop")).toBe("unknown");
  });
});

describe("revenu nouveau contre revenu de renouvellement", () => {
  it("ventile par jour et cumule", () => {
    const r = splitRevenueByOrigin(
      [
        pay({ paidAt: J1, billingReason: "subscription_create", netAmount: 4.48 }),
        pay({ paidAt: J2, billingReason: "subscription_cycle" }),
        pay({ paidAt: J2, billingReason: "subscription_cycle" }),
        pay({ paidAt: J3, billingReason: "subscription_create", netAmount: 4.48 }),
      ],
      JOUR,
    );
    expect(r.newNet).toBe(8.96);
    expect(r.renewalNet).toBe(14.7);
    expect(r.renewalCount).toBe(2);
    expect(r.days.map((d) => d.day)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    // Le cumul est inclusif et monotone.
    expect(r.days.map((d) => d.cumulativeRenewalNet)).toEqual([0, 14.7, 14.7]);
    expect(r.days.map((d) => d.cumulativeNewNet)).toEqual([4.48, 4.48, 8.96]);
  });

  it("une journée 100 % renouvellement se lit comme telle", () => {
    const r = splitRevenueByOrigin(
      [
        pay({ paidAt: J3, billingReason: "subscription_cycle" }),
        pay({ paidAt: J3, billingReason: "subscription_cycle" }),
        pay({ paidAt: J3, billingReason: "subscription_cycle" }),
        pay({ paidAt: J3, billingReason: "subscription_cycle" }),
      ],
      JOUR,
    );
    expect(r.days).toHaveLength(1);
    expect(r.days[0].newCount).toBe(0);
    expect(r.days[0].renewalCount).toBe(4);
    expect(r.days[0].renewalNet).toBe(29.4); // le chiffre observé le 03/08
    expect(r.renewalShare).toBe(1);
  });

  it("l'historique sans billing_reason ne gonfle NI l'acquisition NI la part de rétention", () => {
    const r = splitRevenueByOrigin(
      [
        pay({ billingReason: undefined, netAmount: 100 }),
        pay({ billingReason: "subscription_cycle", netAmount: 10 }),
      ],
      JOUR,
    );
    expect(r.newNet).toBe(0);
    expect(r.unknownNet).toBe(100);
    expect(r.unknownPayments).toBe(1);
    // Part de rétention calculée sur le CLASSÉ seulement (sinon 10/110 = 9 %).
    expect(r.renewalShare).toBe(1);
  });

  it("un paiement échoué ne pèse ni en montant ni en effectif", () => {
    const r = splitRevenueByOrigin(
      [pay({ status: "failed", billingReason: "subscription_cycle", netAmount: 7.35 })],
      JOUR,
    );
    expect(r.renewalNet).toBe(0);
    expect(r.renewalCount).toBe(0);
  });
});

describe("renouvellements par offre", () => {
  it("ne retient que les renouvellements et compte les clients distincts", () => {
    const rows = renewalsByPlan([
      pay({ billingReason: "subscription_create", planId: "plan_A" }),
      pay({ billingReason: "subscription_cycle", planId: "plan_A", membershipId: "m1" }),
      pay({ billingReason: "subscription_cycle", planId: "plan_A", membershipId: "m1" }),
      pay({ billingReason: "subscription_cycle", planId: "plan_B", membershipId: "m2", netAmount: 4.48 }),
    ]);
    const a = rows.find((r) => r.planId === "plan_A")!;
    expect(a.renewalCount).toBe(2);
    expect(a.members).toBe(1); // deux cycles, un seul client
    expect(a.renewalNet).toBe(14.7);
    expect(rows.find((r) => r.planId === "plan_B")!.renewalNet).toBe(4.48);
  });
});

describe("taux de renouvellement, cycles et durée de vie", () => {
  const NOW = Date.UTC(2026, 7, 4);
  const mem = (id: string, accessEndsAt?: number): WhopMembershipLike => ({
    whopMembershipId: id,
    accessEndsAt,
  });

  it("un abonnement encore dans sa première période n'est PAS un échec", () => {
    const s = computeRenewalStats(
      [pay({ membershipId: "m1" })],
      [mem("m1", NOW + 86_400_000)], // accès valide demain
      NOW,
    );
    expect(s.dueSubscriptions).toBe(0);
    expect(s.notYetDue).toBe(1);
    expect(s.renewalRate).toBeNull(); // rien à conclure, surtout pas 0 %
  });

  it("accès expiré sans nouveau paiement = échéance manquée", () => {
    const s = computeRenewalStats(
      [pay({ membershipId: "m1" })],
      [mem("m1", NOW - 86_400_000)],
      NOW,
    );
    expect(s.dueSubscriptions).toBe(1);
    expect(s.renewedSubscriptions).toBe(0);
    expect(s.renewalRate).toBe(0);
  });

  it("deux paiements = a renouvelé, quelle que soit la date de fin d'accès", () => {
    const s = computeRenewalStats(
      [pay({ membershipId: "m1" }), pay({ membershipId: "m1" })],
      [mem("m1", NOW + 86_400_000)],
      NOW,
    );
    expect(s.dueSubscriptions).toBe(1);
    expect(s.renewedSubscriptions).toBe(1);
    expect(s.renewalRate).toBe(1);
  });

  it("taux, cycles moyens, distribution et durée de vie sur un jeu mixte", () => {
    const s = computeRenewalStats(
      [
        pay({ membershipId: "m1" }), pay({ membershipId: "m1" }), // 2 cycles
        pay({ membershipId: "m2" }), // 1, expiré
        pay({ membershipId: "m3" }), // 1, encore actif
      ],
      [mem("m1", NOW + 1), mem("m2", NOW - 1), mem("m3", NOW + 1)],
      NOW,
    );
    expect(s.dueSubscriptions).toBe(2); // m1 (renouvelé) + m2 (expiré)
    expect(s.renewedSubscriptions).toBe(1);
    expect(s.renewalRate).toBe(0.5);
    expect(s.notYetDue).toBe(1); // m3
    expect(s.payingMembers).toBe(3);
    expect(s.averageCycles).toBe(1.33); // 4 paiements / 3 clients
    expect(s.cycleDistribution).toEqual([
      { cycles: 1, members: 2 },
      { cycles: 2, members: 1 },
    ]);
    expect(s.netPerPayment).toBe(7.35);
    expect(s.lifetimeValue).toBe(9.78); // 7,35 × 1,33
  });

  it("aucun paiement → tout à null, jamais 0 (0 se lirait comme un fait)", () => {
    const s = computeRenewalStats([], [mem("m1", NOW - 1)], NOW);
    expect(s.renewalRate).toBeNull();
    expect(s.averageCycles).toBeNull();
    expect(s.lifetimeValue).toBeNull();
    expect(s.payingMembers).toBe(0);
  });
});

// ─── Parité lib/ ↔ convex/ (règle A6) ────────────────────────────────────────
// Le moteur vit en DEUX exemplaires : convex/ ne peut pas importer lib/. Sans ce
// test, une correction appliquée d'un seul côté ferait diverger le chiffre
// affiché de celui calculé au serveur, sans que rien ne casse.
describe("parité lib/ ↔ convex/ du moteur de renouvellement (A6)", () => {
  const NOW = Date.UTC(2026, 7, 4);
  const jeu: WhopRenewalPaymentLike[] = [
    pay({ paidAt: J1, billingReason: "subscription_create", planId: "p1", membershipId: "m1", netAmount: 4.48 }),
    pay({ paidAt: J2, billingReason: "subscription_cycle", planId: "p1", membershipId: "m1" }),
    pay({ paidAt: J3, billingReason: "subscription_cycle", planId: "p2", membershipId: "m2" }),
    pay({ paidAt: J3, billingReason: undefined, planId: "p2", membershipId: "m3", netAmount: 99 }),
    pay({ paidAt: J3, status: "refunded", billingReason: "subscription_cycle", membershipId: "m4" }),
  ];
  const mems: WhopMembershipLike[] = [
    { whopMembershipId: "m1", accessEndsAt: NOW + 1 },
    { whopMembershipId: "m2", accessEndsAt: NOW - 1 },
    { whopMembershipId: "m3", accessEndsAt: NOW + 1 },
  ];

  it("whopBillingOrigin rend la même chose des deux côtés", () => {
    for (const v of ["subscription_create", "subscription_cycle", "subscription_update", "", "inconnu", undefined]) {
      expect(srv.whopBillingOrigin(v)).toBe(whopBillingOrigin(v));
    }
  });

  it("splitRevenueByOrigin rend la même chose des deux côtés", () => {
    expect(srv.splitRevenueByOrigin(jeu, JOUR)).toEqual(splitRevenueByOrigin(jeu, JOUR));
  });

  it("renewalsByPlan rend la même chose des deux côtés", () => {
    expect(srv.renewalsByPlan(jeu)).toEqual(renewalsByPlan(jeu));
  });

  it("computeRenewalStats rend la même chose des deux côtés", () => {
    expect(srv.computeRenewalStats(jeu, mems, NOW)).toEqual(computeRenewalStats(jeu, mems, NOW));
  });
});

describe("renouvellements en échec (past_due Whop)", () => {
  const NOW = Date.UTC(2026, 7, 4);
  it("une échéance tentée et non encaissée est comptée à part, ni churn ni revenu", () => {
    const s = computeRenewalStats(
      [
        pay({ membershipId: "m1" }),
        // past_due normalise en "failed" : Whop relancera.
        pay({ membershipId: "m1", status: "failed", billingReason: "subscription_cycle", grossAmount: 4.99 }),
      ],
      [{ whopMembershipId: "m1", accessEndsAt: NOW + 1 }],
      NOW,
    );
    expect(s.failedRenewalAttempts).toBe(1);
    expect(s.failedRenewalAmount).toBe(4.99);
    // Un échec en cours ne compte NI comme renouvellement NI comme échéance ratée.
    expect(s.renewedSubscriptions).toBe(0);
    expect(s.dueSubscriptions).toBe(0);
  });

  it("un premier paiement échoué n'est pas un renouvellement en échec", () => {
    const s = computeRenewalStats(
      [pay({ membershipId: "m1", status: "failed", billingReason: "subscription_create" })],
      [{ whopMembershipId: "m1", accessEndsAt: NOW + 1 }],
      NOW,
    );
    expect(s.failedRenewalAttempts).toBe(0);
  });
});
