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
const NOW = 1_800_000_000_000;
/** Échéance par défaut : bien dans le futur → rang « dans les temps » (2). */
const DUE = NOW + 30 * DAY;

/** n missions d'un même format, échéance commune, ids ordonnés. */
function rows(key: string, n: number, dueDate = DUE): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    _id: `${key}-${i}`,
    key,
    dueDate,
  }));
}

/** Rang d'urgence de test (réplique overdue/soon/ok de lib/assignment-status,
 *  statut toujours actionnable ici). 0 = en retard, 1 = < 48 h, 2 = dans les temps. */
function dueTier(dueDate: number): number {
  if (dueDate < NOW) return 0;
  if (dueDate - NOW < 2 * DAY) return 1;
  return 2;
}

function arrange(items: Row[], seed = "creator1"): Row[] {
  return interleaveByGroup(items, {
    keyOf: (r) => r.key,
    tierOf: (r) => dueTier(r.dueDate),
    dueDateOf: (r) => r.dueDate,
    seed,
  });
}

function order(items: Row[], seed = "creator1"): string[] {
  return arrange(items, seed).map((r) => r.key);
}

/** Plus longue série de formats identiques consécutifs. */
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

describe("interleaveByGroup — alternance (même rang)", () => {
  it("cas réel (7 / 5 / 6) : plus JAMAIS de bloc, tout alterne (run 1)", () => {
    const all = [...rows("A", 7), ...rows("B", 5), ...rows("C", 6)];
    for (const seed of ["k1", "k2", "k3", "k4", "k5"]) {
      const keys = order(all, seed);
      expect(keys.length).toBe(18);
      expect(longestRun(keys)).toBe(1);
    }
  });

  it("préserve TOUTES les missions, sans doublon ni perte", () => {
    const all = [...rows("A", 7), ...rows("B", 5), ...rows("C", 6)];
    const out = arrange(all);
    expect(out.length).toBe(all.length);
    expect(new Set(out.map((r) => r._id))).toEqual(
      new Set(all.map((r) => r._id)),
    );
  });

  it("7 / 3 : alternance OPTIMALE, jamais 3 d'affilée (run 2)", () => {
    const all = [...rows("A", 7), ...rows("B", 3)];
    for (const seed of ["k1", "k2", "k3", "k4", "k5", "k6"]) {
      const keys = order(all, seed);
      expect(keys.length).toBe(10);
      expect(longestRun(keys)).toBeLessThanOrEqual(2);
    }
  });

  it("quantités inégales : le minoritaire est ÉTALÉ, jamais empilé en fin", () => {
    const keys = order([...rows("A", 10), ...rows("B", 2)]);
    const bPositions = keys.flatMap((k, i) => (k === "B" ? [i] : []));
    expect(bPositions.length).toBe(2);
    expect(bPositions.some((p) => p < 6)).toBe(true);
    expect(bPositions.some((p) => p >= 6)).toBe(true);
  });

  it("groupes équilibrés (6 / 6 / 6) : parfaitement entrelacés (run 1)", () => {
    const keys = order([...rows("A", 6), ...rows("B", 6), ...rows("C", 6)]);
    expect(longestRun(keys)).toBe(1);
  });

  it("un seul format → liste rendue par échéance croissante", () => {
    const all = [
      ...rows("A", 1, DUE + 2 * DAY),
      ...rows("A", 1, DUE),
      ...rows("A", 1, DUE + DAY),
    ];
    // Même rang, mono-format → tri doux par échéance (rien à entrelacer).
    expect(arrange(all).map((r) => r.dueDate)).toEqual([
      DUE,
      DUE + DAY,
      DUE + 2 * DAY,
    ]);
  });

  it("0 ou 1 item → inchangé", () => {
    expect(order([])).toEqual([]);
    expect(order(rows("A", 1))).toEqual(["A"]);
  });
});

describe("interleaveByGroup — le format PRIME sur l'échéance (le fix)", () => {
  it("cas Kelly : POV/Pensée (30/07) + 7 Carrousels (31/07) alternent, PAS de bloc", () => {
    // Échéances DIFFÉRENTES mais même urgence (toutes « dans les temps ») →
    // avant : 7 Carrousels collés à la fin. Maintenant : entrelacés.
    const all = [
      ...rows("POV", 3, NOW + 5 * DAY),
      ...rows("PENSEE", 3, NOW + 5 * DAY),
      ...rows("CARROUSEL", 7, NOW + 6 * DAY),
    ];
    for (const seed of ["kelly", "lea", "sarah", "k4"]) {
      const keys = order(all, seed);
      expect(keys.length).toBe(13);
      // 7 vs 3 vs 3 → jamais 3 d'un même format d'affilée.
      expect(longestRun(keys)).toBeLessThanOrEqual(2);
      // Les Carrousels (échéance la plus lointaine) ne forment PAS un bloc final.
      expect(new Set(keys.slice(-4)).size).toBeGreaterThan(1);
      // Ils sont réellement répartis, pas relégués : présents dans la 1ʳᵉ moitié.
      expect(keys.slice(0, 6)).toContain("CARROUSEL");
    }
  });

  it("deux échéances proches (30/07 vs 31/07) : entrelacées, pas deux blocs", () => {
    const all = [
      ...rows("A", 4, NOW + 5 * DAY),
      ...rows("B", 4, NOW + 6 * DAY),
    ];
    const keys = order(all);
    // Même rang → alternance parfaite malgré les deux dates.
    expect(longestRun(keys)).toBe(1);
  });

  it("trois formats, trois échéances distinctes, même rang : run 1", () => {
    const all = [
      ...rows("A", 6, NOW + 4 * DAY),
      ...rows("B", 6, NOW + 5 * DAY),
      ...rows("C", 6, NOW + 6 * DAY),
    ];
    expect(longestRun(order(all))).toBe(1);
  });
});

describe("interleaveByGroup — l'urgence reste lisible (pas de noyade)", () => {
  it("une mission EN RETARD (format rare) remonte en TÊTE, pas noyée au milieu", () => {
    // 1 mission en retard d'un format rare + 10 missions à venir d'un autre :
    // le peigne seul l'étalerait au milieu → le rang d'urgence la met devant.
    const all = [
      ...rows("URGENT", 1, NOW - DAY), // en retard (rang 0)
      ...rows("BULK", 10, NOW + 5 * DAY), // dans les temps (rang 2)
    ];
    expect(arrange(all)[0].key).toBe("URGENT");
  });

  it("< 48 h passe AVANT « dans les temps » même si format minoritaire", () => {
    const all = [
      ...rows("SOON", 1, NOW + DAY), // < 48 h (rang 1)
      ...rows("LATER", 8, NOW + 10 * DAY), // dans les temps (rang 2)
    ];
    expect(arrange(all)[0].key).toBe("SOON");
  });

  it("rangs ordonnés (retard → <48h → dans les temps), formats alternés DANS chaque rang", () => {
    const all = [
      ...rows("LATE_A", 2, NOW - DAY),
      ...rows("LATE_B", 2, NOW - DAY),
      ...rows("OK_A", 2, NOW + 5 * DAY),
      ...rows("OK_B", 2, NOW + 6 * DAY),
    ];
    const keys = order(all);
    // Les 4 « en retard » d'abord, puis les 4 « dans les temps ».
    const late = new Set(["LATE_A", "LATE_B"]);
    expect(keys.slice(0, 4).every((k) => late.has(k))).toBe(true);
    expect(keys.slice(4).every((k) => !late.has(k))).toBe(true);
    // Alternance DANS chaque rang (aucun bloc).
    expect(longestRun(keys.slice(0, 4))).toBe(1);
    expect(longestRun(keys.slice(4))).toBe(1);
  });

  it("échéances proches noyées AVANT le fix : ici la due-soon sort en tête", () => {
    // 7 Carrousels lointains + 1 POV imminent : le POV ne doit pas finir au milieu.
    const all = [
      ...rows("CARROUSEL", 7, NOW + 10 * DAY),
      ...rows("POV", 1, NOW + DAY),
    ];
    expect(arrange(all)[0].key).toBe("POV");
    // Et les Carrousels restants alternent… enfin, un seul format → bloc normal,
    // mais aucune mission urgente noyée dessous.
  });
});

describe("interleaveByGroup — stabilité & variation", () => {
  it("STABLE : même entrée + même graine → même sortie (pas de re-tri au reload)", () => {
    const all = [
      ...rows("A", 7, NOW + 4 * DAY),
      ...rows("B", 5, NOW + 5 * DAY),
      ...rows("C", 6, NOW + 6 * DAY),
    ];
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
    expect(seqs.size).toBeGreaterThan(2);
  });

  it("l'ordre varie quand les CLÉS de groupe changent (distribution ≠)", () => {
    const first = order([...rows("c1", 6), ...rows("c2", 6), ...rows("c3", 6)]);
    const second = order([...rows("c4", 6), ...rows("c5", 6), ...rows("c6", 6)]);
    expect(longestRun(first)).toBe(1);
    expect(longestRun(second)).toBe(1);
  });

  it("liste longue, échéances variées, même rang : sans bloc et sans perte", () => {
    const all = [
      ...rows("A", 30, NOW + 4 * DAY),
      ...rows("B", 25, NOW + 5 * DAY),
      ...rows("C", 20, NOW + 6 * DAY),
    ];
    const out = arrange(all, "big");
    expect(out.length).toBe(75);
    expect(longestRun(out.map((r) => r.key))).toBe(1);
  });
});

describe("stableHash", () => {
  it("déterministe et sensible à l'entrée", () => {
    expect(stableHash("abc")).toBe(stableHash("abc"));
    expect(stableHash("abc")).not.toBe(stableHash("abd"));
    expect(Number.isInteger(stableHash(""))).toBe(true);
  });
});
