import { describe, it, expect } from "vitest";
import {
  isComboAvailableForCreatorPlatform,
  usedComboKeysForCreatorPlatforms,
  type AssignmentComboUsage,
} from "./script-combo-uniqueness";

const X = "h1:f1:c1"; // comboKey de référence
const Y = "h2:f2:c2";

describe("isComboAvailableForCreatorPlatform", () => {
  it("PRIS : même créateur + même plateforme + même combo", () => {
    const existing: AssignmentComboUsage[] = [
      { creatorId: "bader", comboKey: X, platforms: ["TikTok"] },
    ];
    expect(
      isComboAvailableForCreatorPlatform({
        comboKey: X,
        creatorId: "bader",
        platform: "TikTok",
        existingAssignments: existing,
      }),
    ).toBe(false);
  });

  it("LIBRE : même créateur + même combo mais AUTRE plateforme (cross-plateforme OK)", () => {
    const existing: AssignmentComboUsage[] = [
      { creatorId: "bader", comboKey: X, platforms: ["TikTok"] },
    ];
    expect(
      isComboAvailableForCreatorPlatform({
        comboKey: X,
        creatorId: "bader",
        platform: "YouTube",
        existingAssignments: existing,
      }),
    ).toBe(true);
  });

  it("LIBRE : même combo + même plateforme mais AUTRE créateur", () => {
    const existing: AssignmentComboUsage[] = [
      { creatorId: "bader", comboKey: X, platforms: ["TikTok"] },
    ];
    expect(
      isComboAvailableForCreatorPlatform({
        comboKey: X,
        creatorId: "marielle",
        platform: "TikTok",
        existingAssignments: existing,
      }),
    ).toBe(true);
  });

  it("PRIS via un assignment multi-cibles (TikTok+YouTube)", () => {
    const existing: AssignmentComboUsage[] = [
      { creatorId: "bader", comboKey: X, platforms: ["TikTok", "YouTube"] },
    ];
    expect(
      isComboAvailableForCreatorPlatform({
        comboKey: X,
        creatorId: "bader",
        platform: "YouTube",
        existingAssignments: existing,
      }),
    ).toBe(false);
  });

  it("comboKey null/absent ignoré", () => {
    const existing: AssignmentComboUsage[] = [
      { creatorId: "bader", comboKey: null, platforms: ["TikTok"] },
    ];
    expect(
      isComboAvailableForCreatorPlatform({
        comboKey: X,
        creatorId: "bader",
        platform: "TikTok",
        existingAssignments: existing,
      }),
    ).toBe(true);
  });

  it("LIBRE : une ligne à combo IMPOSÉ ne bloque pas (reste dispo en auto)", () => {
    const existing: AssignmentComboUsage[] = [
      {
        creatorId: "bader",
        comboKey: X,
        platforms: ["TikTok"],
        comboImposed: true,
      },
    ];
    // Même créateur + même plateforme + même combo, mais imposé → toujours dispo.
    expect(
      isComboAvailableForCreatorPlatform({
        comboKey: X,
        creatorId: "bader",
        platform: "TikTok",
        existingAssignments: existing,
      }),
    ).toBe(true);
  });
});

describe("usedComboKeysForCreatorPlatforms", () => {
  const existing: AssignmentComboUsage[] = [
    { creatorId: "bader", comboKey: X, platforms: ["TikTok"] },
    { creatorId: "bader", comboKey: Y, platforms: ["YouTube"] },
    { creatorId: "marielle", comboKey: X, platforms: ["TikTok"] },
  ];

  it("union des combos pris sur les plateformes ciblées (TikTok)", () => {
    const used = usedComboKeysForCreatorPlatforms({
      creatorId: "bader",
      platforms: ["TikTok"],
      existingAssignments: existing,
    });
    expect([...used]).toEqual([X]); // Y est sur YouTube → pas exclu pour TikTok
  });

  it("cible multi-plateformes : exclut un combo pris sur l'une OU l'autre", () => {
    const used = usedComboKeysForCreatorPlatforms({
      creatorId: "bader",
      platforms: ["TikTok", "YouTube"],
      existingAssignments: existing,
    });
    expect([...used].sort()).toEqual([X, Y]);
  });

  it("isole par créateur : les combos de marielle n'excluent rien pour bader", () => {
    const used = usedComboKeysForCreatorPlatforms({
      creatorId: "bader",
      platforms: ["Instagram"],
      existingAssignments: existing,
    });
    expect(used.size).toBe(0);
  });

  it("ignore les lignes à combo IMPOSÉ : le triplet imposé reste piochable", () => {
    const withImposed: AssignmentComboUsage[] = [
      // X posé en AUTO (consomme) ; Y posé en IMPOSÉ (ne consomme pas).
      { creatorId: "bader", comboKey: X, platforms: ["TikTok"] },
      {
        creatorId: "bader",
        comboKey: Y,
        platforms: ["TikTok"],
        comboImposed: true,
      },
    ];
    const used = usedComboKeysForCreatorPlatforms({
      creatorId: "bader",
      platforms: ["TikTok"],
      existingAssignments: withImposed,
    });
    expect([...used]).toEqual([X]); // Y (imposé) exclu du set → reste dispo en auto
  });
});
