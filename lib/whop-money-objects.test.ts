import { describe, it, expect } from "vitest";
import { normalizeWhopPayment, normalizeWhopPlan, normalizeWhopMembership } from "../convex/whopApi";

/**
 * Format Whop des comptes récents (constaté le 21/11/2026 sur BLUSH, après #552) :
 * chaque montant est un objet Money `{ amount: "9.90", currency, decimals }` et non
 * plus un nombre ; l'offre arrive en `variant_id` (préfixe plan_) au lieu de
 * `plan.id`, l'abonnement en `membership_id` au lieu de `membership.id`.
 * Lu avec l'ancien code : 52 paiements payés, tous à 0 €, offre vide.
 */
const money = (amount: string) => ({ amount, currency: "eur", decimals: 2, display_decimals: 2 });

const NEW_FORMAT_PAYMENT = {
  id: "pay_new1",
  status: "paid",
  substatus: "succeeded",
  billing_reason: "one_time",
  currency: "eur",
  total: money("9.90"),
  subtotal: money("9.90"),
  amount_after_fees: money("9.24"),
  refunded_amount: money("0"),
  usd_total: money("10.68"),
  paid_at: "2026-11-20T10:00:00Z",
  variant_id: "plan_rapport3bulles",
  product_id: "prod_9amvRy52vqQ78",
  membership_id: "mem_abc",
};

describe("paiement au format Money (comptes Whop récents)", () => {
  it("lit le brut, le net et le remboursé dans les objets Money", () => {
    const p = normalizeWhopPayment(NEW_FORMAT_PAYMENT)!;
    expect(p.grossAmount).toBe(9.9);
    expect(p.netAmount).toBe(9.24);
    expect(p.refundedAmount).toBe(0);
    expect(p.currency).toBe("eur");
    expect(p.status).toBe("paid");
  });

  it("sans application_fee, les frais sont l'écart entre le brut et le net", () => {
    const p = normalizeWhopPayment(NEW_FORMAT_PAYMENT)!;
    expect(p.feeAmount).toBe(0.66);
  });

  it("rattache l'offre et l'abonnement par variant_id et membership_id", () => {
    const p = normalizeWhopPayment(NEW_FORMAT_PAYMENT)!;
    expect(p.planId).toBe("plan_rapport3bulles");
    expect(p.membershipId).toBe("mem_abc");
  });

  it("un remboursement partiel en Money est lu", () => {
    const p = normalizeWhopPayment({ ...NEW_FORMAT_PAYMENT, refunded_amount: money("4.95") })!;
    expect(p.refundedAmount).toBe(4.95);
  });
});

describe("ancien format (Snytch) : rien ne change", () => {
  it("montants en nombres, frais dans application_fee, offre dans plan.id", () => {
    const p = normalizeWhopPayment({
      id: "pay_old1",
      substatus: "succeeded",
      currency: "eur",
      total: 9.99,
      amount_after_fees: 9.31,
      application_fee: { amount: 0.68 },
      refunded_amount: 0,
      paid_at: "2026-11-20T10:00:00Z",
      plan: { id: "plan_old" },
      membership: { id: "mem_old" },
    })!;
    expect(p.grossAmount).toBe(9.99);
    expect(p.netAmount).toBe(9.31);
    expect(p.feeAmount).toBe(0.68);
    expect(p.planId).toBe("plan_old");
    expect(p.membershipId).toBe("mem_old");
  });
});

describe("offres et abonnements au format récent", () => {
  it("le prix d'une offre en Money est lu", () => {
    const plan = normalizeWhopPlan({ id: "plan_a", title: "Le rapport complet", renewal_price: money("9.90"), currency: "eur" });
    expect(plan?.price).toBe(9.9);
  });

  it("l'abonnement rattache son offre par variant_id", () => {
    const m = normalizeWhopMembership({ id: "mem_abc", status: "active", variant_id: "plan_rapport3bulles", user_id: "user_1" });
    expect(m?.planId).toBe("plan_rapport3bulles");
  });
});
