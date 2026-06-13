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
      basePerPost: 50,
      viewBonusPer1k: 2,
      bounties: [
        { thresholdViews: 100_000, amount: 100 },
        { thresholdViews: 1_000_000, amount: 500 },
      ],
    };
    // 1,2 M vues : base 50 + bonus 2*1.2M/1000=2400 + primes 100+500=600
    expect(computeEarnings(rate, 1_200_000)).toEqual({
      base: 50,
      viewBonus: 2400,
      bounty: 600,
      total: 3050,
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
