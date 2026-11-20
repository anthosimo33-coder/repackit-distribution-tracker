import { describe, expect, it } from "vitest";
import { computeOutlierRatio, formatOutlierRatio } from "./outlier";

// Repris de lib/radarParsing.test.ts quand le Radar a quitté Jarvia (20/11/2026) : les Inspirations s'en servent.
describe("computeOutlierRatio", () => {
  it("vues / abonnés", () => {
    expect(computeOutlierRatio(50000, 1000)).toBe(50);
    expect(computeOutlierRatio(112662, 1138)).toBeCloseTo(99.0, 0);
  });
  it("null (exclu) si abonnés 0, négatif, absent", () => {
    expect(computeOutlierRatio(50000, 0)).toBeNull();
    expect(computeOutlierRatio(50000, null)).toBeNull();
    expect(computeOutlierRatio(50000, -5)).toBeNull();
  });
});

describe("formatOutlierRatio", () => {
  it("entier à partir de 10, une décimale en dessous, virgule en français", () => {
    expect(formatOutlierRatio(47.4)).toBe("47×");
    expect(formatOutlierRatio(3.24)).toBe("3,2×");
    expect(formatOutlierRatio(3.24, "en-US")).toBe("3.2×");
  });
  it("tiret si le ratio n'a pas de sens", () => {
    expect(formatOutlierRatio(Number.NaN)).toBe("—");
    expect(formatOutlierRatio(-1)).toBe("—");
  });
});
