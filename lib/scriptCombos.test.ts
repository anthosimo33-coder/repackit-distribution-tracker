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
  it("produit le cartésien des actifs (2×2×2 = 8)", () => {
    const all = [...bricks("hook", 2), ...bricks("flux", 2), ...bricks("cta", 2)];
    const combos = generateCombos(all);
    expect(combos.length).toBe(8);
    // assembledScript figé, SANS étiquette de section ni socle démo.
    expect(combos[0].assembledScript).not.toContain("## Hook");
    expect(combos[0].assembledScript).toContain("hook 0");
    expect(combos[0].assembledScript).toContain("flux 0");
    expect(combos[0].assembledScript).toContain("cta 0");
  });

  it("reproduit 104 (campagne seedée : 26 hooks × 2 flux × 2 cta)", () => {
    const all = [
      ...bricks("hook", 26),
      ...bricks("flux", 2),
      ...bricks("cta", 2),
    ];
    expect(generateCombos(all).length).toBe(104);
  });

  it("0 combo si un kind n'a aucune brick active", () => {
    const all = [
      ...bricks("hook", 3),
      ...bricks("flux", 2),
      // pas de cta
    ];
    expect(generateCombos(all).length).toBe(0);
  });

  it("ignore les bricks inactives", () => {
    const all = [
      ...bricks("hook", 2),
      ...bricks("flux", 2),
      ...bricks("cta", 1),
      ...bricks("cta", 1, false, "ctaOff"), // inactif → ignoré
    ];
    expect(generateCombos(all).length).toBe(4); // 2×2×1
  });

  it("comboKey = hook:flux:cta (3 segments)", () => {
    const all = [...bricks("hook", 1), ...bricks("flux", 1), ...bricks("cta", 1)];
    const key = comboKeyOf(generateCombos(all)[0]);
    expect(key.split(":")).toHaveLength(3);
    expect(key).toBe("hook0:flux0:cta0");
  });
});

describe("pickCombosForCreator", () => {
  const all = [...bricks("hook", 26), ...bricks("flux", 2), ...bricks("cta", 2)];
  const combos = generateCombos(all); // 104

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
    const usedKeys = new Set(combos.slice(0, 102).map(comboKeyOf));
    const picked = pickCombosForCreator(combos, usedKeys, 5);
    expect(picked.length).toBe(2); // seulement 2 restants
  });

  it("n=0 → vide", () => {
    expect(pickCombosForCreator(combos, new Set(), 0)).toEqual([]);
  });
});
