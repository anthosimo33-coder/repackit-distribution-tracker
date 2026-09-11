import { describe, it, expect } from "vitest";
import { splitCostByMarket } from "../convex/marketCost";

/**
 * Répartition du coût d'une assignation entre ses marchés. Ce qui se joue :
 * qu'un pays paraisse moins cher qu'il ne l'est, et que la somme des pays cesse
 * d'égaler le total de l'écran de paie.
 */

// La forme de la prod : le couple GB + RS des comptes de Veljko, des vues
// déséquilibrées, et un coût à deux décimales.
const GB_RS = [
  { country: "RS", views: 40_180 },
  { country: "GB", views: 9_820 },
];

describe("splitCostByMarket", () => {
  it("un seul marché reçoit tout, sans arrondi introduit", () => {
    expect(
      splitCostByMarket(64.37, [
        { country: "FR", views: 12_000 },
        { country: "FR", views: 3_000 },
      ]),
    ).toEqual([{ country: "FR", cost: 64.37, weight: 1 }]);
  });

  it("deux marchés se partagent au prorata des vues", () => {
    const parts = splitCostByMarket(100, GB_RS);
    expect(parts.find((p) => p.country === "RS")!.cost).toBe(80.36);
    expect(parts.find((p) => p.country === "GB")!.cost).toBe(19.64);
  });

  it("la somme des parts rend EXACTEMENT le coût", () => {
    // Trois parts égales sur un montant indivisible par trois : 0,33 × 3 = 0,99.
    // C'est le centime perdu, et l'écart que personne ne sait expliquer six mois
    // plus tard en comparant la somme des pays au total de l'écran de paie.
    const parts = splitCostByMarket(1, [
      { country: "FR", views: 500 },
      { country: "RS", views: 500 },
      { country: "GB", views: 500 },
    ]);
    expect(parts.reduce((s, p) => s + p.cost, 0)).toBe(1);
  });

  it("sans aucune vue relevée, le partage est ÉGAL", () => {
    // Une vidéo publiée hier, ou que le relevé n'a pas rattrapée : aucune vue
    // des deux côtés. Répartir au prorata donnerait 0/0.
    const parts = splitCostByMarket(9, [
      { country: "RS", views: 0 },
      { country: "GB", views: 0 },
    ]);
    expect(parts.map((p) => p.cost).sort()).toEqual([4.5, 4.5]);
  });

  it("un compte sans pays cible garde sa part, il ne la donne pas", () => {
    // Sinon le coût « hors marché » se diluerait en silence dans les pays
    // renseignés — exactement ce que la ligne ambre de l'écran refuse.
    const parts = splitCostByMarket(50, [
      { country: "FR", views: 3_000 },
      { country: null, views: 1_000 },
    ]);
    expect(parts.find((p) => p.country === null)!.cost).toBe(12.5);
    expect(parts.find((p) => p.country === "FR")!.cost).toBe(37.5);
  });

  it("aucune cible ⇒ aucune part (jamais une ligne à zéro)", () => {
    expect(splitCostByMarket(42, [])).toEqual([]);
  });
});
