import { describe, it, expect } from "vitest";
import {
  cleTheme,
  graineMission,
  isConversationEnabled,
  pickScenarios,
  scenarioUsageOf,
  scenariosTirables,
  themesNettoyes,
  type ScenarioUsageRow,
} from "../convex/scriptConversation";

/**
 * Conversation d'une campagne — la campagne coche des THÈMES, chaque vidéo tire
 * un scénario ACTIF de ces thèmes, en rotation équilibrée hors combo (celle de
 * la notif), lue sur `assignments.scenarioId`. Ids, statuts et thèmes ont la
 * forme de la production.
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
  scenario(E4, "il revient", "brouillon"),
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

describe("isConversationEnabled", () => {
  it("n'est allumée que sur true explicite (absent = campagnes existantes inchangées)", () => {
    expect(isConversationEnabled({ conversationEnabled: true })).toBe(true);
    expect(isConversationEnabled({ conversationEnabled: false })).toBe(false);
    expect(isConversationEnabled({})).toBe(false);
    expect(isConversationEnabled(null)).toBe(false);
  });
});

describe("thèmes", () => {
  it("compare sans casse ni espaces autour", () => {
    expect(cleTheme("  Il revient ")).toBe(cleTheme("il REVIENT"));
  });

  it("nettoie la liste d'une campagne : blancs retirés, doublons fusionnés, ordre gardé", () => {
    expect(themesNettoyes(["La dispute", "  ", " Il revient", "la dispute"])).toEqual(["La dispute", "Il revient"]);
  });
});

describe("scenariosTirables", () => {
  it("ne garde que les ACTIFS des thèmes cochés, du plus ancien au plus récent", () => {
    expect(scenariosTirables(PROJET, ["il revient"]).map((s) => s._id)).toEqual([C2, C3]);
  });

  it("un brouillon du bon thème ne part pas ; actif, il part sans toucher à la campagne", () => {
    expect(scenariosTirables(PROJET, ["Il revient"]).map((s) => s._id)).not.toContain(E4);
    const active = PROJET.map((s) => (s._id === E4 ? { ...s, statut: "actif" } : s));
    expect(scenariosTirables(active, ["Il revient"]).map((s) => s._id)).toContain(E4);
  });

  it("aucun thème coché : rien à tirer", () => {
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
