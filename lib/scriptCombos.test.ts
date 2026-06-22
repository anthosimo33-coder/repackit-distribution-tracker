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

// ─── Diversité des 3 dimensions (hook/flux/cta) — fermeture du bug ────────────
// Angle mort historique : les tests ne couvraient que la diversité de hook à N=5
// (< 1 round). flux & cta restaient figés tant que N < hooks·cta → ces tests
// ÉCHOUENT sur l'ancien round-robin (flux/cta distincts = 1) et passent sur la
// sélection gloutonne least-used.
describe("pickCombosForCreator — diversité des 3 dimensions", () => {
  /** Campagne H hooks × F flux × C cta (ids hookN / fluxN / ctaN). */
  const campaign = (H: number, F: number, C: number) =>
    generateCombos([
      ...bricks("hook", H),
      ...bricks("flux", F),
      ...bricks("cta", C),
    ]);

  type Dim = "hookBrickId" | "fluxBrickId" | "ctaBrickId";
  const distinct = (picked: ReturnType<typeof campaign>, dim: Dim) =>
    new Set(picked.map((c) => c[dim])).size;
  const usage = (picked: ReturnType<typeof campaign>, dim: Dim) => {
    const m = new Map<string, number>();
    for (const c of picked) m.set(c[dim], (m.get(c[dim]) ?? 0) + 1);
    return [...m.values()];
  };
  const spread = (counts: number[]) =>
    Math.max(...counts) - Math.min(...counts);

  it("petit N (12/4/2, N=6) : flux ET cta varient (> 1 distinct)", () => {
    // Sur l'ancien round-robin : flux distinct = 1 ET cta distinct = 1 → ÉCHEC.
    const picked = pickCombosForCreator(campaign(12, 4, 2), new Set(), 6);
    expect(picked.length).toBe(6);
    expect(distinct(picked, "fluxBrickId")).toBeGreaterThan(1);
    expect(distinct(picked, "ctaBrickId")).toBeGreaterThan(1);
    // Hook reste maximalement divers (autant de hooks distincts que de picks).
    expect(distinct(picked, "hookBrickId")).toBe(6);
  });

  it("N=12 (12/4/2) : flux & cta pleinement variés et équilibrés", () => {
    const picked = pickCombosForCreator(campaign(12, 4, 2), new Set(), 12);
    expect(picked.length).toBe(12);
    expect(distinct(picked, "fluxBrickId")).toBe(4); // tous les flux
    expect(distinct(picked, "ctaBrickId")).toBe(2); // tous les cta
    expect(distinct(picked, "hookBrickId")).toBe(12);
    // Équilibre : écart d'usage minimal entre bricks d'une même dimension.
    expect(spread(usage(picked, "fluxBrickId"))).toBeLessThanOrEqual(1);
    expect(spread(usage(picked, "ctaBrickId"))).toBeLessThanOrEqual(1);
  });

  it("N=20 (12/4/2) : hooks réutilisés mais équilibrés, flux/cta variés", () => {
    const picked = pickCombosForCreator(campaign(12, 4, 2), new Set(), 20);
    expect(picked.length).toBe(20);
    expect(distinct(picked, "fluxBrickId")).toBe(4);
    expect(distinct(picked, "ctaBrickId")).toBe(2);
    expect(distinct(picked, "hookBrickId")).toBe(12); // 12 hooks, tous servis
    // 20 picks / 12 hooks → 8 hooks 2×, 4 hooks 1× → écart 1.
    expect(spread(usage(picked, "hookBrickId"))).toBeLessThanOrEqual(1);
    expect(spread(usage(picked, "fluxBrickId"))).toBeLessThanOrEqual(1);
    expect(spread(usage(picked, "ctaBrickId"))).toBeLessThanOrEqual(1);
  });

  it("cas piège F=4,C=2 (facteur commun 2) : pas de cas limite", () => {
    // N=8 = multiple de F et de C → équilibre PARFAIT (spread 0) attendu.
    const picked = pickCombosForCreator(campaign(12, 4, 2), new Set(), 8);
    expect(usage(picked, "fluxBrickId")).toEqual([2, 2, 2, 2]);
    expect(spread(usage(picked, "ctaBrickId"))).toBe(0); // 4 + 4
  });

  it("cas piège F=3,C=2 : équilibre tenu (aucun flux/cta figé)", () => {
    const picked = pickCombosForCreator(campaign(12, 3, 2), new Set(), 6);
    expect(distinct(picked, "fluxBrickId")).toBe(3);
    expect(distinct(picked, "ctaBrickId")).toBe(2);
    expect(spread(usage(picked, "fluxBrickId"))).toBeLessThanOrEqual(1);
    expect(spread(usage(picked, "ctaBrickId"))).toBeLessThanOrEqual(1);
  });

  it("déterministe : même entrée → même sortie (tie-break stable)", () => {
    const all = campaign(12, 4, 2);
    const a = pickCombosForCreator(all, new Set(), 10).map(comboKeyOf);
    const b = pickCombosForCreator(all, new Set(), 10).map(comboKeyOf);
    expect(a).toEqual(b);
  });

  it("usedKeys amorcent l'équilibre : le flux sur-servi est ensuite évité", () => {
    const all = campaign(12, 4, 2);
    // Simule une assignation passée bugguée : 6 combos tous sur flux0.
    const usedKeys = new Set(
      Array.from({ length: 6 }, (_, i) => `hook${i}:flux0:cta${i % 2}`),
    );
    const picked = pickCombosForCreator(all, usedKeys, 6);
    expect(picked.length).toBe(6);
    // flux0 est déjà saturé (6×) → la nouvelle sélection ne le re-pioche pas.
    expect(picked.every((c) => c.fluxBrickId !== "flux0")).toBe(true);
    // Et continue d'exclure les combos déjà pris (pas de doublon).
    for (const c of picked) expect(usedKeys.has(comboKeyOf(c))).toBe(false);
  });
});
