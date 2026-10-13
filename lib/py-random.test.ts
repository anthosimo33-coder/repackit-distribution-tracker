import { describe, it, expect } from "vitest";
import { PyRandom, sha512, timedeltaUs } from "../convex/pyRandom";
import vectors from "./__fixtures__/py-random-vectors.json";

/**
 * Hasard compatible Python — chaque valeur attendue a été RELEVÉE sur CPython
 * 3.14 (`random.Random("C2-Kelly-7")`, `datetime.timedelta`), pas recalculée :
 * c'est ce qui permet au moteur de scénarios de rendre l'export du Python à
 * l'octet près.
 */
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

describe("sha512", () => {
  it("donne le condensé de hashlib", () => {
    expect(hex(sha512(new TextEncoder().encode("C2-Kelly-7")))).toBe(vectors.sha512);
  });
});

describe("PyRandom", () => {
  it("random() reproduit CPython sur une graine chaîne", () => {
    const r = new PyRandom("C2-Kelly-7");
    expect(Array.from({ length: 8 }, () => r.random())).toEqual(vectors.random);
  });

  it("une graine avec accents et caractères hors ASCII (octets UTF-8)", () => {
    const r = new PyRandom("Inès-Ω-42");
    expect(Array.from({ length: 3 }, () => r.random())).toEqual(vectors.unicode_random);
  });

  it("getrandbits(1…32)", () => {
    const r = new PyRandom("C2-Kelly-7");
    expect(Array.from({ length: 32 }, (_, i) => r.getrandbits(i + 1))).toEqual(vectors.getrandbits);
  });

  it("randint, choice, choices pondérés, uniform et gauss s'enchaînent comme en Python", () => {
    const r = new PyRandom("C2-Kelly-7");
    const got: Array<[string, number | string]> = [];
    for (let i = 0; i < 40; i++) {
      got.push(["randint", r.randint(0, 59)]);
      got.push(["choice", r.choice([0, 1, 2, 3, 4, 5, 6])]);
      got.push(["choices", r.weightedChoice(["morning", "day", "evening", "night"], [0.2, 0.35, 0.3, 0.15])]);
      got.push(["choicesInt", r.weightedChoice([0, 1, 2, 3, 4], [0, 3, 0, 2, 1])]);
      got.push(["uniform", r.uniform(5, 60)]);
      got.push(["gauss", r.gauss(0, 0.7)]);
      got.push(["lognorm", 720 * Math.exp(r.gauss(0, 1.0))]);
    }
    const want = vectors.sequence as Array<[string, number | string]>;
    expect(got.map(([k]) => k)).toEqual(want.map(([k]) => k));
    got.forEach(([kind, value], i) => {
      const expected = want[i]![1];
      // gauss/lognorm passent par exp/log/cos/sin : la libm du système et celle
      // de V8 peuvent différer au DERNIER bit (7 tirages sur 280 ici). Tout le
      // reste — entiers, choix, uniform — est identique au bit près.
      if (kind === "gauss" || kind === "lognorm") {
        expect(Math.abs((value as number) - (expected as number))).toBeLessThanOrEqual(
          Math.abs(expected as number) * 1e-12,
        );
      } else {
        expect(value).toBe(expected);
      }
    });
  });
});

describe("timedeltaUs", () => {
  it("convertit minutes et secondes flottantes en microsecondes comme datetime.timedelta", () => {
    for (const [m, s, usMs, x, usX] of vectors.timedelta as number[][]) {
      expect(timedeltaUs({ minutes: m, seconds: s })).toBe(usMs);
      expect(timedeltaUs({ seconds: x })).toBe(usX);
    }
  });
});
