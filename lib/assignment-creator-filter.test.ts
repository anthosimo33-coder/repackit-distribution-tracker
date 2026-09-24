import { describe, it, expect } from "vitest";
import { buildCreatorOptions } from "./assignment-creator-filter";
import { isCreatorInactive } from "./creator-status";

// Noms et statuts de la forme de la prod Snytch (2026-09-24) : emoji dans le
// nom, créatrice « churned » dont le compte tourne encore, créatrice supprimée
// (statut null, nom figé sur l'assignation), invitée à qui on prépare déjà des
// vidéos.

describe("isCreatorInactive", () => {
  it("en pause, partie ou supprimée = sortie ; invitée/onboarding = active", () => {
    expect(isCreatorInactive("paused")).toBe(true);
    expect(isCreatorInactive("churned")).toBe(true);
    expect(isCreatorInactive(null)).toBe(true);
    expect(isCreatorInactive(undefined)).toBe(true);
    expect(isCreatorInactive("active")).toBe(false);
    expect(isCreatorInactive("onboarding")).toBe(false);
    expect(isCreatorInactive("invited")).toBe(false);
  });
});

describe("buildCreatorOptions", () => {
  const a = (
    creatorId: string,
    creatorName: string,
    creatorStatus: "active" | "invited" | "churned" | "paused" | null,
  ) => ({ creatorId, creatorName, creatorStatus });

  it("actives d'abord puis sorties, alphabétique dans chaque section, effectif par créatrice", () => {
    const rows = [
      a("k1", "Kelly", "active"),
      a("ladidi", "Ladidi / Sam", null),
      a("k1", "Kelly", "active"),
      a("c1", "Cinthia", "churned"),
      a("e1", "Elena 🇨🇱", "active"),
      a("ab", "abbie", "invited"),
      a("k1", "Kelly", "active"),
      a("celia", "Celia", null),
      a("p1", "Orlane", "paused"),
    ];
    expect(buildCreatorOptions(rows)).toEqual([
      { value: "ab", label: "abbie", count: 1, section: "active" },
      { value: "e1", label: "Elena 🇨🇱", count: 1, section: "active" },
      { value: "k1", label: "Kelly", count: 3, section: "active" },
      { value: "celia", label: "Celia", count: 1, section: "inactive" },
      { value: "c1", label: "Cinthia", count: 1, section: "inactive" },
      { value: "ladidi", label: "Ladidi / Sam", count: 1, section: "inactive" },
      { value: "p1", label: "Orlane", count: 1, section: "inactive" },
    ]);
  });
});
