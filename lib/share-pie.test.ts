import { describe, expect, it } from "vitest";
import { pieSlices } from "./share-pie";

describe("pieSlices — camembert des vues par créatrice", () => {
  it("les pourcentages font toujours 100, même sur trois tiers", () => {
    const s = pieSlices([
      { key: "a", value: 41_237 },
      { key: "b", value: 41_237 },
      { key: "c", value: 41_237 },
    ]);
    expect(s.map((x) => x.percent).reduce((a, b) => a + b, 0)).toBe(100);
    expect(s.map((x) => x.percent).sort()).toEqual([33, 33, 34]);
  });

  it("au-delà de 5 parts, les plus petites deviennent « Autres » (clé null)", () => {
    const rows = [612_004, 398_117, 187_450, 121_903, 54_310, 27_866, 8_761].map(
      (value, i) => ({ key: `k${i}`, value }),
    );
    const s = pieSlices(rows);
    expect(s).toHaveLength(5);
    expect(s.slice(0, 4).map((x) => x.key)).toEqual(["k0", "k1", "k2", "k3"]);
    expect(s[4]).toMatchObject({ key: null, value: 54_310 + 27_866 + 8_761 });
    expect(s.reduce((a, x) => a + x.percent, 0)).toBe(100);
  });

  it("exactement 5 parts → pas de « Autres »", () => {
    const s = pieSlices([5, 4, 3, 2, 1].map((value, i) => ({ key: i, value: value * 1_003 })));
    expect(s.every((x) => x.key !== null)).toBe(true);
  });

  it("ignore les parts à zéro vue, rend [] sans aucune vue", () => {
    expect(pieSlices([{ key: "a", value: 0 }])).toEqual([]);
    const s = pieSlices([
      { key: "a", value: 0 },
      { key: "b", value: 8_761 },
    ]);
    expect(s).toEqual([{ key: "b", value: 8_761, percent: 100 }]);
  });

  it("classe par vues décroissantes, quelle que soit l'entrée", () => {
    const s = pieSlices([
      { key: "petite", value: 8_761 },
      { key: "grande", value: 198_402 },
    ]);
    expect(s.map((x) => x.key)).toEqual(["grande", "petite"]);
  });
});
