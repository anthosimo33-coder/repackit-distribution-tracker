import { describe, it, expect } from "vitest";
import {
  assembleProfitability,
  assembleRevenueAndCosts,
  lotSlice,
  type ProfitabilityBase,
  type ProfitabilityCosts,
  type ProfitabilityCreatorsPart,
  type ProfitabilityRevenue,
} from "../convex/profitabilityMath";
import type { Id } from "../convex/_generated/dataModel";

/**
 * L'outil MCP `rentabilite` assemble la carte à partir de LOTS de créatrices
 * (une query par lot : en une seule, le calcul dépassait la limite d'exécution
 * d'une query sur Snytch, 2026-10-19). Toutes doivent rendre EXACTEMENT la même
 * réponse que la boucle unique, quel que soit le découpage.
 *
 * La carte, elle, lit le revenu et le coût en LOTS contigus (`lotSlice`), une
 * query chacun — même exigence.
 *
 * Forme de la prod Snytch : coûts à décimales (les arrondis se cumulent), un
 * mois en cours non figé, un mois figé chez l'une et pas chez l'autre, des vues
 * facturées dans un mois sans publication rangée sous lui.
 */

const base: ProfitabilityBase = {
  configured: true,
  payCurrency: "usd",
  fxRateToRevenue: 0.86,
  currentPeriod: "2026-10",
  revenueByMonth: [
    { period: "2026-10", revenueNet: 5593.21, mixedCurrency: false },
    { period: "2026-09", revenueNet: 7012.4, mixedCurrency: false },
  ],
  totalRevenue: {
    net: 12605.61,
    currency: "eur",
    mixedCurrency: false,
    conversions: [{ from: "usd", rate: 0.86 }],
    mixedCurrencyPresent: false,
    currenciesPresent: ["eur", "usd"],
  },
  creatorIds: ["c1", "c2", "c3", "c4", "c5", "c6"] as Id<"creators">[],
  trackedViewsByMonth: [
    { period: "2026-10", views: 1_900_000 },
    { period: "2026-09", views: 2_400_000 },
  ],
  trackedViewsTotal: 4_300_000,
  periode: {
    du: "2026-10-12",
    au: "2026-10-18",
    revenueNet: 2858.69,
    revenueByDay: [{ jour: "2026-10-12", revenueNet: 512.33 }],
  },
};

const createatrices: ProfitabilityCreatorsPart["creators"] = [
  { months: [{ period: "2026-10", cost: 333.335, billedViews: 400_001, settled: false }, { period: "2026-09", cost: 120.1, billedViews: 90_000, settled: true }] },
  { months: [{ period: "2026-10", cost: 0.015, billedViews: 7, settled: false }] },
  { months: [{ period: "2026-09", cost: 811.07, billedViews: 610_333, settled: false }] },
  { months: [{ period: "2026-08", cost: 200, billedViews: 12, settled: true }] },
  { months: [] },
  { months: [{ period: "2026-10", cost: 99.995, billedViews: 250_000, settled: false }, { period: "2026-09", cost: 0.004, billedViews: 1, settled: true }] },
];
const video = (n: number) => ({
  plafond: 1000 * (n + 1),
  posts: [{ publicationId: `p${n}`, publishedAt: n, coupure: n + 30 }],
});
const videos = createatrices.map((_, i) => [video(i)]);

/** Le même ensemble de créatrices, découpé en lots de `taille`. */
function enLots(taille: number): ProfitabilityCreatorsPart[] {
  const parts: ProfitabilityCreatorsPart[] = [];
  for (let i = 0; i < createatrices.length; i += taille) {
    parts.push({
      creators: createatrices.slice(i, i + taille),
      videos: videos.slice(i, i + taille).flat(),
    });
  }
  return parts;
}

describe("rentabilité assemblée par lots de créatrices", () => {
  const unSeulLot = assembleProfitability(base, enLots(createatrices.length));

  it.each([1, 2, 4, 5])("des lots de %i rendent la réponse de la carte", (taille) => {
    expect(assembleProfitability(base, enLots(taille))).toEqual(unSeulLot);
  });

  it("additionne et fige comme la boucle unique", () => {
    const oct = unSeulLot.months.find((m) => m.period === "2026-10")!;
    expect(oct.creatorCost).toBe(433.35);
    expect(oct.paidViews).toBe(650_008);
    expect(oct.settled).toBe(false);
    const sept = unSeulLot.months.find((m) => m.period === "2026-09")!;
    // Une créatrice non figée suffit : le mois n'est pas figé.
    expect(sept.settled).toBe(false);
    // Mois sans publication rangée sous lui, mais facturé : coût ET vues.
    const aout = unSeulLot.months.find((m) => m.period === "2026-08")!;
    expect(aout).toMatchObject({ creatorCost: 200, paidViews: 12, unpaidViews: 0, settled: true });
    expect(unSeulLot.months.map((m) => m.period)).toEqual(["2026-10", "2026-09", "2026-08"]);
    expect(unSeulLot.periode?.videos.map((v) => v.plafond)).toEqual(
      [1000, 2000, 3000, 4000, 5000, 6000],
    );
  });
});

describe("carte : revenu + lots de coût contigus", () => {
  const unSeulLot = assembleProfitability(base, enLots(createatrices.length));
  const { trackedViewsByMonth, trackedViewsTotal } = base;
  /** Ce que rend `getProfitabilityRevenue` : la base sans ce qui vient des lots. */
  const revenu: ProfitabilityRevenue = {
    payCurrency: base.payCurrency,
    fxRateToRevenue: base.fxRateToRevenue,
    currentPeriod: base.currentPeriod,
    revenueByMonth: base.revenueByMonth,
    totalRevenue: base.totalRevenue,
    periode: base.periode,
  };

  /** Ce que rendent les `lots` queries `getProfitabilityCosts` de la carte. */
  function lotsDeLaCarte(lots: number): ProfitabilityCosts[] {
    return Array.from({ length: lots }, (_, k) => {
      const ids = lotSlice(base.creatorIds, k, lots);
      const debut = base.creatorIds.indexOf(ids[0]!);
      return {
        creatorIds: ids,
        trackedViewsByMonth,
        trackedViewsTotal,
        part: {
          creators: createatrices.slice(debut, debut + ids.length),
          videos: videos.slice(debut, debut + ids.length).flat(),
        },
      };
    });
  }

  it.each([1, 2, 3, 6])("%i lot(s) rendent la réponse de la boucle unique", (lots) => {
    expect(assembleRevenueAndCosts(revenu, lotsDeLaCarte(lots))).toEqual(unSeulLot);
  });

  it("les lots recouvrent la liste, sans trou ni doublon, dans l'ordre", () => {
    const liste = Array.from({ length: 34 }, (_, i) => i);
    for (const lots of [1, 2, 3, 5, 34, 40]) {
      const tranches = Array.from({ length: lots }, (_, k) => lotSlice(liste, k, lots));
      expect(tranches.flat()).toEqual(liste);
      // Équilibrés à une créatrice près.
      const tailles = tranches.map((t) => t.length);
      expect(Math.max(...tailles) - Math.min(...tailles)).toBeLessThanOrEqual(1);
    }
  });

  it("refuse un lot hors bornes plutôt que de rendre une tranche vide", () => {
    expect(() => lotSlice([1, 2], 2, 2)).toThrow();
    expect(() => lotSlice([1, 2], -1, 2)).toThrow();
    expect(() => lotSlice([1, 2], 0, 0)).toThrow();
    expect(() => lotSlice([1, 2], 0.5, 2)).toThrow();
  });
});
