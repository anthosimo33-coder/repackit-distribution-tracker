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
    // Résilié PUIS expiré, payé APRÈS la panne : résiliation + expiration.
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
    // Payé PENDANT la panne (firstPaidAt < webhookFix) → paidDuringOutage.
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
    // RÉSILIÉ mais accès encore valide, expire bientôt → perte à venir.
    m({
      membershipId: "m6",
      planId: "plan_w",
      firstPaidAt: 88 * DAY,
      canceledAt: 95 * DAY,
      accessEndsAt: 103 * DAY, // now=100d, dans l'horizon 7 j
      valid: true,
      status: "active",
      paidCount: 1,
    }),
    // Non payant → exclu du dénominateur.
    m({ membershipId: "m5", paidCount: 0 }),
  ];
  const r = computeChurn(memberships, {
    now,
    periodStartMs: 10 * DAY,
    webhookFixMs: 20 * DAY,
    horizonMs: 7 * DAY,
    sampleThreshold: 2,
  });

  it("ne compte que les clients payants", () => {
    expect(r.clients).toBe(5);
  });
  it("sépare résiliations et expirations", () => {
    expect(r.resiliations).toBe(3); // m2, m3, m6
    expect(r.expirations).toBe(2); // m2, m3 (accès perdu sur la période)
  });
  it("délais en ms (médiane, 9 sur 10) — l'UI formate min/h/j", () => {
    expect(r.medMsToCancel).toBe(5 * DAY); // [3, 5, 7] j → médiane 5 j
    expect(r.p90MsToCancel).toBe(7 * DAY);
  });
  it("détaille chaque résiliation, trié par délai, avec le proxy panne", () => {
    expect(r.resiliationDetails).toHaveLength(3);
    expect(r.resiliationDetails[0].membershipId).toBe("m3"); // délai le plus court
    expect(r.resiliationDetails[0].delayMs).toBe(3 * DAY);
    const d3 = r.resiliationDetails.find((d) => d.membershipId === "m3");
    const d2 = r.resiliationDetails.find((d) => d.membershipId === "m2");
    expect(d3?.paidDuringOutage).toBe(true); // payé avant webhookFix
    expect(d2?.paidDuringOutage).toBe(false); // payé après
  });
  it("montre ce qui ARRIVE : expirations à venir + clients projetés", () => {
    expect(r.upcomingExpirations.map((u) => u.membershipId)).toEqual(["m6"]);
    expect(r.projectedClients).toBe(4); // 5 clients − 1 perte à venir
  });
  it("renouvellement : arrivés à échéance, renouvelés, taux", () => {
    expect(r.reachedTerm).toBe(5);
    expect(r.renewed).toBe(1); // m1 (≥2 paiements)
    expect(r.renewalRate).toBe(20);
    expect(r.sampleSufficient).toBe(true); // 5 ≥ seuil 2
  });
  it("échantillon insuffisant quand peu d'arrivés à échéance", () => {
    const few = computeChurn([memberships[0]], {
      now,
      periodStartMs: 10 * DAY,
      webhookFixMs: 20 * DAY,
      horizonMs: 7 * DAY,
      sampleThreshold: 10,
    });
    expect(few.sampleSufficient).toBe(false);
  });
});
