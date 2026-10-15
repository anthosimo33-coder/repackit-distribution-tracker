import { describe, it, expect } from "vitest";
import { roundVideoCostsToCents, splitCostByMarket } from "../convex/marketCost";

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

describe("roundVideoCostsToCents", () => {
  // La forme de la prod : un mois de huit vidéos au CPM seul (1,85 $/1 000 vues),
  // tel que `videoCostsOfMonth` le rend — des coûts à cinq décimales. Arrondies
  // une à une, elles font 221,23 $ ; le moteur en compte 221,20 $.
  const vues = [27_603, 7_976, 15_144, 1_041, 8_000, 22_080, 7_587, 30_138];
  const mois = new Map(
    vues.map((v, i) => {
      const cpm = (v * 1.85) / 1000;
      return [`v${i}`, { cost: cpm, fixed: 0, cpm }];
    }),
  );
  const total = (m: Map<string, { cost: number }>) =>
    Math.round([...m.values()].reduce((s, c) => s + c.cost, 0) * 100) / 100;

  it("la somme des vidéos rend EXACTEMENT le total du moteur", () => {
    // Sans le recollement : 221,23 $, trois centimes de plus que la paie — la
    // dérive qui séparait l'onglet Pays de la Rentabilité en septembre 2026.
    expect(total(mois)).toBe(221.2);
    expect(total(roundVideoCostsToCents(mois))).toBe(221.2);
  });

  it("le reste d'arrondi rejoint la plus grosse vidéo, les autres sont au centime", () => {
    const out = roundVideoCostsToCents(mois);
    // 30 138 vues → 55,7553 $ : la plus grosse, qui absorbe les −0,03 $.
    expect(out.get("v7")!.cost).toBe(55.73);
    expect(out.get("v0")!.cost).toBe(51.07);
    expect(out.get("v3")!.cost).toBe(1.93);
  });

  it("garde le reste de la ligne (fixe, CPM, bonus)", () => {
    const out = roundVideoCostsToCents(
      new Map([["a", { cost: 12.3456, fixed: 4.5, cpm: 7.8456, bonus: 0 }]]),
    );
    expect(out.get("a")).toEqual({ cost: 12.35, fixed: 4.5, cpm: 7.8456, bonus: 0 });
  });

  it("des coûts déjà au centime ne bougent pas", () => {
    const deja = new Map([
      ["a", { cost: 43.32 }],
      ["b", { cost: 8.23 }],
    ]);
    expect(roundVideoCostsToCents(deja)).toEqual(deja);
  });
});
