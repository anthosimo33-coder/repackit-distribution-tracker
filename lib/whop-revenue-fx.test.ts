process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { summarizeWhopRevenue, type WhopPaymentLike } from "./whop-revenue";
import * as srv from "../convex/whopRevenue";

/**
 * BI-DEVISE : le régime NORMAL depuis le 06/09/2026, pas une anomalie. La grille
 * en euros est servie aux résidents européens, celle en dollars aux autres.
 *
 * Le zérotage d'origine vidait TOUS les écrans financiers — revenu, marge, RPM —
 * dès la première vente hors Europe. Constaté en prod : « Revenu Whop 0,00 » sur
 * 231 paiements bien réels.
 */
const paye = (
  currency: string,
  gross: number,
  net: number,
): WhopPaymentLike => ({
  status: "paid",
  grossAmount: gross,
  feeAmount: gross - net,
  netAmount: net,
  refundedAmount: 0,
  currency,
});

/** Taux du projet Snytch : 1 $ = 0,86 €. Posé à la main, jamais rafraîchi. */
const FX = [{ from: "usd", rate: 0.86 }];

const MIXTE: WhopPaymentLike[] = [
  paye("eur", 9.99, 9.2),
  paye("eur", 29.99, 27.8),
  paye("usd", 11.99, 11.0),
  paye("usd", 19.99, 18.5),
];

describe("summarizeWhopRevenue — bi-devise", () => {
  it("SANS taux, les montants restent à zéro (comportement d'origine)", () => {
    const s = summarizeWhopRevenue(MIXTE);
    expect(s.mixedCurrency).toBe(true);
    expect(s.net).toBe(0);
    expect(s.conversions).toEqual([]);
    // Le détail par devise, lui, a toujours été juste : c'est la somme qui
    // manquait, pas la donnée.
    expect(s.byCurrency).toHaveLength(2);
  });

  it("AVEC le taux, le total devient additionnable et le DIT", () => {
    const s = summarizeWhopRevenue(MIXTE, FX);
    // 9,20 + 27,80 = 37,00 € ; (11,00 + 18,50) × 0,86 = 25,37 €
    expect(s.net).toBe(62.37);
    expect(s.currency).toBe("eur");
    expect(s.conversions).toEqual([{ from: "usd", rate: 0.86 }]);
    // `mixedCurrency` retombe à faux : les montants SONT additionnables. Le
    // fait qu'il y ait deux devises reste lisible ailleurs.
    expect(s.mixedCurrency).toBe(false);
    expect(s.currencies.sort()).toEqual(["eur", "usd"]);
    expect(s.paymentCount).toBe(4);
  });

  it("le taux de frais est recalculé sur les totaux convertis", () => {
    const s = summarizeWhopRevenue(MIXTE, FX);
    // brut = 39,98 + 31,98 × 0,86 = 67,48 ; net = 62,37 → frais 5,11
    expect(s.gross).toBe(67.48);
    expect(s.fees).toBe(5.11);
    // Un ratio survit à la conversion, contrairement à un montant.
    expect(s.feeRate).toBeCloseTo((67.48 - 62.37) / 67.48, 2);
  });

  it("TROIS devises retombent sur le zérotage", () => {
    // Le taux ne couvre qu'une paire : convertir la troisième donnerait un
    // montant faux d'apparence crédible.
    const s = summarizeWhopRevenue([...MIXTE, paye("gbp", 8.99, 8.3)], FX);
    expect(s.mixedCurrency).toBe(true);
    expect(s.net).toBe(0);
    expect(s.conversions).toEqual([]);
  });

  it("une paire que le taux NE CONNAÎT PAS retombe sur le zérotage", () => {
    const s = summarizeWhopRevenue(
      [paye("eur", 9.99, 9.2), paye("gbp", 8.99, 8.3)],
      FX,
    );
    expect(s.mixedCurrency).toBe(true);
    expect(s.net).toBe(0);
    // Contre-test de présence : la paire couverte, elle, se convertit bien.
    expect(summarizeWhopRevenue(MIXTE, FX).net).toBe(62.37);
  });

  it("un taux nul ou négatif ne convertit rien", () => {
    expect(summarizeWhopRevenue(MIXTE, [{ from: "usd", rate: 0 }]).net).toBe(0);
    expect(summarizeWhopRevenue(MIXTE, [{ from: "usd", rate: -1 }]).net).toBe(0);
  });

  it("une SEULE devise est inchangée, taux ou pas", () => {
    const uni = [paye("eur", 9.99, 9.2), paye("eur", 29.99, 27.8)];
    const sans = summarizeWhopRevenue(uni);
    const avec = summarizeWhopRevenue(uni, FX);
    expect(avec).toEqual(sans);
    expect(avec.net).toBe(37);
    expect(avec.conversions).toEqual([]);
  });

  it("la réplique convex donne EXACTEMENT le même résultat", () => {
    // Règle A6 : convex/ ne peut pas importer lib/, la logique est répliquée.
    // Deux copies qui divergent, c'est deux écrans qui affichent deux revenus.
    expect(srv.summarizeWhopRevenue(MIXTE, FX)).toEqual(
      summarizeWhopRevenue(MIXTE, FX),
    );
    expect(srv.summarizeWhopRevenue(MIXTE)).toEqual(summarizeWhopRevenue(MIXTE));
  });
});

describe("summarizeWhopRevenue — un taux PAR devise (dinar serbe, 13/09/2026)", () => {
  /** 1 RSD ≈ 0,0085 € : taux posé sur le projet, à côté de celui du dollar. */
  const FX3 = [...FX, { from: "rsd", rate: 0.0085 }];
  const TROIS = [...MIXTE, paye("rsd", 599, 540)];

  it("SANS taux dinar, UNE vente en dinars remet tout à zéro (le défaut vécu)", () => {
    const s = summarizeWhopRevenue(TROIS, FX);
    expect(s.mixedCurrency).toBe(true);
    expect(s.net).toBe(0);
  });

  it("AVEC un taux par devise, les trois se somment en euros et le DISENT", () => {
    const s = summarizeWhopRevenue(TROIS, FX3);
    // 62,37 € (cf plus haut) + 540 × 0,0085 = 4,59 € → 66,96 €
    expect(s.mixedCurrency).toBe(false);
    expect(s.currency).toBe("eur");
    expect(s.net).toBe(66.96);
    expect(s.conversions).toEqual([
      { from: "rsd", rate: 0.0085 },
      { from: "usd", rate: 0.86 },
    ]);
  });

  it("un taux dinar ne sert JAMAIS une autre devise", () => {
    const s = summarizeWhopRevenue([...TROIS, paye("gbp", 8.99, 8.3)], FX3);
    expect(s.mixedCurrency).toBe(true);
    expect(s.net).toBe(0);
  });

  it("toutes les devises encaissées ont un taux : aucune cible, zérotage", () => {
    const s = summarizeWhopRevenue(
      [paye("usd", 11.99, 11), paye("rsd", 599, 540)],
      FX3,
    );
    expect(s.mixedCurrency).toBe(true);
    expect(s.net).toBe(0);
  });

  it("la réplique convex donne EXACTEMENT le même résultat à trois devises", () => {
    expect(srv.summarizeWhopRevenue(TROIS, FX3)).toEqual(
      summarizeWhopRevenue(TROIS, FX3),
    );
  });

  it("projectFx assemble le taux de paie et les autres, un par devise", () => {
    const fx = srv.projectFx({
      payCurrency: "USD",
      fxRateToRevenue: 0.86,
      fxRatesToRevenue: [
        { currency: "RSD", rate: 0.0085 },
        { currency: "usd", rate: 9 }, // doublon de la paie : ignoré
        { currency: "gbp", rate: 0 }, // taux nul : ignoré
      ],
    });
    expect(fx).toEqual([
      { from: "usd", rate: 0.86 },
      { from: "rsd", rate: 0.0085 },
    ]);
    expect(srv.projectFx({ payCurrency: "usd" })).toBeNull();
  });

  it("whopNetInSummaryCurrency convertit chaque paiement à SON taux", () => {
    const s = summarizeWhopRevenue(TROIS, FX3);
    const somme = TROIS.reduce((t, p) => t + srv.whopNetInSummaryCurrency(p, s), 0);
    expect(Math.round(somme * 100) / 100).toBe(s.net);
  });
});
