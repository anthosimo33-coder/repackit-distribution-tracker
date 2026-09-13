import { describe, expect, it } from "vitest";
import { CREATOR_TABS, activeCreatorTab, creatorTabsFor } from "./creator-nav";

describe("activeCreatorTab", () => {
  it("la racine allume « Aujourd'hui », sous ses deux écritures", () => {
    expect(activeCreatorTab("")).toBe("today");
    expect(activeCreatorTab("/")).toBe("today");
  });

  it("chaque ancienne page allume l'onglet qui la range", () => {
    expect(activeCreatorTab("/missions")).toBe("missions");
    expect(activeCreatorTab("/assignments/k97a3x8y2m1q4z6w0n5b7c9d8e")).toBe("missions");
    expect(activeCreatorTab("/paiements")).toBe("gains");
    expect(activeCreatorTab("/progression")).toBe("gains");
    expect(activeCreatorTab("/videos")).toBe("gains");
    expect(activeCreatorTab("/comptes")).toBe("moi");
    expect(activeCreatorTab("/profil")).toBe("moi");
    expect(activeCreatorTab("/guide")).toBe("moi");
    expect(activeCreatorTab("/fichiers")).toBe("moi");
    expect(activeCreatorTab("/outils")).toBe("moi");
  });

  it("correspondance par segment : « /moisson » n'est pas sous « /moi »", () => {
    expect(activeCreatorTab("/moisson")).toBeNull();
    expect(activeCreatorTab("/gainsbourg")).toBeNull();
    // Présence appariée : le vrai segment, lui, correspond.
    expect(activeCreatorTab("/moi")).toBe("moi");
    expect(activeCreatorTab("/gains/")).toBe("gains");
  });
});

describe("creatorTabsFor", () => {
  it("quatre onglets pour la créatrice", () => {
    expect(creatorTabsFor({ argent: true }).map((t) => t.key)).toEqual([
      "today",
      "missions",
      "gains",
      "moi",
    ]);
  });

  it("sans le droit d'argent, « Gains » disparaît et rien d'autre", () => {
    expect(creatorTabsFor({ argent: false }).map((t) => t.key)).toEqual([
      "today",
      "missions",
      "moi",
    ]);
  });

  it("aucune page n'est rangée sous deux onglets", () => {
    const all = CREATOR_TABS.flatMap((t) => t.owns);
    expect(new Set(all).size).toBe(all.length);
  });
});
