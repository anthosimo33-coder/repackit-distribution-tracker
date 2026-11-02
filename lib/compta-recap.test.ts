import { describe, it, expect } from "vitest";
import { buildComptaRecap, monthRange, netShares, previousPeriod, type RecapRow } from "./compta-recap";

/** Les lignes mensuelles de Snytch telles que l'onglet Compta les rendait le 02/11/2026. */
const row = (r: Partial<RecapRow> & Pick<RecapRow, "month">): RecapRow => ({
  inProgress: false,
  ledger: { gross: 0, refunds: 0, disputes: 0, fees: 0, net: 0 },
  creators: 0,
  scans: 0,
  scanSource: null,
  other: 0,
  otherByCategory: [],
  alertFees: { count: 0, amount: 0 },
  result: 0,
  incomplete: [],
  ...r,
});

const SNYTCH: RecapRow[] = [
  row({
    month: "2026-07",
    ledger: { gross: 213.66, refunds: -14.97, disputes: 0, fees: -19.3, net: 179.39 },
    scans: 18.71,
    scanSource: "estimate",
    result: 160.68,
  }),
  row({
    month: "2026-08",
    ledger: { gross: 2301.44, refunds: -24.95, disputes: 0, fees: -199.57, net: 2076.92 },
    creators: 661.87,
    scans: 840.64,
    scanSource: "paid",
    alertFees: { count: 1, amount: 25.09 },
    result: 574.41,
  }),
  row({
    month: "2026-09",
    ledger: { gross: 9838.4, refunds: -89.9, disputes: 0, fees: -705.56, net: 9042.94 },
    creators: 1031.82,
    scans: 404.87,
    scanSource: "paid",
    other: 462.37,
    otherByCategory: [
      { category: "ads", amount: 240 },
      { category: "tools", amount: 176.87 },
      { category: "other", amount: 45.5 },
    ],
    alertFees: { count: 3, amount: 75.55 },
    result: 7143.88,
  }),
  row({
    month: "2026-10",
    ledger: { gross: 9648.11, refunds: -153.56, disputes: -55.93, fees: -894.56, net: 8544.06 },
    creators: 1982.18,
    scans: 653.86,
    scanSource: "paid",
    other: 1082.57,
    otherByCategory: [
      { category: "other", amount: 502.57 },
      { category: "ads", amount: 250 },
      { category: "subscriptions", amount: 250 },
      { category: "hosting", amount: 80 },
    ],
    alertFees: { count: 12, amount: 310.06 },
    result: 4825.45,
  }),
  row({
    month: "2026-11",
    inProgress: true,
    ledger: { gross: 663.35, refunds: 0, disputes: 0, fees: -40.2, net: 623.15 },
    scans: 661.75,
    scanSource: "paid",
    other: 100,
    otherByCategory: [{ category: "other", amount: 100 }],
    result: -138.6,
  }),
];

describe("récap Compta d'une période", () => {
  it("les mois d'une période, et la période d'avant de même durée (à cheval sur deux années)", () => {
    expect(monthRange("2026-08", "2026-10")).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(monthRange("2026-10", "2026-10")).toEqual(["2026-10"]);
    expect(previousPeriod("2026-02", 3)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("octobre 2026 : les chiffres de l'onglet, comparés à septembre", () => {
    const r = buildComptaRecap(SNYTCH, "2026-10", "2026-10");
    expect(r).toMatchObject({
      gross: 9648.11,
      net: 8544.06,
      deductions: -1104.05,
      creators: 1982.18,
      scans: 653.86,
      scanSource: "paid",
      other: 1082.57,
      result: 4825.45,
      margin: 56,
      grossChange: -2,
      alertFees: { count: 12, amount: 310.06 },
      inProgress: false,
      incomplete: false,
    });
    expect(r.previous).toMatchObject({ from: "2026-09", to: "2026-09", result: 7143.88, alertFees: { count: 3, amount: 75.55 } });
    // −2 318 € : les créatrices (−950) et les autres charges (−620) pèsent le plus.
    expect(r.drivers).toEqual([
      { key: "creators", effect: -950.36 },
      { key: "other", effect: -620.2 },
    ]);
    expect(r.otherByCategory.map((c) => c.category)).toEqual(["other", "ads", "subscriptions", "hosting"]);
  });

  it("une période de plusieurs mois somme ses mois et se compare aux mois d'avant", () => {
    const r = buildComptaRecap(SNYTCH, "2026-09", "2026-10");
    expect(r).toMatchObject({ gross: 19486.51, net: 17587, result: 11969.33, scanSource: "paid" });
    expect(r.previous).toMatchObject({ from: "2026-07", to: "2026-08", result: 735.09 });
    // Le résultat monte : c'est le net qui le porte.
    expect(r.drivers[0]).toEqual({ key: "net", effect: 15330.69 });
    // Les catégories s'additionnent d'un mois à l'autre.
    expect(r.otherByCategory.find((c) => c.category === "ads")?.amount).toBe(490);
  });

  it("sans activité avant, rien à comparer ; un mois en cours ou incomplet se signale", () => {
    const juillet = buildComptaRecap(SNYTCH, "2026-07", "2026-07");
    expect(juillet).toMatchObject({ previous: null, grossChange: null, drivers: [], scanSource: "estimate" });
    expect(buildComptaRecap(SNYTCH, "2026-11", "2026-11").inProgress).toBe(true);
    const trou = [row({ month: "2026-10", ledger: { gross: 10, refunds: 0, disputes: 0, fees: 0, net: 10 }, creators: null, incomplete: ["creatorsCurrency"] })];
    expect(buildComptaRecap(trou, "2026-10", "2026-10").incomplete).toBe(true);
    const aRanger = [row({ month: "2026-10", incomplete: ["unclassified"] })];
    expect(buildComptaRecap(aRanger, "2026-10", "2026-10").incomplete).toBe(false);
    // Sources de scans différentes selon les mois.
    expect(buildComptaRecap(SNYTCH, "2026-07", "2026-08").scanSource).toBe("mixed");
  });

  it("la barre du net : les parts d'octobre, et un résultat négatif sans segment", () => {
    expect(netShares(buildComptaRecap(SNYTCH, "2026-10", "2026-10"))).toEqual([
      { key: "result", amount: 4825.45, share: 56.48 },
      { key: "creators", amount: 1982.18, share: 23.2 },
      { key: "scans", amount: 653.86, share: 7.65 },
      { key: "other", amount: 1082.57, share: 12.67 },
    ]);
    const novembre = netShares(buildComptaRecap(SNYTCH, "2026-11", "2026-11"));
    expect(novembre.map((s) => s.key)).toEqual(["scans", "other"]);
    expect(novembre.reduce((s, p) => s + p.share, 0)).toBeCloseTo(100, 1);
    expect(netShares({ net: 0, creators: 0, scans: 0, other: 0, result: 0 })).toEqual([]);
  });
});
