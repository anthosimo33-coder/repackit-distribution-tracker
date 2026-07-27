import { describe, it, expect } from "vitest";
import {
  passesWarmupMode,
  filterByWarmupMode,
  DEFAULT_WARMUP_MODE,
  type WarmupMode,
} from "./warmup-mode";
// Réplique serveur (A6) importée en RELATIF : le test verrouille la parité des
// DEUX implémentations. Le module convex est PUR (aucun import `_generated`),
// donc chargeable tel quel par vitest.
import * as convexWarmup from "../convex/warmupMode";

const MODES: WarmupMode[] = ["all", "exclude", "only"];

describe("passesWarmupMode — sémantique", () => {
  it("'all' laisse tout passer", () => {
    expect(passesWarmupMode(true, "all")).toBe(true);
    expect(passesWarmupMode(false, "all")).toBe(true);
  });
  it("'exclude' retire les posts warmup (défaut)", () => {
    expect(passesWarmupMode(true, "exclude")).toBe(false);
    expect(passesWarmupMode(false, "exclude")).toBe(true);
  });
  it("'only' ne garde que les posts warmup", () => {
    expect(passesWarmupMode(true, "only")).toBe(true);
    expect(passesWarmupMode(false, "only")).toBe(false);
  });
  it("le défaut produit est 'exclude'", () => {
    expect(DEFAULT_WARMUP_MODE).toBe("exclude");
  });
});

describe("filterByWarmupMode — liste", () => {
  const posts = [
    { id: "a", warm: false, vues: 100 },
    { id: "b", warm: true, vues: 999 },
    { id: "c", warm: false, vues: 50 },
    { id: "d", warm: true, vues: 40 },
  ];
  const get = (p: (typeof posts)[number]) => p.warm;

  it("'exclude' ne garde que les monétisés", () => {
    expect(filterByWarmupMode(posts, get, "exclude").map((p) => p.id)).toEqual([
      "a",
      "c",
    ]);
  });
  it("'only' ne garde que la chauffe", () => {
    expect(filterByWarmupMode(posts, get, "only").map((p) => p.id)).toEqual([
      "b",
      "d",
    ]);
  });
  it("'all' garde tout, ordre préservé", () => {
    expect(filterByWarmupMode(posts, get, "all").map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
  it("liste vide → liste vide", () => {
    expect(filterByWarmupMode([], get, "exclude")).toEqual([]);
  });
});

describe("parité lib/ ↔ convex/ (règle A6)", () => {
  it("DEFAULT_WARMUP_MODE identique", () => {
    expect(convexWarmup.DEFAULT_WARMUP_MODE).toBe(DEFAULT_WARMUP_MODE);
  });

  it("passesWarmupMode identique sur toutes les entrées", () => {
    for (const warm of [true, false]) {
      for (const mode of MODES) {
        expect(convexWarmup.passesWarmupMode(warm, mode)).toBe(
          passesWarmupMode(warm, mode),
        );
      }
    }
  });

  it("filterByWarmupMode identique sur un échantillon", () => {
    const sample = [
      { warm: true },
      { warm: false },
      { warm: false },
      { warm: true },
    ];
    const get = (x: { warm: boolean }) => x.warm;
    for (const mode of MODES) {
      expect(convexWarmup.filterByWarmupMode(sample, get, mode)).toEqual(
        filterByWarmupMode(sample, get, mode),
      );
    }
  });
});
