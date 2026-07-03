import { describe, it, expect } from "vitest";
import { computeEarnings } from "./earnings";

describe("computeEarnings", () => {
  it("base seule (pas de bonus ni prime)", () => {
    expect(computeEarnings({ basePerPost: 50 }, 100_000)).toEqual({
      base: 50,
      viewBonus: 0,
      bounty: 0,
      total: 50,
    });
  });

  it("bonus aux vues continu", () => {
    // 2 €/1k × 5000 vues = 10 €
    expect(computeEarnings({ basePerPost: 50, viewBonusPer1k: 2 }, 5000)).toEqual(
      { base: 50, viewBonus: 10, bounty: 0, total: 60 },
    );
  });

  it("primes cumulatives : tous les paliers atteints s'additionnent", () => {
    const rate = {
      basePerPost: 10,
      bounties: [
        { thresholdViews: 100_000, amount: 20 },
        { thresholdViews: 1_000_000, amount: 30 },
      ],
    };
    // 1,2 M vues : base 10 + primes 20+30=50 = 60 (sous le plafond 150).
    expect(computeEarnings(rate, 1_200_000)).toEqual({
      base: 10,
      viewBonus: 0,
      bounty: 50,
      total: 60,
    });
  });

  it("seul le palier atteint paie", () => {
    const rate = {
      basePerPost: 0,
      bounties: [
        { thresholdViews: 100_000, amount: 100 },
        { thresholdViews: 1_000_000, amount: 500 },
      ],
    };
    expect(computeEarnings(rate, 100_000).bounty).toBe(100); // 1er palier pile atteint
    expect(computeEarnings(rate, 99_999).bounty).toBe(0); // sous le 1er palier
    expect(computeEarnings(rate, 500_000).bounty).toBe(100); // entre les deux
  });

  it("vues négatives clampées à 0", () => {
    expect(computeEarnings({ basePerPost: 10, viewBonusPer1k: 5 }, -100)).toEqual(
      { base: 10, viewBonus: 0, bounty: 0, total: 10 },
    );
  });

  it("arrondi au centime", () => {
    // 3 €/1k × 1234 vues = 3.702 → 3.70
    expect(computeEarnings({ basePerPost: 0, viewBonusPer1k: 3 }, 1234).viewBonus).toBe(
      3.7,
    );
  });
});

describe("computeEarnings — plafond 150 €/vidéo (global tous projets)", () => {
  it("total > 150 → capé à 150 (base gardée, viewBonus rogné)", () => {
    // brut : base 50 + viewBonus (2×1M/1000=2000) = 2050 → 150 ; viewBonus → 100.
    const r = computeEarnings({ basePerPost: 50, viewBonusPer1k: 2 }, 1_000_000);
    expect(r.total).toBe(150);
    expect(r.base).toBe(50);
    expect(r.viewBonus).toBe(100);
    expect(r.bounty).toBe(0);
  });

  it("122M vues → 150 (exemple fondateur)", () => {
    expect(
      computeEarnings({ basePerPost: 0, viewBonusPer1k: 1 }, 122_000_000).total,
    ).toBe(150);
  });

  it("primes incluses dans le plafond (rogne viewBonus puis primes)", () => {
    const rate = {
      basePerPost: 40,
      viewBonusPer1k: 1,
      bounties: [{ thresholdViews: 100_000, amount: 100 }],
    };
    // brut : 40 + 1000 + 100 = 1140 → 150. room 110 : viewBonus 110, prime 0.
    const r = computeEarnings(rate, 1_000_000);
    expect(r.total).toBe(150);
    expect(r.base).toBe(40);
    expect(r.viewBonus).toBe(110);
    expect(r.bounty).toBe(0);
  });

  it("sous 150 → inchangé", () => {
    expect(
      computeEarnings({ basePerPost: 50, viewBonusPer1k: 2 }, 5000).total,
    ).toBe(60);
  });
});
