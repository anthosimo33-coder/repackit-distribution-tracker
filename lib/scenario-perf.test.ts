import { describe, it, expect } from "vitest";
import { agregerParScenario, mediane } from "../convex/scenarioPerf";

/**
 * Performance par scénario — un scénario qui tourne dans deux campagnes cumule
 * ses posts ; le détail par campagne reste lisible. Vues de la forme réelle
 * (pas de nombres ronds).
 */
const C2 = "kx7scen0000000000000000000000c2";
const A1 = "kx7scen0000000000000000000000a1";
const CAMP_C = "kh7camp000000000000000000blushc";
const CAMP_E = "kh7camp000000000000000000blushe";

describe("agregerParScenario", () => {
  const perf = agregerParScenario([
    { scenarioId: C2, campaignId: CAMP_C, vues: 48_211 },
    { scenarioId: C2, campaignId: CAMP_C, vues: 2_904 },
    { scenarioId: C2, campaignId: CAMP_E, vues: 131_877 },
    { scenarioId: A1, campaignId: CAMP_C, vues: 917 },
  ]);

  it("cumule les campagnes d'un même scénario", () => {
    const c2 = perf.find((s) => s.scenarioId === C2)!;
    expect(c2.posts).toBe(3);
    expect(c2.vuesMediane).toBe(48_211);
    expect(c2.campagnes).toEqual([
      { campaignId: CAMP_C, posts: 2, vuesMediane: (48_211 + 2_904) / 2 },
      { campaignId: CAMP_E, posts: 1, vuesMediane: 131_877 },
    ]);
  });

  it("range les scénarios du plus regardé au moins regardé", () => {
    expect(perf.map((s) => s.scenarioId)).toEqual([C2, A1]);
  });

  it("ne crée pas de scénario sans échantillon", () => {
    expect(agregerParScenario([])).toEqual([]);
  });
});

describe("mediane", () => {
  it("prend la moyenne des deux valeurs du milieu sur un nombre pair", () => {
    expect(mediane([3_917, 12_480])).toBe(8_198.5);
    expect(mediane([5, 1, 3])).toBe(3);
    expect(mediane([])).toBeNull();
  });
});
