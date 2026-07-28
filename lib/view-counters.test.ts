import { describe, it, expect } from "vitest";
import {
  isPromoPost,
  computeViewCounters,
  VIEW_COUNTER_USAGE,
} from "../convex/viewCounters";

/**
 * Verrou de la règle A2 : trois compteurs distincts, JAMAIS additionnés, et
 * `payables ≠ promo` dès qu'un post est warmup ET rémunéré (« cas Kelly »).
 */
describe("isPromoPost", () => {
  it("promo = non-warmup (point de décision unique)", () => {
    expect(isPromoPost({ isWarmup: false })).toBe(true);
    expect(isPromoPost({ isWarmup: true })).toBe(false);
  });
});

describe("computeViewCounters", () => {
  it("sans warmup : les trois compteurs coïncident", () => {
    const c = computeViewCounters([
      { views: 1000, isWarmup: false },
      { views: 500, isWarmup: false },
    ]);
    expect(c).toEqual({ totales: 1500, payables: 1500, promo: 1500 });
  });

  it("cas Kelly (warmup + rémunéré) : payable OUI, promo NON → payables ≠ promo", () => {
    const c = computeViewCounters([
      { views: 1000, isWarmup: false }, // normal → les trois
      { views: 500, isWarmup: true, remunere: true }, // Kelly → payable seul
      { views: 200, isWarmup: true }, // chauffe pure → totales seul
    ]);
    expect(c.totales).toBe(1700);
    expect(c.payables).toBe(1500); // 1000 + 500 (Kelly rémunéré)
    expect(c.promo).toBe(1000); // 1000 (seul non-warmup)
    expect(c.payables).not.toBe(c.promo);
  });

  it("totales borne les deux autres mais n'en est PAS la somme (non additifs)", () => {
    const c = computeViewCounters([
      { views: 100, isWarmup: false },
      { views: 100, isWarmup: false },
      { views: 100, isWarmup: false },
    ]);
    expect(c.totales).toBeGreaterThanOrEqual(c.payables);
    expect(c.totales).toBeGreaterThanOrEqual(c.promo);
    // 300 ≠ 300 + 300 : additionner payables et promo double-compterait.
    expect(c.totales).not.toBe(c.payables + c.promo);
  });

  it("vues négatives ramenées à 0 ; liste vide = tout à 0", () => {
    expect(computeViewCounters([{ views: -50, isWarmup: false }]).totales).toBe(0);
    expect(computeViewCounters([])).toEqual({ totales: 0, payables: 0, promo: 0 });
  });

  it("expose un libellé d'usage pour CHAQUE compteur (la carte déclare lequel)", () => {
    expect(VIEW_COUNTER_USAGE.totales).toMatch(/palier/i);
    expect(VIEW_COUNTER_USAGE.payables).toMatch(/paie/i);
    expect(VIEW_COUNTER_USAGE.promo).toMatch(/conversion/i);
  });
});
