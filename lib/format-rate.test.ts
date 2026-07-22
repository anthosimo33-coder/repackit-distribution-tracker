import { describe, it, expect } from "vitest";
import { formatViews, rateSummary } from "./format-rate";

// Intl fr-FR insère une espace fine insécable (U+202F, parfois U+00A0) avant $ ;
// on normalise pour comparer (la NBSP reste côté UI — typographie FR correcte).
const norm = (s: string) => s.replace(/[\u202f\u00a0\u2009]/g, " ");
const normLines = (lines: string[]) => lines.map(norm);

describe("formatViews", () => {
  it("compacte k / M", () => {
    expect(formatViews(500)).toBe("500");
    expect(formatViews(1000)).toBe("1 k");
    expect(formatViews(1500)).toBe("1,5 k");
    expect(formatViews(2_000_000)).toBe("2 M");
  });
});

describe("rateSummary", () => {
  it("base seule", () => {
    expect(normLines(rateSummary({ basePerPost: 50 }))).toEqual([
      "50,00 $ par post",
    ]);
  });
  it("base + bonus vues + primes triées", () => {
    const lines = normLines(
      rateSummary({
        basePerPost: 50,
        viewBonusPer1k: 2,
        bounties: [
          { thresholdViews: 1_000_000, amount: 500 },
          { thresholdViews: 100_000, amount: 100 },
        ],
      }),
    );
    expect(lines[0]).toBe("50,00 $ par post");
    expect(lines[1]).toBe("+ 2,00 $ / 1 000 vues");
    // Primes triées par seuil croissant.
    expect(lines[2]).toContain("100 k vues");
    expect(lines[3]).toContain("1 M vues");
  });
  it("ignore un bonus aux vues nul", () => {
    expect(normLines(rateSummary({ basePerPost: 10, viewBonusPer1k: 0 }))).toEqual([
      "10,00 $ par post",
    ]);
  });
});
