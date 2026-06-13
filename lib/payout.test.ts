import { describe, it, expect } from "vitest";
import { nextPayoutDate, daysUntilPayout } from "./payout";

/** Helper : composantes UTC (Y, M 1-12, D) du timestamp retourné. */
function ymd(ts: number): [number, number, number] {
  const d = new Date(ts);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

describe("nextPayoutDate", () => {
  it("jour de paie passé ce mois → mois suivant (le 12, payoutDay=5 → 5 du mois suivant)", () => {
    const now = Date.UTC(2026, 0, 12); // 12 janvier 2026
    expect(ymd(nextPayoutDate(5, now))).toEqual([2026, 2, 5]); // 5 février
  });

  it("jour de paie à venir ce mois → ce mois-ci", () => {
    const now = Date.UTC(2026, 0, 12);
    expect(ymd(nextPayoutDate(20, now))).toEqual([2026, 1, 20]); // 20 janvier
  });

  it("aujourd'hui == jour de paie → aujourd'hui (inclusif, 0 jour)", () => {
    const now = Date.UTC(2026, 0, 5);
    expect(ymd(nextPayoutDate(5, now))).toEqual([2026, 1, 5]); // 5 janvier
    expect(daysUntilPayout(5, now)).toBe(0);
  });

  it("payoutDay=31 en février (non bissextile) → dernier jour (28)", () => {
    const now = Date.UTC(2026, 1, 15); // 15 février 2026
    expect(ymd(nextPayoutDate(31, now))).toEqual([2026, 2, 28]);
  });

  it("payoutDay=31 en février bissextile → 29", () => {
    const now = Date.UTC(2024, 1, 10); // 10 février 2024 (bissextile)
    expect(ymd(nextPayoutDate(31, now))).toEqual([2024, 2, 29]);
  });

  it("payoutDay=31 le 31 janvier → aujourd'hui (today==clampedThis, inclusif)", () => {
    const now = Date.UTC(2026, 0, 31); // 31 janvier : today==clampedThis(31) → ce mois
    expect(ymd(nextPayoutDate(31, now))).toEqual([2026, 1, 31]); // 31 janvier (aujourd'hui)
  });

  it("rollover d'année : décembre → janvier suivant", () => {
    const now = Date.UTC(2026, 11, 12); // 12 décembre 2026
    expect(ymd(nextPayoutDate(5, now))).toEqual([2027, 1, 5]); // 5 janvier 2027
  });

  it("payoutDay=1 le 15 → 1er du mois suivant", () => {
    const now = Date.UTC(2026, 5, 15); // 15 juin
    expect(ymd(nextPayoutDate(1, now))).toEqual([2026, 7, 1]); // 1er juillet
  });
});

describe("daysUntilPayout", () => {
  it("compte les jours pleins jusqu'à la prochaine paie", () => {
    const now = Date.UTC(2026, 0, 1); // 1er janvier
    expect(daysUntilPayout(5, now)).toBe(4); // 1 → 5 = 4 jours
  });

  it("jour de paie le lendemain → 1", () => {
    const now = Date.UTC(2026, 0, 4);
    expect(daysUntilPayout(5, now)).toBe(1);
  });

  it("jamais négatif", () => {
    const now = Date.UTC(2026, 0, 31);
    expect(daysUntilPayout(5, now)).toBeGreaterThanOrEqual(0);
  });
});
