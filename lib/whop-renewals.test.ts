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

const SEM = (ms: number) => {
  const d = new Date(ms);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

describe("issues des échéances : trois états, jamais deux", () => {
  const NOW = Date.UTC(2026, 7, 4);
  const mem = (id: string, accessEndsAt?: number): WhopMembershipLike => ({
    whopMembershipId: id,
    accessEndsAt,
  });
  const stats = (p: WhopRenewalPaymentLike[], m: WhopMembershipLike[]) =>
    computeRenewalStats(p, m, { now: NOW, weekKeyOf: SEM });

  it("un abonnement encore dans sa première période n'a rien décidé", () => {
    const s = stats([pay({ membershipId: "m1" })], [mem("m1", NOW + 86_400_000)]);
    expect(s.due).toEqual({ renewed: 0, failed: 0, pending: 0, notYetDue: 1 });
    expect(s.renewalRateResolved).toBeNull();
  });

  it("accès expiré sans nouveau paiement = échec CONSTATÉ", () => {
    const s = stats([pay({ membershipId: "m1" })], [mem("m1", NOW - 86_400_000)]);
    expect(s.due.failed).toBe(1);
    expect(s.renewalRateResolved).toBe(0);
  });

  it("un past_due est EN ATTENTE : ni succès ni échec", () => {
    const s = stats(
      [
        pay({ membershipId: "m1" }),
        pay({ membershipId: "m1", status: "failed", billingReason: "subscription_cycle", grossAmount: 4.99 }),
      ],
      [mem("m1", NOW - 86_400_000)], // accès expiré, MAIS relance en cours
    );
    expect(s.due).toEqual({ renewed: 0, failed: 0, pending: 1, notYetDue: 0 });
    // Il ne compte NI dans le taux résolu (pas de dénominateur) NI comme échec.
    expect(s.renewalRateResolved).toBeNull();
    // Il pèse en revanche sur la borne basse.
    expect(s.renewalRateWorstCase).toBe(0);
    expect(s.pendingRenewalAmount).toBe(4.99);
  });

  it("les deux taux encadrent la vérité — le cas prod 6 renouvelés / 5 en attente", () => {
    const payments: WhopRenewalPaymentLike[] = [];
    const mems: WhopMembershipLike[] = [];
    for (let i = 0; i < 6; i++) {
      payments.push(pay({ membershipId: `r${i}` }), pay({ membershipId: `r${i}` }));
      mems.push(mem(`r${i}`, NOW + 1));
    }
    for (let i = 0; i < 5; i++) {
      payments.push(
        pay({ membershipId: `p${i}` }),
        pay({ membershipId: `p${i}`, status: "failed", billingReason: "subscription_cycle" }),
      );
      mems.push(mem(`p${i}`, NOW + 1));
    }
    const s = stats(payments, mems);
    expect(s.due.renewed).toBe(6);
    expect(s.due.pending).toBe(5);
    expect(s.renewalRateResolved).toBe(1); // 6/6 — aucune échéance résolue en échec
    expect(s.renewalRateWorstCase).toBe(0.5455); // 6/11
  });
});

describe("les trois chiffres de revenu par client", () => {
  const NOW = Date.UTC(2026, 7, 4);
  const stats = (p: WhopRenewalPaymentLike[], m: WhopMembershipLike[]) =>
    computeRenewalStats(p, m, { now: NOW, weekKeyOf: SEM });

  it("revenu À CE JOUR = net encaissé / clients, sans aucune hypothèse", () => {
    const s = stats(
      [
        pay({ membershipId: "m1", netAmount: 10 }),
        pay({ membershipId: "m1", netAmount: 10 }),
        pay({ membershipId: "m2", netAmount: 4 }),
      ],
      [{ whopMembershipId: "m1" }, { whopMembershipId: "m2" }],
    );
    expect(s.netTotal).toBe(24);
    expect(s.payingMembers).toBe(2);
    expect(s.revenueToDatePerClient).toBe(12);
  });

  it("la projection dérive du TAUX, pas d'une moyenne de cycles écrasée", () => {
    // 1 renouvelé, 1 échec → taux 50 % → 1/(1−0,5) = 2 cycles × 10 € = 20 €.
    const s = stats(
      [
        pay({ membershipId: "m1", netAmount: 10 }),
        pay({ membershipId: "m1", netAmount: 10 }),
        pay({ membershipId: "m2", netAmount: 10 }),
      ],
      [
        { whopMembershipId: "m1", accessEndsAt: NOW + 1 },
        { whopMembershipId: "m2", accessEndsAt: NOW - 1 },
      ],
    );
    expect(s.renewalRateResolved).toBe(0.5);
    expect(s.projectedPerClientResolved).toBe(20);
    // La moyenne de cycles (1,5) donnerait 15 € — c'est le calcul trompeur.
    expect(s.averageCycles).toBe(1.5);
  });

  it("un taux de 100 % n'est PAS une valeur infinie : la projection est null", () => {
    const s = stats(
      [pay({ membershipId: "m1" }), pay({ membershipId: "m1" })],
      [{ whopMembershipId: "m1", accessEndsAt: NOW + 1 }],
    );
    expect(s.renewalRateResolved).toBe(1);
    expect(s.projectedPerClientResolved).toBeNull();
  });

  it("la maturité dit combien de clients ont réellement atteint une échéance", () => {
    const s = stats(
      [
        pay({ membershipId: "m1" }), pay({ membershipId: "m1" }),
        pay({ membershipId: "m2" }),
      ],
      [
        { whopMembershipId: "m1", accessEndsAt: NOW + 1 },
        { whopMembershipId: "m2", accessEndsAt: NOW + 1 }, // encore en cours
      ],
    );
    expect(s.matureShare).toBe(0.5); // 1 client sur 2
  });
});

describe("cohortes par semaine d'acquisition", () => {
  const NOW = Date.UTC(2026, 7, 4);
  it("regroupe sur la semaine du PREMIER paiement et cumule le réel", () => {
    const s = computeRenewalStats(
      [
        // m1 acquis le lundi 27/07, deux cycles
        pay({ membershipId: "m1", paidAt: Date.UTC(2026, 6, 27), netAmount: 7 }),
        pay({ membershipId: "m1", paidAt: Date.UTC(2026, 7, 3), netAmount: 7 }),
        // m2 acquis le jeudi 30/07 → MÊME semaine que m1
        pay({ membershipId: "m2", paidAt: Date.UTC(2026, 6, 30), netAmount: 4 }),
        // m3 acquis la semaine suivante
        pay({ membershipId: "m3", paidAt: Date.UTC(2026, 7, 3), netAmount: 4 }),
      ],
      [{ whopMembershipId: "m1" }, { whopMembershipId: "m2" }, { whopMembershipId: "m3" }],
      { now: NOW, weekKeyOf: SEM },
    );
    expect(s.cohorts).toEqual([
      { week: "2026-07-27", clients: 2, cycles: 3, net: 18, netPerClient: 9 },
      { week: "2026-08-03", clients: 1, cycles: 1, net: 4, netPerClient: 4 },
    ]);
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
    pay({ paidAt: J3, status: "failed", billingReason: "subscription_cycle", membershipId: "m4" }),
    pay({ paidAt: J3, status: "failed", billingReason: "subscription_cycle", membershipId: "m3" }),
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
    const o = { now: NOW, weekKeyOf: SEM };
    expect(srv.computeRenewalStats(jeu, mems, o)).toEqual(computeRenewalStats(jeu, mems, o));
  });
});
