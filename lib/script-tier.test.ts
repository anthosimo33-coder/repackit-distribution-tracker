import { describe, it, expect } from "vitest";
import {
  SCRIPT_TIERS,
  tierLabel,
  normalizeTier,
  tierBadgeClasses,
} from "./script-tier";

describe("SCRIPT_TIERS", () => {
  it("ne propose que 2 tiers (S, A) — B exclu", () => {
    expect([...SCRIPT_TIERS]).toEqual(["S", "A"]);
  });
});

describe("tierLabel", () => {
  it("S → Argent", () => {
    expect(tierLabel("S")).toBe("Argent");
  });
  it("A → Autre", () => {
    expect(tierLabel("A")).toBe("Autre");
  });
  it("B legacy / vide / inconnu → Autre", () => {
    expect(tierLabel("B")).toBe("Autre");
    expect(tierLabel(null)).toBe("Autre");
    expect(tierLabel(undefined)).toBe("Autre");
    expect(tierLabel("X")).toBe("Autre");
  });
});

describe("normalizeTier", () => {
  it("conserve S", () => {
    expect(normalizeTier("S")).toBe("S");
  });
  it("rabat A, B legacy, vide → A", () => {
    expect(normalizeTier("A")).toBe("A");
    expect(normalizeTier("B")).toBe("A");
    expect(normalizeTier(null)).toBe("A");
    expect(normalizeTier(undefined)).toBe("A");
  });
});

describe("tierBadgeClasses", () => {
  it("S vert, le reste neutre, et S ≠ Autre", () => {
    expect(tierBadgeClasses("S")).toContain("emerald");
    expect(tierBadgeClasses("A")).toContain("slate");
    expect(tierBadgeClasses("B")).toBe(tierBadgeClasses("A"));
    expect(tierBadgeClasses("S")).not.toBe(tierBadgeClasses("A"));
  });
});
