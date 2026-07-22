import { describe, it, expect } from "vitest";
import {
  normalizeWhopStatus,
  whopNetContribution,
  summarizeWhopRevenue,
  type WhopPaymentLike,
} from "./whop-revenue";

/** Paiement encaissé de référence : brut 100, frais 5, net 95. */
function paid(over: Partial<WhopPaymentLike> = {}): WhopPaymentLike {
  return {
    status: "paid",
    grossAmount: 100,
    feeAmount: 5,
    netAmount: 95,
    refundedAmount: 0,
    currency: "usd",
    ...over,
  };
}

describe("normalizeWhopStatus — substatus Whop v1 → union", () => {
  it("encaissés → paid", () => {
    for (const s of [
      "succeeded",
      "paid",
      "partially_refunded",
      "dispute_won",
      "resolution_won",
    ]) {
      expect(normalizeWhopStatus(s)).toBe("paid");
    }
  });

  it("remboursés / clawback → refunded", () => {
    for (const s of ["refunded", "auto_refunded", "dispute_lost", "resolution_lost"]) {
      expect(normalizeWhopStatus(s)).toBe("refunded");
    }
  });

  it("échoués → failed, en attente → pending", () => {
    expect(normalizeWhopStatus("failed")).toBe("failed");
    expect(normalizeWhopStatus("past_due")).toBe("failed");
    expect(normalizeWhopStatus("uncollectible")).toBe("failed");
    expect(normalizeWhopStatus("pending")).toBe("pending");
    expect(normalizeWhopStatus("incomplete")).toBe("pending");
  });

  it("dispute en cours → disputed", () => {
    expect(normalizeWhopStatus("dispute_under_review")).toBe("disputed");
    expect(normalizeWhopStatus("open_dispute")).toBe("disputed");
  });

  it("insensible à la casse/espaces ; inconnu → other", () => {
    expect(normalizeWhopStatus("  Succeeded ")).toBe("paid");
    expect(normalizeWhopStatus("void")).toBe("other");
    expect(normalizeWhopStatus("some_future_status")).toBe("other");
  });
});

describe("whopNetContribution — net de pilotage par paiement", () => {
  it("paiement encaissé → net settlé (amount_after_fees)", () => {
    expect(whopNetContribution(paid())).toBe(95);
  });

  it("échoué / en attente / other → 0 (ne gonfle PAS le net)", () => {
    expect(whopNetContribution(paid({ status: "failed" }))).toBe(0);
    expect(whopNetContribution(paid({ status: "pending" }))).toBe(0);
    expect(whopNetContribution(paid({ status: "other" }))).toBe(0);
  });

  it("entièrement remboursé (status refunded) → 0", () => {
    expect(
      whopNetContribution(paid({ status: "refunded", refundedAmount: 100 })),
    ).toBe(0);
  });

  it("remboursement PARTIEL → net diminué (95 − 30 = 65)", () => {
    expect(whopNetContribution(paid({ refundedAmount: 30 }))).toBe(65);
  });

  it("remboursé au-delà du net → planché à 0 (jamais négatif)", () => {
    expect(whopNetContribution(paid({ refundedAmount: 200 }))).toBe(0);
  });

  it("dispute en cours → compté (argent encore sur le solde)", () => {
    expect(whopNetContribution(paid({ status: "disputed" }))).toBe(95);
  });

  it("montants non finis → 0 (jamais NaN)", () => {
    expect(whopNetContribution(paid({ netAmount: NaN }))).toBe(0);
  });
});

describe("summarizeWhopRevenue — agrégation période", () => {
  it("brut/frais/net + comptes sur des paiements encaissés", () => {
    const s = summarizeWhopRevenue([paid(), paid(), paid({ status: "failed" })]);
    expect(s.net).toBe(190); // 2 × 95 (le failed ne compte pas)
    expect(s.gross).toBe(200);
    expect(s.fees).toBe(10);
    expect(s.paymentCount).toBe(2);
    expect(s.currency).toBe("usd");
  });

  it("un paiement échoué ne GONFLE pas le net", () => {
    const withoutFailed = summarizeWhopRevenue([paid()]);
    const withFailed = summarizeWhopRevenue([
      paid(),
      paid({ status: "failed", netAmount: 9999 }),
    ]);
    expect(withFailed.net).toBe(withoutFailed.net); // 95, inchangé
  });

  it("un REMBOURSEMENT fait BAISSER le net (total)", () => {
    const before = summarizeWhopRevenue([paid(), paid()]);
    // Le 2e paiement passe entièrement remboursé.
    const after = summarizeWhopRevenue([
      paid(),
      paid({ status: "refunded", refundedAmount: 100 }),
    ]);
    expect(before.net).toBe(190);
    expect(after.net).toBe(95);
    expect(after.net).toBeLessThan(before.net);
    expect(after.refunded).toBe(100); // transparence
    expect(after.refundCount).toBe(1);
  });

  it("remboursement PARTIEL fait baisser le net proportionnellement", () => {
    const after = summarizeWhopRevenue([paid(), paid({ refundedAmount: 40 })]);
    expect(after.net).toBe(150); // 95 + (95 − 40)
    expect(after.refunded).toBe(40);
  });

  it("liste vide → tout à 0, devise null", () => {
    expect(summarizeWhopRevenue([])).toEqual({
      net: 0,
      gross: 0,
      fees: 0,
      refunded: 0,
      paymentCount: 0,
      refundCount: 0,
      currency: null,
    });
  });
});
