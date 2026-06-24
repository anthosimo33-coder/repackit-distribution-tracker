import { describe, it, expect } from "vitest";
import {
  needsPaymentInfo,
  amountOwed,
  shouldPromptPaymentInfo,
} from "./creator-payment";

describe("needsPaymentInfo — coordonnées de paiement incomplètes", () => {
  it("profil non chargé (null/undefined) → false (pas de faux positif)", () => {
    expect(needsPaymentInfo(null)).toBe(false);
    expect(needsPaymentInfo(undefined)).toBe(false);
  });

  it("méthode ou coordonnées manquantes → true", () => {
    expect(needsPaymentInfo({ paymentMethod: null, paymentDetails: null })).toBe(
      true,
    );
    expect(
      needsPaymentInfo({ paymentMethod: "sepa", paymentDetails: null }),
    ).toBe(true);
    expect(
      needsPaymentInfo({ paymentMethod: null, paymentDetails: "FR76…" }),
    ).toBe(true);
  });

  it("chaînes vides ou blanches comptent comme manquantes", () => {
    expect(
      needsPaymentInfo({ paymentMethod: "  ", paymentDetails: "FR76…" }),
    ).toBe(true);
    expect(
      needsPaymentInfo({ paymentMethod: "sepa", paymentDetails: "   " }),
    ).toBe(true);
  });

  it("méthode ET coordonnées présentes → false", () => {
    expect(
      needsPaymentInfo({ paymentMethod: "paypal", paymentDetails: "moi@x.fr" }),
    ).toBe(false);
  });
});

describe("amountOwed — total dû non payé", () => {
  it("liste non chargée → 0", () => {
    expect(amountOwed(null)).toBe(0);
    expect(amountOwed(undefined)).toBe(0);
    expect(amountOwed([])).toBe(0);
  });

  it("somme uniquement les périodes non payées", () => {
    const rows = [
      { status: "accruing", totalDue: 120 },
      { status: "paid", totalDue: 90 },
      { status: "pending", totalDue: 30 },
    ];
    expect(amountOwed(rows)).toBe(150);
  });

  it("tout payé → 0", () => {
    expect(
      amountOwed([
        { status: "paid", totalDue: 50 },
        { status: "paid", totalDue: 10 },
      ]),
    ).toBe(0);
  });
});

describe("shouldPromptPaymentInfo — bandeau si gains dus ET coordonnées manquantes", () => {
  const incomplete = { paymentMethod: "sepa", paymentDetails: null };
  const complete = { paymentMethod: "sepa", paymentDetails: "FR76…" };
  const owed = [{ status: "accruing", totalDue: 120 }];
  const nothingOwed = [{ status: "paid", totalDue: 120 }];

  it("gains dus + coordonnées incomplètes → true", () => {
    expect(shouldPromptPaymentInfo(incomplete, owed)).toBe(true);
  });

  it("coordonnées complètes → false même avec gains dus", () => {
    expect(shouldPromptPaymentInfo(complete, owed)).toBe(false);
  });

  it("rien dû → false même si coordonnées incomplètes", () => {
    expect(shouldPromptPaymentInfo(incomplete, nothingOwed)).toBe(false);
  });

  it("données non chargées → false (pas de flash au chargement)", () => {
    expect(shouldPromptPaymentInfo(null, owed)).toBe(false);
    expect(shouldPromptPaymentInfo(incomplete, undefined)).toBe(false);
  });
});
