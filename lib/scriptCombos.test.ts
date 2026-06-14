import { describe, it, expect } from "vitest";
import {
  generateCombos,
  pickCombosForCreator,
  comboKeyOf,
  type ComboBrick,
} from "./scriptCombos";

/** Construit n bricks d'un kind donné (actives par défaut). */
function bricks(
  kind: ComboBrick["kind"],
  n: number,
  active = true,
  prefix: string = kind,
): ComboBrick[] {
  return Array.from({ length: n }, (_, i) => ({
    _id: `${prefix}${i}`,
    kind,
    content: `${kind} ${i}`,
    active,
  }));
}

describe("generateCombos", () => {
  it("produit le cartésien des actifs (2×2×2×2 = 16)", () => {
    const all = [
      ...bricks("hook", 2),
      ...bricks("corps", 2),
      ...bricks("flux", 2),
      ...bricks("cta", 2),
    ];
    const combos = generateCombos(all, "DEMO");
    expect(combos.length).toBe(16);
    // Chaque combo a un assembledScript figé, SANS étiquette de section.
    expect(combos[0].assembledScript).not.toContain("## Hook");
    expect(combos[0].assembledScript).toContain("DEMO");
  });

  it("reproduit 192 (campagne seedée : 24 hooks × 2 × 2 × 2)", () => {
    const all = [
      ...bricks("hook", 24),
      ...bricks("corps", 2),
      ...bricks("flux", 2),
      ...bricks("cta", 2),
    ];
    expect(generateCombos(all, "DEMO").length).toBe(192);
  });

  it("0 combo si un kind n'a aucune brick active", () => {
    const all = [
      ...bricks("hook", 3),
      ...bricks("corps", 2),
      ...bricks("flux", 2),
      // pas de cta
    ];
    expect(generateCombos(all, "DEMO").length).toBe(0);
  });

  it("ignore les bricks inactives", () => {
    const all = [
      ...bricks("hook", 2),
      ...bricks("corps", 2),
      ...bricks("flux", 2),
      ...bricks("cta", 1),
      ...bricks("cta", 1, false, "ctaOff"), // inactif → ignoré
    ];
    expect(generateCombos(all, "DEMO").length).toBe(8); // 2×2×2×1
  });
});

describe("pickCombosForCreator", () => {
  const all = [
    ...bricks("hook", 24),
    ...bricks("corps", 2),
    ...bricks("flux", 2),
    ...bricks("cta", 2),
  ];
  const combos = generateCombos(all, "DEMO"); // 192

  it("renvoie n combos DISTINCTS", () => {
    const picked = pickCombosForCreator(combos, new Set(), 5);
    expect(picked.length).toBe(5);
    const keys = picked.map(comboKeyOf);
    expect(new Set(keys).size).toBe(5);
  });

  it("maximise la diversité de hook (5 picks → 5 hooks distincts)", () => {
    const picked = pickCombosForCreator(combos, new Set(), 5);
    const hooks = new Set(picked.map((c) => c.hookBrickId));
    expect(hooks.size).toBe(5);
  });

  it("évite les combos déjà reçus (usedKeys)", () => {
    const first = pickCombosForCreator(combos, new Set(), 5);
    const usedKeys = new Set(first.map(comboKeyOf));
    const second = pickCombosForCreator(combos, usedKeys, 5);
    // Aucun chevauchement avec la 1re série.
    for (const c of second) expect(usedKeys.has(comboKeyOf(c))).toBe(false);
    expect(second.length).toBe(5);
  });

  it("épuisement : renvoie au plus le stock disponible", () => {
    const usedKeys = new Set(combos.slice(0, 190).map(comboKeyOf));
    const picked = pickCombosForCreator(combos, usedKeys, 5);
    expect(picked.length).toBe(2); // seulement 2 restants
  });

  it("n=0 → vide", () => {
    expect(pickCombosForCreator(combos, new Set(), 0)).toEqual([]);
  });
});
