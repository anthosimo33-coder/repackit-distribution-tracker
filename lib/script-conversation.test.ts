import { describe, it, expect } from "vitest";
import {
  cleTheme,
  graineMission,
  pickScenarios,
  scenarioUsageOf,
  scenariosTirables,
  type ScenarioUsageRow,
} from "../convex/scriptConversation";

/**
 * Conversation d'une vidéo — l'assignation choisit un THÈME, chaque vidéo tire
 * un scénario de ce thème (sauf archivé), en rotation équilibrée hors combo
 * (celle de la notif), lue sur `assignments.scenarioId`. Ids, statuts et thèmes
 * ont la forme de la production.
 */
const C2 = "kx7scen0000000000000000000000c2";
const C3 = "kx7scen0000000000000000000000c3";
const A1 = "kx7scen0000000000000000000000a1";
const E4 = "kx7scen0000000000000000000000e4";
const CAMP = "kh7camp000000000000000000000blsh";
const OTHER_CAMP = "kh7camp00000000000000000000other";
const KELLY = "kn7crea00000000000000000000kelly";
const JULIETTE = "kn7crea0000000000000000000julie";
const FREEING = new Set(["video_rejected", "cancelled"]);

function scenario(_id: string, theme: string, statut = "actif", createdAt = 1_760_400_000_000) {
  return { _id, theme, statut, createdAt };
}
const PROJET = [
  scenario(C3, "Il revient", "actif", 1_760_500_000_000),
  scenario(C2, "Il revient ", "actif", 1_760_400_000_000),
  scenario(A1, "La dispute", "actif"),
  scenario(E4, "il revient", "archive"),
];

function row(creatorId: string, scenarioId: string | undefined, extra: Partial<ScenarioUsageRow> = {}): ScenarioUsageRow {
  return {
    creatorId,
    status: "todo",
    scriptCombo: { campaignId: CAMP },
    ...(scenarioId ? { scenarioId } : {}),
    ...extra,
  };
}

describe("thèmes", () => {
  it("compare sans casse ni espaces autour", () => {
    expect(cleTheme("  Il revient ")).toBe(cleTheme("il REVIENT"));
  });
});

describe("scenariosTirables", () => {
  it("garde ceux du thème choisi, du plus ancien au plus récent, sans les archivés", () => {
    expect(scenariosTirables(PROJET, ["il revient"]).map((s) => s._id)).toEqual([C2, C3]);
  });

  it("un archivé ne part pas ; remis en service — ou ancien « brouillon » —, il part", () => {
    expect(scenariosTirables(PROJET, ["Il revient"]).map((s) => s._id)).not.toContain(E4);
    for (const statut of ["actif", "brouillon"]) {
      const remis = PROJET.map((s) => (s._id === E4 ? { ...s, statut } : s));
      expect(scenariosTirables(remis, ["Il revient"]).map((s) => s._id)).toContain(E4);
    }
  });

  it("aucun thème : rien à tirer", () => {
    expect(scenariosTirables(PROJET, [])).toEqual([]);
  });
});

describe("scenarioUsageOf", () => {
  it("compte par créatrice et par campagne, hors statuts libérants et hors autre campagne", () => {
    const usage = scenarioUsageOf(
      [
        row(KELLY, C2),
        row(KELLY, C2, { status: "video_rejected" }),
        row(JULIETTE, C2),
        row(JULIETTE, C3),
        row(KELLY, C3, { scriptCombo: { campaignId: OTHER_CAMP } }),
        row(KELLY, undefined),
      ],
      { campaignId: CAMP, creatorId: KELLY, freeingStatuses: FREEING },
    );
    expect(Object.fromEntries(usage.creator)).toEqual({ [C2]: 1 });
    expect(Object.fromEntries(usage.campaign)).toEqual({ [C2]: 2, [C3]: 1 });
  });
});

describe("pickScenarios", () => {
  const tirables = scenariosTirables(PROJET, ["Il revient"]);

  it("donne d'abord le scénario que la créatrice n'a pas encore tourné", () => {
    const usage = scenarioUsageOf([row(KELLY, C2), row(JULIETTE, C3), row(JULIETTE, C3)], {
      campaignId: CAMP,
      creatorId: KELLY,
      freeingStatuses: FREEING,
    });
    expect(pickScenarios(tirables, usage, 1).map((s) => s._id)).toEqual([C3]);
  });

  it("alterne sur plusieurs vidéos d'un même appel", () => {
    const usage = scenarioUsageOf([], { campaignId: CAMP, creatorId: KELLY, freeingStatuses: FREEING });
    expect(pickScenarios(tirables, usage, 3).map((s) => s._id)).toEqual([C2, C3, C2]);
  });

  it("rend un tableau vide sans scénario tirable", () => {
    const usage = scenarioUsageOf([], { campaignId: CAMP, creatorId: KELLY, freeingStatuses: FREEING });
    expect(pickScenarios([], usage, 2)).toEqual([]);
  });
});

describe("graineMission", () => {
  it("est stable pour une mission et différente d'une mission à l'autre", () => {
    const a = "kd73ppqhwfe8ycz6a3m7h0jhan7sfh8x";
    const b = "kd73ppqhwfe8ycz6a3m7h0jhan7sfh8y";
    expect(graineMission(a)).toBe(graineMission(a));
    expect(graineMission(a)).not.toBe(graineMission(b));
    expect(Number.isInteger(graineMission(a)) && graineMission(a) >= 0).toBe(true);
  });
});
