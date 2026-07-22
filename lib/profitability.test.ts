import { describe, it, expect } from "vitest";
import {
  computeMargin,
  computeRpm,
  viewsForToggle,
  computeProfitability,
  type ProfitabilityInput,
} from "./profitability";

describe("computeMargin — revenu net − coût créateurs", () => {
  it("marge positive", () => {
    expect(computeMargin(1000, 400)).toBe(600);
  });
  it("marge négative (coût > revenu)", () => {
    expect(computeMargin(300, 500)).toBe(-200);
  });
  it("arrondi au centime", () => {
    expect(computeMargin(100.005, 0)).toBe(100.01);
  });
});

describe("computeRpm — revenu net pour 1000 vues", () => {
  it("1000$ / 500k vues → 2$ RPM", () => {
    expect(computeRpm(1000, 500_000)).toBe(2);
  });
  it("moins de vues → RPM plus élevé (sans warmup = vrai RPM)", () => {
    expect(computeRpm(1000, 400_000)).toBe(2.5);
  });
  it("0 vue → null (RPM indéfini)", () => {
    expect(computeRpm(1000, 0)).toBeNull();
    expect(computeRpm(1000, -5)).toBeNull();
  });
});

describe("viewsForToggle — seul levier du toggle", () => {
  const split = { monetizedViews: 400_000, warmupViews: 100_000 };
  it("sans warmup → vues monétisées seules", () => {
    expect(viewsForToggle(split, false)).toBe(400_000);
  });
  it("avec warmup → monétisées + warmup", () => {
    expect(viewsForToggle(split, true)).toBe(500_000);
  });
});

describe("computeProfitability — le toggle change les vues/RPM, JAMAIS le revenu ni le coût", () => {
  const input: ProfitabilityInput = {
    revenueNet: 1000,
    creatorCost: 400,
    monetizedViews: 400_000, // posts non-warmup
    warmupViews: 100_000, // posts warmup
  };

  it("sans warmup = vrai RPM business (dénominateur = vues monétisées)", () => {
    const m = computeProfitability(input, false);
    expect(m.views).toBe(400_000);
    expect(m.rpm).toBe(2.5); // 1000 / (400k/1000)
    expect(m.revenueNet).toBe(1000);
    expect(m.creatorCost).toBe(400);
    expect(m.margin).toBe(600);
  });

  it("avec warmup = RPM DILUÉ (dénominateur = toutes les vues)", () => {
    const m = computeProfitability(input, true);
    expect(m.views).toBe(500_000);
    expect(m.rpm).toBe(2); // 1000 / (500k/1000) < 2.5 → dilué
  });

  it("TOGGLE : les vues (et le RPM) changent, le revenu Whop NE bouge PAS", () => {
    const off = computeProfitability(input, false);
    const on = computeProfitability(input, true);
    // Vues + RPM changent…
    expect(on.views).not.toBe(off.views);
    expect(on.rpm).not.toBe(off.rpm);
    expect(on.rpm!).toBeLessThan(off.rpm!); // avec warmup = dilué
    // …mais le revenu Whop, le coût et la marge sont INVARIANTS.
    expect(on.revenueNet).toBe(off.revenueNet);
    expect(on.creatorCost).toBe(off.creatorCost);
    expect(on.margin).toBe(off.margin);
  });

  it("sans post warmup : le toggle n'a aucun effet (warmupViews = 0)", () => {
    const noWarmup: ProfitabilityInput = { ...input, warmupViews: 0 };
    const off = computeProfitability(noWarmup, false);
    const on = computeProfitability(noWarmup, true);
    expect(on.views).toBe(off.views);
    expect(on.rpm).toBe(off.rpm);
  });
});
