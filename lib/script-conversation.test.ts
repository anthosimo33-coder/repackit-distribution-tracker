import { describe, it, expect } from "vitest";
import {
  conversationUsageOf,
  drawableConversations,
  graineMission,
  isConversationEnabled,
  pickConversations,
  type ConversationUsageRow,
} from "../convex/scriptConversation";

/**
 * Brique Conversation — rotation équilibrée hors combo, la même que la notif,
 * lue sur `assignments.conversationBrickId` (hors du combo). Les ids, statuts et
 * libellés ont la forme de la production.
 */
const FILE = { storageId: "kg2abc", name: "WhatsApp Chat - Jules.txt" };
function conv(
  id: string,
  extra: Partial<{ active: boolean; files: unknown[]; order: number; kind: string; scenarioId: string }> = {},
) {
  return {
    _id: id,
    kind: extra.kind ?? "conversation",
    active: extra.active ?? true,
    content: "Il répond « mdr » à 5h52",
    conversationFiles: extra.files ?? [FILE],
    createdAt: 1_760_000_000_000,
    ...(extra.order !== undefined ? { order: extra.order } : {}),
    ...(extra.scenarioId !== undefined ? { scenarioId: extra.scenarioId } : {}),
  };
}
const A1 = "kd7conv0000000000000000000000a1";
const C2 = "kd7conv0000000000000000000000c2";
const B1 = "kd7conv0000000000000000000000b1";
const CAMP = "kh7camp000000000000000000000blsh";
const OTHER_CAMP = "kh7camp00000000000000000000other";
const KELLY = "kn7crea00000000000000000000kelly";
const JULIETTE = "kn7crea0000000000000000000julie";
const FREEING = new Set(["video_rejected", "cancelled"]);

function row(creatorId: string, conversationBrickId: string | undefined, extra: Partial<ConversationUsageRow> = {}): ConversationUsageRow {
  return {
    creatorId,
    status: "todo",
    scriptCombo: { campaignId: CAMP },
    ...(conversationBrickId ? { conversationBrickId } : {}),
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

describe("drawableConversations", () => {
  it("écarte une conversation sans fichier, inactive, ou d'un autre kind", () => {
    const out = drawableConversations([
      conv(A1),
      conv(C2, { files: [] }),
      conv(B1, { active: false }),
      conv("kd7notif", { kind: "notif" }),
    ]);
    expect(out.map((b) => b._id)).toEqual([A1]);
  });

  it("garde l'ordre de la liste", () => {
    const out = drawableConversations([conv(A1, { order: 2 }), conv(C2, { order: 1 })]);
    expect(out.map((b) => b._id)).toEqual([C2, A1]);
  });
});

describe("conversationUsageOf", () => {
  it("compte par créatrice et par campagne, hors statuts libérants et hors autre campagne", () => {
    const usage = conversationUsageOf(
      [
        row(KELLY, A1),
        row(KELLY, A1, { status: "video_rejected" }),
        row(JULIETTE, A1),
        row(JULIETTE, C2),
        row(KELLY, C2, { scriptCombo: { campaignId: OTHER_CAMP } }),
        row(KELLY, undefined),
      ],
      { campaignId: CAMP, creatorId: KELLY, freeingStatuses: FREEING },
    );
    expect(Object.fromEntries(usage.creator)).toEqual({ [A1]: 1 });
    expect(Object.fromEntries(usage.campaign)).toEqual({ [A1]: 2, [C2]: 1 });
  });

  it("lit la conversation HORS du combo : une notif du combo ne compte pas", () => {
    const usage = conversationUsageOf(
      [{ creatorId: KELLY, status: "todo", scriptCombo: { campaignId: CAMP, notifBrickId: A1 } as never }],
      { campaignId: CAMP, creatorId: KELLY, freeingStatuses: FREEING },
    );
    expect(usage.campaign.size).toBe(0);
  });
});

describe("pickConversations", () => {
  const all = [conv(A1), conv(C2)];

  it("donne d'abord la conversation que la créatrice n'a pas encore tournée", () => {
    const usage = conversationUsageOf([row(KELLY, A1), row(JULIETTE, C2), row(JULIETTE, C2)], {
      campaignId: CAMP,
      creatorId: KELLY,
      freeingStatuses: FREEING,
    });
    expect(pickConversations(all, usage, 1).map((b) => b._id)).toEqual([C2]);
  });

  it("alterne sur plusieurs vidéos d'un même appel", () => {
    const usage = conversationUsageOf([], { campaignId: CAMP, creatorId: KELLY, freeingStatuses: FREEING });
    expect(pickConversations(all, usage, 3).map((b) => b._id)).toEqual([A1, C2, A1]);
  });

  it("rend un tableau vide sans conversation tirable", () => {
    const usage = conversationUsageOf([], { campaignId: CAMP, creatorId: KELLY, freeingStatuses: FREEING });
    expect(pickConversations([], usage, 2)).toEqual([]);
  });
});

describe("conversations générées depuis un scénario", () => {
  const ACTIF = "kx7scen00000000000000000000actif";
  const BROUILLON = "kx7scen000000000000000000brouil";

  it("ne tire qu'une brique dont le scénario est ACTIF, même sans fichier déposé", () => {
    const out = drawableConversations(
      [
        conv(A1, { files: [], scenarioId: ACTIF }),
        conv(C2, { files: [], scenarioId: BROUILLON }),
        conv(B1, { files: [] }),
      ],
      new Set([ACTIF]),
    );
    expect(out.map((b) => b._id)).toEqual([A1]);
  });

  it("le scénario décide : des fichiers restés sur une brique à scénario inactif ne la rendent pas tirable", () => {
    expect(drawableConversations([conv(A1, { scenarioId: BROUILLON })], new Set([ACTIF]))).toEqual([]);
    // Présence : la même brique, scénario actif.
    expect(drawableConversations([conv(A1, { scenarioId: BROUILLON })], new Set([BROUILLON]))).toHaveLength(1);
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
