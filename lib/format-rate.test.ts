import { describe, it, expect } from "vitest";
import { formatMoney, formatViews, rateSummary } from "./format-rate";

// Intl fr-FR insère une espace fine insécable (U+202F, parfois U+00A0) avant $ ;
// on normalise pour comparer (la NBSP reste côté UI — typographie FR correcte).
const norm = (s: string) => s.replace(/[\u202f\u00a0\u2009]/g, " ");
const normLines = (lines: string[]) => lines.map(norm);

describe("formatMoney — la devise vient de la donnée, jamais du code", () => {
  it("rend le symbole de la devise fournie", () => {
    expect(norm(formatMoney(10, "EUR"))).toContain("€");
    expect(norm(formatMoney(10, "USD"))).toContain("$");
    expect(norm(formatMoney(10, "GBP"))).toContain("£");
  });
  it("SANS devise → montant SANS symbole (jamais un défaut inventé)", () => {
    const bare = norm(formatMoney(10));
    expect(bare).not.toContain("€");
    expect(bare).not.toContain("$");
    expect(bare).toContain("10,00");
    expect(norm(formatMoney(10, ""))).not.toMatch(/[€$£]/);
    expect(norm(formatMoney(10, null))).not.toMatch(/[€$£]/);
  });
  it("ne mélange pas les devises : eur ne rend jamais un dollar et inversement", () => {
    expect(formatMoney(10, "eur")).not.toContain("$");
    expect(formatMoney(10, "usd")).not.toContain("€");
  });
  it("accepte la devise en minuscules, comme la donnée (« eur », « usd »)", () => {
    expect(norm(formatMoney(10, "eur"))).toContain("€");
    expect(norm(formatMoney(10, "usd"))).toContain("$");
  });
});

describe("formatViews", () => {
  it("compacte k / M", () => {
    expect(formatViews(500)).toBe("500");
    expect(formatViews(1000)).toBe("1 k");
    expect(formatViews(1500)).toBe("1,5 k");
    expect(formatViews(2_000_000)).toBe("2 M");
  });
});

describe("rateSummary", () => {
  // La grille est de la PAIE créatrices : devise = payCurrency (dollars pour Snytch).
  it("base seule, en dollars", () => {
    expect(normLines(rateSummary({ basePerPost: 50 }, "usd"))).toEqual([
      "50,00 $ par post",
    ]);
  });
  it("sans devise fournie → montant sans symbole", () => {
    expect(normLines(rateSummary({ basePerPost: 50 }))).toEqual([
      "50,00 par post",
    ]);
  });
  it("base + bonus vues + primes triées", () => {
    const lines = normLines(
      rateSummary(
        {
          basePerPost: 50,
          viewBonusPer1k: 2,
          bounties: [
            { thresholdViews: 1_000_000, amount: 500 },
            { thresholdViews: 100_000, amount: 100 },
          ],
        },
        "usd",
      ),
    );
    expect(lines[0]).toBe("50,00 $ par post");
    expect(lines[1]).toBe("+ 2,00 $ / 1 000 vues");
    // Primes triées par seuil croissant.
    expect(lines[2]).toContain("100 k vues");
    expect(lines[3]).toContain("1 M vues");
  });
  it("ignore un bonus aux vues nul", () => {
    expect(normLines(rateSummary({ basePerPost: 10, viewBonusPer1k: 0 }, "usd"))).toEqual([
      "10,00 $ par post",
    ]);
  });
});
