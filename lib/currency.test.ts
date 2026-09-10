import { describe, it, expect } from "vitest";
import {
  sameCurrency,
  effectiveFxRate,
  currencySymbol,
  payAmountInRevenueCurrency,
} from "./currency";

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

describe("payAmountInRevenueCurrency — une seule devise d'affichage", () => {
  // Le cas de prod qui a motivé le module (taux Snytch du 2026-08-30).
  it("dollars → euros au taux du projet (le cas 10,62 $ → 9,13 €)", () => {
    const d = payAmountInRevenueCurrency(10.62, "usd", "eur", 0.86);
    expect(d.value).toBe(9.13);
    expect(d.currency).toBe("eur");
    expect(d.converted).toBe(true);
    expect(d.sourceValue).toBe(10.62);
    expect(d.sourceCurrency).toBe("usd");
  });

  it("sans taux réglé : reste en devise de paie, jamais un euro inventé", () => {
    const d = payAmountInRevenueCurrency(10.62, "usd", "eur", null);
    expect(d.value).toBe(10.62);
    expect(d.currency).toBe("usd");
    expect(d.converted).toBe(false);
    expect(d.rate).toBeNull();
  });

  it("mêmes devises : aucune conversion, et on ne prétend pas en avoir fait une", () => {
    const d = payAmountInRevenueCurrency(10.62, "eur", "eur", 0.86);
    expect(d.value).toBe(10.62);
    expect(d.converted).toBe(false);
    expect(d.rate).toBe(1);
  });

  it("un taux nul ou négatif ne convertit pas (il ne s'invente pas de sens)", () => {
    expect(payAmountInRevenueCurrency(10, "usd", "eur", 0).converted).toBe(false);
    expect(payAmountInRevenueCurrency(10, "usd", "eur", -1).converted).toBe(false);
  });

  it("arrondi au centime, jamais une traîne de flottant", () => {
    expect(payAmountInRevenueCurrency(877.22, "usd", "eur", 0.86).value).toBe(754.41);
  });
});
