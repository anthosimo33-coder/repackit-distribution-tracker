import { describe, it, expect } from "vitest";
import {
  computeMargin,
  computeRpm,
  viewsForToggle,
  computeProfitability,
  profitabilityReport,
  type ProfitabilityInput,
} from "./profitability";

describe("computeMargin — revenu net − coût créateurs converti", () => {
  it("même devise (taux 1) : marge positive", () => {
    expect(computeMargin(1000, 400, 1)).toBe(600);
  });
  it("même devise (taux 1) : marge négative (coût > revenu)", () => {
    expect(computeMargin(300, 500, 1)).toBe(-200);
  });
  it("convertit le coût par le taux (coût $ → devise du revenu €)", () => {
    // 1000 € − 400 $ × 0,5 = 1000 − 200 = 800 €.
    expect(computeMargin(1000, 400, 0.5)).toBe(800);
  });
  it("arrondi au centime", () => {
    expect(computeMargin(100.005, 0, 1)).toBe(100.01);
  });
  it("SANS taux (devises non reliées) → null, jamais une soustraction mixte", () => {
    expect(computeMargin(1000, 400, null)).toBeNull();
    expect(computeMargin(1000, 400, 0)).toBeNull();
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
  const split = { paidViews: 400_000, unpaidViews: 100_000 };
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
    paidViews: 400_000, // posts RÉMUNÉRÉS
    unpaidViews: 100_000, // posts NON rémunérés
    fxRateToRevenue: 1, // même devise pour ce jeu de test
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

  it("sans post non rémunéré : le toggle n'a aucun effet (unpaidViews = 0)", () => {
    const noUnpaid: ProfitabilityInput = { ...input, unpaidViews: 0 };
    const off = computeProfitability(noUnpaid, false);
    const on = computeProfitability(noUnpaid, true);
    expect(on.views).toBe(off.views);
    expect(on.rpm).toBe(off.rpm);
  });
});

describe("profitabilityReport — le calcul partagé par la carte et l'outil MCP", () => {
  // Forme de la prod Snytch : paie en dollars, revenu Whop en euros, taux posé
  // sur le projet, montants à décimales, un mois figé et le mois en cours.
  const source = {
    currency: "eur",
    payCurrency: "usd",
    fxRateToRevenue: 0.86,
    total: {
      revenueNet: 4213.57,
      creatorCost: 3118.4,
      paidViews: 1_238_407,
      unpaidViews: 312_004,
    },
    months: [
      {
        period: "2026-09",
        settled: false,
        mixedCurrency: false,
        revenueNet: 1873.42,
        creatorCost: 1402.15,
        paidViews: 512_330,
        unpaidViews: 98_761,
      },
      {
        period: "2026-08",
        settled: true,
        mixedCurrency: false,
        revenueNet: 2340.15,
        creatorCost: 1716.25,
        paidViews: 726_077,
        unpaidViews: 213_243,
      },
    ],
  };

  it("convertit le coût dans la devise du revenu pour la marge, RPM sur les vues facturées", () => {
    const r = profitabilityReport(source, false);
    expect(r.fxRate).toBe(0.86);
    // 4 213,57 − 3 118,40 × 0,86 = 1 531,746 → 1 531,75
    expect(r.total).toEqual({
      revenueNet: 4213.57,
      creatorCost: 3118.4,
      margin: 1531.75,
      views: 1_238_407,
      rpm: 3.4,
      includeUnpaid: false,
    });
  });

  it("le toggle ne change que les vues et le RPM (dilué)", () => {
    const r = profitabilityReport(source, true);
    expect(r.total.views).toBe(1_550_411);
    expect(r.total.rpm).toBe(2.72);
    expect(r.total.margin).toBe(1531.75);
    expect(r.total.revenueNet).toBe(4213.57);
  });

  it("chaque mois garde ses champs et reçoit SES métriques", () => {
    const [sept, aout] = profitabilityReport(source, false).months;
    expect(sept).toMatchObject({ period: "2026-09", settled: false });
    // 1 873,42 − 1 402,15 × 0,86 = 667,571 → 667,57 ; 1 873,42 / 512,33 = 3,6567
    expect(sept.metrics).toMatchObject({ margin: 667.57, rpm: 3.66, views: 512_330 });
    expect(aout).toMatchObject({ period: "2026-08", settled: true });
    expect(aout.metrics).toMatchObject({ margin: 864.18, rpm: 3.22 });
  });

  it("même devise : taux 1, quel que soit le taux posé ; devises non reliées : marge null", () => {
    const meme = profitabilityReport({ ...source, currency: "USD", fxRateToRevenue: null }, false);
    expect(meme.fxRate).toBe(1);
    expect(meme.total.margin).toBe(1095.17);
    const sansTaux = profitabilityReport({ ...source, fxRateToRevenue: null }, false);
    expect(sansTaux.fxRate).toBeNull();
    expect(sansTaux.total.margin).toBeNull();
    expect(sansTaux.months.every((m) => m.metrics.margin === null)).toBe(true);
    // Le RPM, lui, ne dépend pas du taux : il reste calculé.
    expect(sansTaux.total.rpm).toBe(3.4);
  });
});
