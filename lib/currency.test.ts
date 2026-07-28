import { describe, it, expect } from "vitest";
import { sameCurrency, effectiveFxRate, currencySymbol } from "./currency";

const norm = (s: string) => s.replace(/[   ]/g, " ");

describe("sameCurrency", () => {
  it("compare les codes en ignorant casse et espaces", () => {
    expect(sameCurrency("usd", "USD")).toBe(true);
    expect(sameCurrency(" eur ", "eur")).toBe(true);
    expect(sameCurrency("usd", "eur")).toBe(false);
  });
  it("une devise absente n'égale rien", () => {
    expect(sameCurrency(null, "usd")).toBe(false);
    expect(sameCurrency("usd", undefined)).toBe(false);
    expect(sameCurrency(null, null)).toBe(false);
  });
});

describe("effectiveFxRate — jamais mélanger deux devises sans conversion", () => {
  it("mêmes devises → 1 (aucune conversion)", () => {
    expect(effectiveFxRate("eur", "eur", null)).toBe(1);
    expect(effectiveFxRate("USD", "usd", undefined)).toBe(1);
  });
  it("devises différentes + taux → le taux", () => {
    expect(effectiveFxRate("usd", "eur", 0.92)).toBe(0.92);
  });
  it("devises différentes SANS taux → null (marge non calculable)", () => {
    expect(effectiveFxRate("usd", "eur", null)).toBeNull();
    expect(effectiveFxRate("usd", "eur", 0)).toBeNull();
    expect(effectiveFxRate("usd", "eur", undefined)).toBeNull();
  });
  it("une devise inconnue → pas de conversion arbitraire", () => {
    expect(effectiveFxRate(null, "eur", null)).toBeNull();
  });
});

describe("currencySymbol", () => {
  it("rend le symbole de la devise", () => {
    expect(norm(currencySymbol("usd"))).toContain("$");
    expect(norm(currencySymbol("eur"))).toContain("€");
  });
  it("code absent → chaîne vide (jamais un symbole inventé)", () => {
    expect(currencySymbol(null)).toBe("");
    expect(currencySymbol("")).toBe("");
    expect(currencySymbol(undefined)).toBe("");
  });
});
