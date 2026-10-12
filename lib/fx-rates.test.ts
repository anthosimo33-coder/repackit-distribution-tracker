import { describe, expect, it } from "vitest";
import {
  applyFxChange,
  fxTargetFrom,
  unconvertiblePricingCurrency,
  type FxCollected,
  type FxProject,
} from "../convex/fxRatesMath";
import { isPayCurrencyConvertible, payCurrencyFactor } from "../convex/payCurrency";

/**
 * TAUX DE CHANGE — cf convex/fxRatesMath. Taux de Snytch en prod au 12/10 :
 * paie en dollars, revenu en euros, 1 $ = 0,86 €, 1 RSD = 0,00852 €.
 */
const SNYTCH: FxProject = {
  payCurrency: "usd",
  fxRateToRevenue: 0.86,
  fxRatesToRevenue: [{ currency: "rsd", rate: 0.00852 }],
};
const SNYTCH_ENCAISSE: FxCollected = { seen: ["eur", "usd", "rsd"], comptaReference: "eur" };
const RIEN: FxCollected = { seen: [], comptaReference: null };

describe("fxTargetFrom — vers quelle devise ramènent les taux", () => {
  it("le projet encaisse : la seule devise encaissée sans taux", () => {
    expect(fxTargetFrom(SNYTCH_ENCAISSE, SNYTCH)).toMatchObject({
      target: "eur",
      source: "revenue",
      collected: ["eur", "rsd", "usd"],
    });
  });

  it("il n'encaisse rien (BLUSH) : sa devise de paie", () => {
    expect(fxTargetFrom(RIEN, { payCurrency: "eur" })).toMatchObject({
      target: "eur",
      source: "pay",
    });
  });

  it("deux devises encaissées sans taux, sans grand livre : indéterminée, les deux candidates", () => {
    const s = fxTargetFrom({ seen: ["gbp", "eur"], comptaReference: null }, { payCurrency: "usd" });
    expect(s).toMatchObject({ target: null, source: null, candidates: ["eur", "gbp"] });
  });

  it("le grand livre tranche une indétermination", () => {
    const s = fxTargetFrom({ seen: ["gbp", "eur"], comptaReference: "eur" }, SNYTCH);
    expect(s.target).toBe("eur");
  });
});

describe("applyFxChange — poser un taux", () => {
  it("Snytch : corriger le taux du dollar écrit fxRateToRevenue, rien d'autre", () => {
    const r = applyFxChange(SNYTCH, SNYTCH_ENCAISSE, ["usd", "eur"], { currency: "USD", rate: 0.87 });
    expect(r).toEqual({ ok: true, patch: { fxRateToRevenue: 0.87 } });
  });

  it("une nouvelle devise s'ajoute aux autres, triées", () => {
    const r = applyFxChange(SNYTCH, SNYTCH_ENCAISSE, [], { currency: "gbp", rate: 1.15 });
    expect(r).toEqual({
      ok: true,
      patch: {
        fxRatesToRevenue: [
          { currency: "gbp", rate: 1.15 },
          { currency: "rsd", rate: 0.00852 },
        ],
      },
    });
  });

  it("jamais de taux sur la devise du revenu : elle cesserait d'être la cible", () => {
    const r = applyFxChange(SNYTCH, SNYTCH_ENCAISSE, [], { currency: "eur", rate: 1 });
    expect(r).toMatchObject({ ok: false, refusal: { code: "FX_RATE_ON_TARGET", params: { currency: "EUR" } } });
  });

  it("taux nul, négatif ou non fini : refusé", () => {
    for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(applyFxChange(SNYTCH, SNYTCH_ENCAISSE, [], { currency: "gbp", rate })).toMatchObject({
        ok: false,
        refusal: { code: "FX_RATE_INVALID" },
      });
    }
  });

  it("code devise qui n'en est pas un : refusé", () => {
    for (const currency of ["", "euro", "e1", "€"]) {
      expect(applyFxChange(SNYTCH, SNYTCH_ENCAISSE, [], { currency, rate: 1 })).toMatchObject({
        ok: false,
        refusal: { code: "FX_CURRENCY_INVALID" },
      });
    }
  });

  it("cible indéterminée : il faut la choisir parmi les candidates", () => {
    const amb: FxCollected = { seen: ["gbp", "eur"], comptaReference: null };
    const p: FxProject = { payCurrency: "usd" };
    expect(applyFxChange(p, amb, [], { currency: "gbp", rate: 1.15 })).toMatchObject({
      ok: false,
      refusal: { code: "FX_TARGET_UNKNOWN", params: { currencies: "EUR, GBP" } },
    });
    expect(applyFxChange(p, amb, [], { currency: "gbp", rate: 1.15, target: "usd" })).toMatchObject({
      ok: false,
      refusal: { code: "FX_TARGET_UNKNOWN" },
    });
    // Choisie : l'euro reste sans taux, la livre en prend un.
    const r = applyFxChange(p, amb, [], { currency: "gbp", rate: 1.15, target: "eur" });
    expect(r).toEqual({ ok: true, patch: { fxRatesToRevenue: [{ currency: "gbp", rate: 1.15 }] } });
    expect(applyFxChange(p, amb, [], { currency: "eur", rate: 1, target: "eur" })).toMatchObject({
      ok: false,
      refusal: { code: "FX_RATE_ON_TARGET" },
    });
  });
});

describe("applyFxChange — retirer un taux", () => {
  it("devise encaissée : corriger, pas retirer (le revenu ne s'additionnerait plus)", () => {
    expect(applyFxChange(SNYTCH, SNYTCH_ENCAISSE, [], { currency: "rsd", rate: null })).toMatchObject({
      ok: false,
      refusal: { code: "FX_RATE_NEEDED_BY_REVENUE", params: { currency: "RSD" } },
    });
  });

  it("devise de paie quand le revenu est ailleurs : la marge en dépend", () => {
    const p: FxProject = { payCurrency: "usd", fxRateToRevenue: 0.86 };
    const encaisse: FxCollected = { seen: ["eur"], comptaReference: null };
    expect(applyFxChange(p, encaisse, [], { currency: "usd", rate: null })).toMatchObject({
      ok: false,
      refusal: { code: "FX_RATE_NEEDED_BY_MARGIN", params: { currency: "USD", target: "EUR" } },
    });
  });

  it("un barème en dépend : refusé, la devise du barème est nommée", () => {
    const p: FxProject = { payCurrency: "eur", fxRatesToRevenue: [{ currency: "usd", rate: 0.86 }] };
    expect(applyFxChange(p, RIEN, ["eur", "usd"], { currency: "usd", rate: null })).toMatchObject({
      ok: false,
      refusal: { code: "FX_RATE_NEEDED_BY_PRICING", params: { currency: "USD" } },
    });
  });

  it("rien n'en dépend : retiré, et le champ disparaît quand la liste est vide", () => {
    const p: FxProject = { payCurrency: "eur", fxRatesToRevenue: [{ currency: "gbp", rate: 1.15 }] };
    expect(applyFxChange(p, RIEN, ["eur"], { currency: "gbp", rate: null })).toEqual({
      ok: true,
      patch: { fxRatesToRevenue: undefined },
    });
  });

  it("le taux posé à tort sur la cible se retire : c'est la réparation", () => {
    // Le grand livre désigne l'euro, qui a reçu un taux : plus aucune devise
    // encaissée n'est sans taux.
    const casse: FxProject = { ...SNYTCH, fxRatesToRevenue: [...SNYTCH.fxRatesToRevenue!, { currency: "eur", rate: 1 }] };
    expect(fxTargetFrom(SNYTCH_ENCAISSE, casse).target).toBe("eur");
    expect(applyFxChange(casse, SNYTCH_ENCAISSE, [], { currency: "eur", rate: null })).toEqual({
      ok: true,
      patch: { fxRatesToRevenue: [{ currency: "rsd", rate: 0.00852 }] },
    });
  });
});

describe("paie dans la devise cible — aucun taux de paie exigé", () => {
  // BLUSH après son premier barème : paie en euros, aucun revenu. Un barème en
  // dollars se convertit avec le seul taux du dollar vers l'euro.
  const BLUSH: FxProject = { payCurrency: "eur", fxRatesToRevenue: [{ currency: "usd", rate: 0.86 }] };

  it("convertible, et le facteur vaut le taux du dollar", () => {
    expect(isPayCurrencyConvertible("usd", BLUSH, "eur")).toBe(true);
    expect(payCurrencyFactor("usd", BLUSH)).toBe(0.86);
    expect(unconvertiblePricingCurrency(BLUSH, RIEN, ["eur", "usd"])).toBeNull();
  });

  it("sans le taux du dollar : non convertible", () => {
    expect(isPayCurrencyConvertible("usd", { payCurrency: "eur" }, "eur")).toBe(false);
    expect(payCurrencyFactor("usd", { payCurrency: "eur" })).toBeNull();
    expect(unconvertiblePricingCurrency({ payCurrency: "eur" }, RIEN, ["usd"])).toBe("usd");
  });

  it("paie HORS de la cible sans taux de paie : un taux propre ne suffit pas", () => {
    // Snytch sans son taux du dollar : le taux du dinar ramène en euros, pas en dollars.
    const sansPaie: FxProject = { payCurrency: "usd", fxRatesToRevenue: [{ currency: "rsd", rate: 0.00852 }] };
    expect(isPayCurrencyConvertible("rsd", sansPaie, "eur")).toBe(false);
    expect(unconvertiblePricingCurrency(sansPaie, SNYTCH_ENCAISSE, ["rsd"])).toBe("rsd");
  });

  it("Snytch inchangé : l'euro vaut 1 / 0,86 $, le dinar 0,00852 / 0,86", () => {
    expect(payCurrencyFactor("eur", SNYTCH)).toBeCloseTo(1 / 0.86, 10);
    expect(payCurrencyFactor("rsd", SNYTCH)).toBeCloseTo(0.00852 / 0.86, 10);
    expect(unconvertiblePricingCurrency(SNYTCH, SNYTCH_ENCAISSE, ["usd", "eur"])).toBeNull();
  });
});
