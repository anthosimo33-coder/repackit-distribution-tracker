import { describe, it, expect } from "vitest";
import { resolveOutlierRatio } from "./inspiration-stats";

describe("resolveOutlierRatio", () => {
  it("prend le ratio STOCKÉ en priorité (provenance Radar)", () => {
    // Ratio stocké prime même si views/followers permettraient un autre calcul.
    expect(
      resolveOutlierRatio({ outlierRatio: 47, views: 100, followers: 100 }, "video"),
    ).toBe(47);
  });

  it("FALLBACK views/followers quand aucun ratio stocké", () => {
    expect(resolveOutlierRatio({ views: 1000, followers: 200 }, "video")).toBe(5);
  });

  it("null si followers absent (non calculable)", () => {
    expect(resolveOutlierRatio({ views: 1000 }, "video")).toBeNull();
  });

  it("null si views absent", () => {
    expect(resolveOutlierRatio({ followers: 200 }, "video")).toBeNull();
  });

  it("null si followers ≤ 0 (garde-fou computeOutlierRatio)", () => {
    expect(resolveOutlierRatio({ views: 1000, followers: 0 }, "video")).toBeNull();
  });

  it("null pour un COMPTE même avec données exploitables", () => {
    expect(resolveOutlierRatio({ outlierRatio: 47 }, "account")).toBeNull();
    expect(
      resolveOutlierRatio({ views: 1000, followers: 200 }, "account"),
    ).toBeNull();
  });

  it("null si stats absent", () => {
    expect(resolveOutlierRatio(undefined, "video")).toBeNull();
  });
});
