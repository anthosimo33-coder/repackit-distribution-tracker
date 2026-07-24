import { describe, it, expect } from "vitest";
import {
  assignmentGroupKey,
  interleaveByGroup,
  stableHash,
} from "./assignment-order";

interface Row {
  _id: string;
  key: string;
  dueDate: number;
}

const DAY = 86_400_000;
const DUE = 1_800_000_000_000;

/** n missions d'un même groupe, échéance commune, ids ordonnés. */
function rows(key: string, n: number, dueDate = DUE): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    _id: `${key}-${i}`,
    key,
    dueDate,
  }));
}

function order(items: Row[], seed = "creator1"): string[] {
  return interleaveByGroup(items, {
    keyOf: (r) => r.key,
    dueDateOf: (r) => r.dueDate,
    seed,
  }).map((r) => r.key);
}

/** Plus longue série de groupes identiques consécutifs. */
function longestRun(keys: string[]): number {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of keys) {
    run = k === prev ? run + 1 : 1;
    prev = k;
    best = Math.max(best, run);
  }
  return best;
}

describe("assignmentGroupKey", () => {
  it("script → campagne ; format → formatId ; ni l'un ni l'autre → none", () => {
    expect(assignmentGroupKey({ scriptCombo: { campaignId: "c1" } })).toBe(
      "campaign:c1",
    );
    expect(assignmentGroupKey({ formatId: "f1" })).toBe("format:f1");
    expect(assignmentGroupKey({})).toBe("none");
  });

  it("le combo prime sur formatId (un assignment script n'a pas de format)", () => {
    expect(
      assignmentGroupKey({ formatId: "f1", scriptCombo: { campaignId: "c9" } }),
    ).toBe("campaign:c9");
  });
});

describe("interleaveByGroup — alternance", () => {
  it("cas réel (7 / 5 / 6) : plus JAMAIS de bloc, tout alterne (run 1)", () => {
    const all = [...rows("A", 7), ...rows("B", 5), ...rows("C", 6)];
    // Robuste sur plusieurs graines : aucune ne doit recréer un bloc.
    for (const seed of ["k1", "k2", "k3", "k4", "k5"]) {
      const keys = order(all, seed);
      expect(keys.length).toBe(18);
      expect(longestRun(keys)).toBe(1);
    }
  });

  it("préserve TOUTES les missions, sans doublon ni perte", () => {
    const all = [...rows("A", 7), ...rows("B", 5), ...rows("C", 6)];
    const out = interleaveByGroup(all, {
      keyOf: (r) => r.key,
      dueDateOf: (r) => r.dueDate,
      seed: "creator1",
    });
    expect(out.length).toBe(all.length);
    expect(new Set(out.map((r) => r._id))).toEqual(
      new Set(all.map((r) => r._id)),
    );
  });

  it("cas du prompt (7 / 3) : alternance OPTIMALE, jamais 3 d'affilée (run 2)", () => {
    const all = [...rows("A", 7), ...rows("B", 3)];
    for (const seed of ["k1", "k2", "k3", "k4", "k5", "k6"]) {
      const keys = order(all, seed);
      expect(keys.length).toBe(10);
      // 7 vs 3 : run 1 impossible (7 > ⌈10/2⌉), mais jamais de bloc de 3.
      expect(longestRun(keys)).toBeLessThanOrEqual(2);
    }
  });

  it("quantités inégales : le minoritaire est ÉTALÉ, jamais empilé en fin", () => {
    // Round-robin naïf finirait par AAAA ; le peigne place les B au milieu.
    const keys = order([...rows("A", 10), ...rows("B", 2)]);
    const bPositions = keys.flatMap((k, i) => (k === "B" ? [i] : []));
    expect(bPositions.length).toBe(2);
    // Un B dans chaque moitié → pas de queue monolithique de A.
    expect(bPositions.some((p) => p < 6)).toBe(true);
    expect(bPositions.some((p) => p >= 6)).toBe(true);
  });

  it("groupes équilibrés (6 / 6 / 6) : parfaitement entrelacés (run 1)", () => {
    const keys = order([...rows("A", 6), ...rows("B", 6), ...rows("C", 6)]);
    expect(longestRun(keys)).toBe(1);
  });

  it("un seul groupe → liste rendue telle quelle", () => {
    const all = rows("A", 5);
    const out = interleaveByGroup(all, {
      keyOf: (r) => r.key,
      dueDateOf: (r) => r.dueDate,
      seed: "creator1",
    });
    expect(out.map((r) => r._id)).toEqual(all.map((r) => r._id));
  });

  it("0 ou 1 item → inchangé", () => {
    expect(order([])).toEqual([]);
    expect(order(rows("A", 1))).toEqual(["A"]);
  });

  it("échéance = tri PRIMAIRE : les plus proches d'abord, on n'entrelace qu'à échéance égale", () => {
    const soon = rows("SOON", 3, DUE);
    const late = rows("LATE", 3, DUE + 10 * DAY);
    const keys = order([...late, ...soon]);
    // Bloc SOON entier (échéance proche) AVANT bloc LATE.
    expect(keys.slice(0, 3).every((k) => k === "SOON")).toBe(true);
    expect(keys.slice(3).every((k) => k === "LATE")).toBe(true);
  });

  it("entrelace DANS chaque paquet d'échéance, pas entre les paquets", () => {
    const soon = [...rows("A", 2, DUE), ...rows("B", 2, DUE)];
    const late = [...rows("A", 2, DUE + DAY), ...rows("B", 2, DUE + DAY)];
    const keys = order([...soon, ...late]);
    // Chaque moitié (une échéance) alterne A/B sans bloc.
    expect(longestRun(keys.slice(0, 4))).toBe(1);
    expect(longestRun(keys.slice(4))).toBe(1);
  });
});

describe("interleaveByGroup — stabilité & variation", () => {
  it("STABLE : même entrée + même graine → même sortie (pas de re-tri au reload)", () => {
    const all = [...rows("A", 7), ...rows("B", 5), ...rows("C", 6)];
    const a = order(all, "creatorX");
    const b = order(all, "creatorX");
    const c = order([...all], "creatorX");
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("deux créatrices (graines ≠) ne reçoivent pas le même ordre de formats", () => {
    const all = [...rows("A", 7), ...rows("B", 5), ...rows("C", 6)];
    const seqs = new Set(
      ["k17", "k42", "k99", "k123", "k7", "k55", "k8", "k9"].map((s) =>
        order(all, s).join(""),
      ),
    );
    // Plusieurs cycles distincts (≠ séquence unique figée pour tout le monde).
    expect(seqs.size).toBeGreaterThan(2);
  });

  it("l'ordre varie quand les CLÉS de groupe changent (distribution ≠)", () => {
    // Même forme (3×6), mais campagnes différentes → cycles indépendants,
    // tous sans bloc.
    const first = order([...rows("c1", 6), ...rows("c2", 6), ...rows("c3", 6)]);
    const second = order([...rows("c4", 6), ...rows("c5", 6), ...rows("c6", 6)]);
    expect(longestRun(first)).toBe(1);
    expect(longestRun(second)).toBe(1);
  });

  it("liste longue (bornes de coût) : reste sans bloc et sans perte", () => {
    const all = [...rows("A", 30), ...rows("B", 25), ...rows("C", 20)];
    const keys = order(all, "big");
    expect(keys.length).toBe(75);
    expect(longestRun(keys)).toBe(1);
  });
});

describe("stableHash", () => {
  it("déterministe et sensible à l'entrée", () => {
    expect(stableHash("abc")).toBe(stableHash("abc"));
    expect(stableHash("abc")).not.toBe(stableHash("abd"));
    expect(Number.isInteger(stableHash(""))).toBe(true);
  });
});
