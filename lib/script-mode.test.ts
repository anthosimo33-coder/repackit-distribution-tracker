import { describe, it, expect } from "vitest";
import {
  resolveBrickMode,
  brickModeDisplay,
  BRICK_MODE_OPTIONS,
  type BrickMode,
} from "./script-mode";

describe("resolveBrickMode — défaut rétrocompat", () => {
  it("absent / null / inconnu → les_deux", () => {
    expect(resolveBrickMode(undefined)).toBe("les_deux");
    expect(resolveBrickMode(null)).toBe("les_deux");
    expect(resolveBrickMode("")).toBe("les_deux");
    expect(resolveBrickMode("garbage")).toBe("les_deux");
  });
  it("valeurs valides renvoyées telles quelles", () => {
    expect(resolveBrickMode("dire")).toBe("dire");
    expect(resolveBrickMode("afficher")).toBe("afficher");
    expect(resolveBrickMode("les_deux")).toBe("les_deux");
  });
});

describe("brickModeDisplay — libellé + icône (lève l'ambiguïté)", () => {
  it("dire → 🗣️ À dire à l'oral", () => {
    expect(brickModeDisplay("dire")).toEqual({
      icon: "🗣️",
      labelKey: "scriptMode.hint.dire",
    });
  });
  it("afficher → 💬 À afficher en texte à l'écran", () => {
    expect(brickModeDisplay("afficher")).toEqual({
      icon: "💬",
      labelKey: "scriptMode.hint.afficher",
    });
  });
  it("les_deux → 🗣️💬 À dire ET afficher à l'écran", () => {
    expect(brickModeDisplay("les_deux")).toEqual({
      icon: "🗣️💬",
      labelKey: "scriptMode.hint.les_deux",
    });
  });
  it("les 3 modes ont un display distinct et non vide", () => {
    const modes: BrickMode[] = ["dire", "afficher", "les_deux"];
    const labels = modes.map((m) => brickModeDisplay(m).labelKey);
    expect(new Set(labels).size).toBe(3);
    for (const l of labels) expect(l.length).toBeGreaterThan(0);
  });
});

describe("BRICK_MODE_OPTIONS — sélecteur admin", () => {
  it("3 options couvrant exactement les 3 modes", () => {
    expect(BRICK_MODE_OPTIONS.map((o) => o.value)).toEqual([
      "dire",
      "afficher",
      "les_deux",
    ]);
  });
});
