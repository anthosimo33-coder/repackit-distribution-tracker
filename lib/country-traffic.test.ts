import { describe, it, expect } from "vitest";
import {
  countryTrafficRows,
  shareGap,
  MIN_COUNTRY_SAMPLE,
  type CountrySteps,
} from "./country-traffic";

/**
 * Trafic et conversion par pays. Les chiffres du jeu d'essai sont ceux relevés
 * en prod le 11/09/2026 — c'est leur DÉSÉQUILIBRE qui compte : la Serbie pèse
 * autant de checkouts que la Belgique et n'a presque aucun client, et c'est
 * exactement ce que l'écran doit rendre lisible.
 */
const PROD: CountrySteps[] = [
  { country: "FR", visitors: 19_370, paywall: 11_477, checkouts: 1_962, clients: 386 },
  { country: "RS", visitors: 2_465, paywall: 1_047, checkouts: 265, clients: 7 },
  { country: "BE", visitors: 888, paywall: 472, checkouts: 87, clients: 10 },
  { country: "BA", visitors: 798, paywall: 354, checkouts: 82, clients: 1 },
  // Sous le seuil : un taux calculé sur 12 visiteurs n'est pas une mesure.
  { country: "LU", visitors: 12, paywall: 6, checkouts: 3, clients: 2 },
];

describe("countryTrafficRows", () => {
  it("classe par volume de checkouts, pas par visiteurs", () => {
    expect(countryTrafficRows(PROD).map((r) => r.country)).toEqual([
      "FR",
      "RS",
      "BE",
      "BA",
      "LU",
    ]);
  });

  it("le taux se lit sur les VISITEURS, mêmes personnes des deux bouts", () => {
    const fr = countryTrafficRows(PROD).find((r) => r.country === "FR")!;
    expect(fr.conversion).toBeCloseTo(386 / 19_370, 6);
  });

  it("sous le seuil d'effectif, aucun taux — pas un zéro", () => {
    // 2 clients sur 12 visiteurs feraient 16,7 %, le meilleur taux du tableau.
    const lu = countryTrafficRows(PROD).find((r) => r.country === "LU")!;
    expect(lu.visitors).toBeLessThan(MIN_COUNTRY_SAMPLE);
    expect(lu.conversion).toBeNull();
    expect(lu.clients).toBe(2);
  });

  it("les parts additionnent 100 % de chaque côté", () => {
    const rows = countryTrafficRows(PROD);
    expect(rows.reduce((s, r) => s + (r.checkoutShare ?? 0), 0)).toBeCloseTo(1, 9);
    expect(rows.reduce((s, r) => s + (r.clientShare ?? 0), 0)).toBeCloseTo(1, 9);
  });

  it("aucun client du tout : les parts clients sont ABSENTES, pas nulles", () => {
    // Un projet dont l'achat n'est pas encore instrumenté. Des parts à 0 %
    // partout se liraient « personne ne convertit », ce qui est une mesure.
    const rows = countryTrafficRows(
      PROD.map((c) => ({ ...c, clients: 0 })),
    );
    expect(rows.every((r) => r.clientShare === null)).toBe(true);
    expect(rows.every((r) => r.checkoutShare !== null)).toBe(true);
  });
});

describe("shareGap — l'écart entre l'intention et l'achat", () => {
  it("négatif là où le trafic ne se transforme pas", () => {
    const rs = countryTrafficRows(PROD).find((r) => r.country === "RS")!;
    // 11 % des checkouts, 1,7 % des clients : l'écart est l'information.
    expect(shareGap(rs)).toBeLessThan(-0.07);
  });

  it("positif là où il se transforme mieux que sa part d'intention", () => {
    // La France : 82 % des checkouts, 95 % des clients. C'est le SEUL pays
    // positif du relevé — la Belgique aussi convertit sous sa part d'intention
    // (−1,2 pt), ce que j'attendais d'abord au-dessus. Le jeu de prod a corrigé
    // l'intuition, pas l'inverse.
    const fr = countryTrafficRows(PROD).find((r) => r.country === "FR")!;
    expect(shareGap(fr)).toBeGreaterThan(0.1);
  });

  it("une part manquante ne devient pas un écart nul", () => {
    const rows = countryTrafficRows(PROD.map((c) => ({ ...c, clients: 0 })));
    expect(shareGap(rows[0])).toBeNull();
  });
});
