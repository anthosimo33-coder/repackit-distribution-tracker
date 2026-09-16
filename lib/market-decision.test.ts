import { describe, expect, it } from "vitest";
import { decideMarket, DECISION } from "./market-decision";

/** Formes de la prod au 16/09/2026 (7 jours), en euros. */
const base = {
  promoCostComparable: 0,
  acquisitionReturn: null as number | null,
  clients: 0,
  checkouts: 0,
  trafficClients: 0,
  visitors: 0,
};

describe("verdict d'un marché", () => {
  it("Francophonie : retour ×3,52 et 98 clients → accélérer", () => {
    const d = decideMarket({
      ...base,
      promoCostComparable: 313.72,
      acquisitionReturn: 3.52,
      clients: 98,
      checkouts: 698,
      trafficClients: 127,
      visitors: 7348,
    });
    expect(d.verdict).toBe("accelerer");
    expect(d.checkoutToClient).toBeCloseTo(0.182, 3);
  });

  it("Balkans : 491 checkouts, 7 clients → réparer, pas couper", () => {
    const d = decideMarket({
      ...base,
      promoCostComparable: 46.89,
      acquisitionReturn: 0.41,
      clients: 7,
      checkouts: 491,
      trafficClients: 7,
      visitors: 3731,
    });
    // Le retour seul dirait « couper » (< ×0,5) : c'est le paiement qui casse.
    expect(d.verdict).toBe("reparer");
  });

  it("États-Unis : retour ×0,13, entonnoir sain → couper", () => {
    const d = decideMarket({
      ...base,
      promoCostComparable: 73.42,
      acquisitionReturn: 0.13,
      clients: 1,
      checkouts: 11,
      trafficClients: 1,
      visitors: 113,
    });
    // 11 checkouts : sous le seuil, l'étape de paiement n'est pas jugée.
    expect(d.checkoutToClient).toBeNull();
    expect(d.verdict).toBe("couper");
  });

  it("retour ≥ ×2 mais trop peu de clients → surveiller", () => {
    expect(
      decideMarket({ ...base, promoCostComparable: 48.2, acquisitionReturn: 2.4, clients: 12 })
        .verdict,
    ).toBe("surveiller");
  });

  it("moins de 30 € dépensés → trop tôt, quel que soit le retour", () => {
    expect(
      decideMarket({ ...base, promoCostComparable: 29.99, acquisitionReturn: 0 }).verdict,
    ).toBe("trop_tot");
    expect(
      decideMarket({ ...base, promoCostComparable: DECISION.minSpend, acquisitionReturn: 0 })
        .verdict,
    ).toBe("couper");
  });

  it("un bon retour ne passe pas en « réparer » même si le paiement est faible", () => {
    expect(
      decideMarket({
        ...base,
        promoCostComparable: 120.5,
        acquisitionReturn: 2.6,
        clients: 24,
        checkouts: 600,
        trafficClients: 24,
        visitors: 5000,
      }).verdict,
    ).toBe("accelerer");
  });

  it("aucune dépense sur le marché → sans dépense, pas « trop tôt »", () => {
    expect(
      decideMarket({ ...base, promoCostComparable: 0, acquisitionReturn: null, clients: 1 })
        .verdict,
    ).toBe("sans_depense");
  });

  it("coût non convertible → inconnu, jamais un verdict", () => {
    expect(
      decideMarket({ ...base, promoCostComparable: null, acquisitionReturn: null }).verdict,
    ).toBe("inconnu");
  });
});
