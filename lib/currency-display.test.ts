import { describe, it, expect } from "vitest";
import {
  toDisplayAmount,
  convertedValue,
  conversionNote,
  rateNote,
} from "./currency-display";

/**
 * Les chaînes RÉELLEMENT affichées à côté des montants convertis. Un test de
 * valeur seule ne les couvre pas : le défaut qu'on peut réintroduire ici est un
 * libellé qui ment (« converti » sur un montant qui ne l'est pas) ou un
 * séparateur orphelin. Contexte de prod : Snytch, 1 $ = 0,86 €.
 */
const SNYTCH = { payCurrency: "usd", revenueCurrency: "eur", fxRateToRevenue: 0.86 };
const SANS_TAUX = { payCurrency: "usd", revenueCurrency: "eur", fxRateToRevenue: null };
const MONO = { payCurrency: "eur", revenueCurrency: "eur", fxRateToRevenue: 0.86 };
const norm = (s: string) => s.replace(/[  ]/g, " ");

describe("ConvertedAmount — ce qui s'affiche", () => {
  it("le coût d'acquisition sort en euros, sa provenance est écrite", () => {
    const d = toDisplayAmount(10.62, SNYTCH);
    expect(norm(convertedValue(d))).toContain("9,13");
    expect(norm(convertedValue(d))).toContain("€");
    expect(norm(convertedValue(d))).not.toContain("$");
    expect(norm(conversionNote(d))).toBe("10,62 $ converti");
  });

  it("sans taux : reste en dollars et le DIT, jamais un euro inventé", () => {
    const d = toDisplayAmount(10.62, SANS_TAUX);
    expect(norm(convertedValue(d))).toContain("$");
    expect(norm(convertedValue(d))).not.toContain("€");
    expect(conversionNote(d)).toContain("aucun taux de change réglé");
  });

  it("même devise des deux côtés : aucune mention « converti »", () => {
    const d = toDisplayAmount(10.62, MONO);
    expect(conversionNote(d)).toBe("");
    expect(rateNote(MONO)).toContain("même devise");
  });

  it("montant absent → tiret, et aucune provenance à écrire", () => {
    expect(convertedValue(toDisplayAmount(null, SNYTCH))).toBe("—");
    expect(conversionNote(toDisplayAmount(null, SNYTCH))).toBe("");
  });

  it("le taux du projet est écrit une fois, avec les deux symboles", () => {
    const r = norm(rateNote(SNYTCH));
    expect(r).toContain("1 $");
    expect(r).toContain("0,86");
    expect(r).toContain("€");
  });

  it("sans taux, la note de taux explique pourquoi les coûts restent en $", () => {
    expect(rateNote(SANS_TAUX)).toContain("aucun taux de change réglé");
  });
});
