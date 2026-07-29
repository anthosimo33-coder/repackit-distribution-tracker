import { describe, it, expect } from "vitest";
import {
  classifyMembership,
  computeChurn,
  intervalToDays,
  type MembershipInput,
} from "./churn";

const DAY = 86_400_000;
const now = 100 * DAY;

/** Membership de base (payant), surchargé par cas. */
function m(over: Partial<MembershipInput>): MembershipInput {
  return {
    membershipId: "mem_x",
    planId: "plan_w",
    status: "active",
    valid: true,
    accessEndsAt: 105 * DAY,
    canceledAt: null,
    firstPaidAt: 30 * DAY,
    paidCount: 1,
    intervalDays: 7,
    ...over,
  };
}

describe("classifyMembership — résilié vs expiré", () => {
  it("accès perdu (période passée) → expiré, le vrai churn", () => {
    expect(classifyMembership(m({ accessEndsAt: now - DAY, valid: false }), now)).toBe(
      "expired",
    );
  });
  it("annulé mais accès encore valide → résilié", () => {
    expect(
      classifyMembership(m({ canceledAt: 90 * DAY, accessEndsAt: now + DAY }), now),
    ).toBe("resiliated");
  });
  it("valide, non annulé → actif", () => {
    expect(classifyMembership(m({ accessEndsAt: now + DAY }), now)).toBe("active");
  });
});

describe("intervalToDays", () => {
  it("mappe les cadences connues, null sinon", () => {
    expect(intervalToDays("semaine")).toBe(7);
    expect(intervalToDays("mois")).toBe(30);
    expect(intervalToDays("an")).toBe(365);
    expect(intervalToDays(null)).toBeNull();
    expect(intervalToDays("bimensuel")).toBeNull();
  });
});

describe("computeChurn", () => {
  const memberships: MembershipInput[] = [
    // Actif, a renouvelé (3 paiements).
    m({ membershipId: "m1", planId: "plan_w", paidCount: 3, accessEndsAt: 105 * DAY }),
    // Résilié PUIS expiré, hors panne : résiliation + expiration sur la période.
    m({
      membershipId: "m2",
      planId: "plan_m",
      firstPaidAt: 40 * DAY,
      canceledAt: 45 * DAY,
      accessEndsAt: 47 * DAY,
      valid: false,
      status: "expired",
      paidCount: 1,
    }),
    // Annulé PENDANT la panne (canceledAt < webhookFix) → bug.
    m({
      membershipId: "m3",
      planId: "plan_m",
      firstPaidAt: 15 * DAY,
      canceledAt: 18 * DAY,
      accessEndsAt: 22 * DAY,
      valid: false,
      status: "expired",
      paidCount: 1,
    }),
    // Arrivé à échéance, pas renouvelé, encore actif.
    m({ membershipId: "m4", planId: "plan_w", firstPaidAt: 90 * DAY, paidCount: 1 }),
    // Non payant → exclu du dénominateur.
    m({ membershipId: "m5", paidCount: 0 }),
  ];
  const r = computeChurn(memberships, {
    now,
    periodStartMs: 10 * DAY,
    webhookFixMs: 20 * DAY,
    sampleThreshold: 2,
  });

  it("ne compte que les clients payants", () => {
    expect(r.clients).toBe(4);
  });
  it("sépare résiliations et expirations", () => {
    expect(r.resiliations).toBe(2); // m2, m3
    expect(r.expirations).toBe(2); // m2, m3 (accès perdu sur la période)
  });
  it("taux de résiliation = résiliations / clients", () => {
    expect(r.cancelRate).toBe(50); // 2/4
  });
  it("délais premier paiement → annulation (médiane, 9 sur 10)", () => {
    expect(r.medDaysToCancel).toBe(3); // [3, 5] → médiane 3
    expect(r.p90DaysToCancel).toBe(5);
  });
  it("isole les résiliations dues au bug webhook (sans les supprimer)", () => {
    expect(r.bugAttributed).toBe(1); // m3 (annulé avant webhookFix)
    expect(r.resiliations).toBe(2); // m3 reste comptée
  });
  it("renouvellement : arrivés à échéance, renouvelés, taux", () => {
    expect(r.reachedTerm).toBe(4);
    expect(r.renewed).toBe(1); // m1 (≥2 paiements)
    expect(r.renewalRate).toBe(25);
    expect(r.avgRenewals).toBe(0.5); // (2+0+0+0)/4
    expect(r.sampleSufficient).toBe(true); // 4 ≥ seuil 2
  });
  it("ventile par offre", () => {
    const planM = r.byPlan.find((p) => p.planId === "plan_m");
    expect(planM).toEqual({ planId: "plan_m", clients: 2, resiliations: 2, expirations: 2 });
  });
  it("échantillon insuffisant quand peu d'arrivés à échéance", () => {
    const few = computeChurn([memberships[0]], {
      now,
      periodStartMs: 10 * DAY,
      webhookFixMs: 20 * DAY,
      sampleThreshold: 10,
    });
    expect(few.sampleSufficient).toBe(false);
  });
});
