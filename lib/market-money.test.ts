import { describe, expect, it } from "vitest";
import { grossInReference, netInReference } from "../convex/marketMoney";
import {
  summarizeWhopRevenue,
  type WhopPaymentLike,
} from "../convex/whopRevenue";

const paye = (currency: string, gross: number, net: number): WhopPaymentLike => ({
  status: "paid",
  grossAmount: gross,
  feeAmount: gross - net,
  netAmount: net,
  refundedAmount: 0,
  currency,
});

/** Taux de Snytch en prod au 16/09/2026. */
const FX = [
  { from: "usd", rate: 0.86 },
  { from: "rsd", rate: 0.00852 },
];

// Forme de la prod : un historique en euros, dollars et dinars ; les trois
// abonnements serbes à 599 RSD du 16/09.
const serbes = [paye("rsd", 599, 535.28), paye("rsd", 599, 535.28), paye("rsd", 599, 535.27)];
const historique = [paye("eur", 9.99, 9.2), paye("usd", 4.99, 4.47), ...serbes];

describe("montants d'un sous-lot dans la devise du revenu", () => {
  const ref = summarizeWhopRevenue(historique, FX);

  it("un lot 100 % dinars est converti (le résumé seul ne le fait pas)", () => {
    // Le défaut d'origine, gardé visible : 1 605,83 « € » pour ≈ 13,68 €.
    expect(summarizeWhopRevenue(serbes, FX).net).toBeCloseTo(1605.83, 2);
    expect(netInReference(serbes, ref)).toBeCloseTo(13.68, 2);
  });

  it("un paiement en dollars seul est converti", () => {
    expect(netInReference([paye("usd", 4.99, 4.47)], ref)).toBeCloseTo(3.84, 2);
  });

  it("un lot en euros est inchangé", () => {
    expect(netInReference([paye("eur", 9.99, 9.2)], ref)).toBe(9.2);
  });

  it("le prix brut suit la même conversion", () => {
    expect(grossInReference(paye("rsd", 599, 535.28), ref)).toBeCloseTo(5.1, 2);
    expect(grossInReference(paye("eur", 9.99, 9.2), ref)).toBe(9.99);
  });

  it("devises non convertibles : zéro, jamais une somme mélangée", () => {
    const refSansTaux = summarizeWhopRevenue(historique, []);
    expect(refSansTaux.mixedCurrency).toBe(true);
    expect(netInReference(serbes, refSansTaux)).toBe(0);
  });
});
