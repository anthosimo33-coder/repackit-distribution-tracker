import { describe, it, expect } from "vitest";
import {
  decideBrick,
  decideKind,
  detectStrongSignals,
  DECISION_THRESHOLD,
  PUSH_DELTA,
  CUT_DELTA,
  STRONG_SIGNAL_MULTIPLE,
  MIN_SIGNAL_POSTS,
  type BrickInput,
  type SignalInput,
} from "./scriptDecision";

/** Fabrique une brique avec des valeurs lisibles. */
function brick(
  key: string,
  postCount: number,
  viewsMedian: number | null,
  kind = "flux",
): BrickInput {
  return { key, label: key, kind, postCount, viewsMedian };
}

describe("seuils — valeurs documentées", () => {
  it("constantes aux valeurs attendues", () => {
    expect(DECISION_THRESHOLD).toBe(50);
    expect(PUSH_DELTA).toBe(0.25);
    expect(CUT_DELTA).toBe(-0.25);
    expect(STRONG_SIGNAL_MULTIPLE).toBe(2);
    expect(MIN_SIGNAL_POSTS).toBe(3);
  });
});

describe("decideBrick — Porte 1 : sous le seuil → en_test, aucun verdict", () => {
  it("0 post → en_test", () => {
    const d = decideBrick(brick("F1", 0, null), []);
    expect(d.verdict).toBe("en_test");
    expect(d.deltaVsPeerMedian).toBeNull();
    expect(d.peerMedian).toBeNull();
    expect(d.reason).toContain("0/50");
  });

  it("49 posts (juste sous le seuil) → en_test même si surperforme", () => {
    const peers = [brick("F2", 100, 1000)];
    const d = decideBrick(brick("F1", 49, 9_999_999), peers);
    expect(d.verdict).toBe("en_test"); // le volume prime : on ne tranche pas
    expect(d.reason).toContain("49/50");
  });

  it("bascule exacte à 50 posts : 49 → en_test, 50 → jugé", () => {
    const peers = [brick("F2", 60, 1000)];
    expect(decideBrick(brick("F1", 49, 1000), peers).verdict).toBe("en_test");
    expect(decideBrick(brick("F1", 50, 1000), peers).verdict).not.toBe(
      "en_test",
    );
  });

  it("≥ seuil mais médiane null → en_test (pas de mesure exploitable)", () => {
    const peers = [brick("F2", 60, 1000)];
    expect(decideBrick(brick("F1", 80, null), peers).verdict).toBe("en_test");
  });
});

describe("decideBrick — Porte 1bis : pas de pairs jugeables → en_test", () => {
  it("aucun pair → en_test", () => {
    const d = decideBrick(brick("F1", 80, 5000), []);
    expect(d.verdict).toBe("en_test");
    expect(d.reason).toContain("pas assez de pairs jugeables");
  });

  it("des pairs mais tous sous le seuil → en_test (on ne compare pas dans le vide)", () => {
    const peers = [brick("F2", 10, 999999), brick("F3", 5, 1)];
    const d = decideBrick(brick("F1", 80, 5000), peers);
    expect(d.verdict).toBe("en_test");
    expect(d.peerMedian).toBeNull();
  });

  it("la self présente dans la liste des pairs ne se compte pas elle-même", () => {
    const self = brick("F1", 80, 5000);
    // self est le seul jugeable → après filtrage il ne reste aucun pair.
    const d = decideBrick(self, [self, brick("F2", 10, 100)]);
    expect(d.verdict).toBe("en_test");
  });
});

describe("decideBrick — Porte 2 : a_pousser / a_couper / neutre", () => {
  const peers = [brick("F2", 60, 1000), brick("F3", 60, 1000)]; // médiane pairs = 1000

  it("nettement au-dessus (≥ +25 %) → a_pousser", () => {
    const d = decideBrick(brick("F1", 64, 2300), peers); // 2300 = 2.3× → +130 %
    expect(d.verdict).toBe("a_pousser");
    expect(d.peerMedian).toBe(1000);
    expect(d.deltaVsPeerMedian).toBeCloseTo(1.3, 5);
    expect(d.reason).toContain("64 posts");
  });

  it("exactement +25 % → a_pousser (borne incluse)", () => {
    const d = decideBrick(brick("F1", 50, 1250), peers); // +25 %
    expect(d.verdict).toBe("a_pousser");
  });

  it("nettement en-dessous (≤ −25 %) → a_couper", () => {
    const d = decideBrick(brick("F1", 58, 600), peers); // −40 %
    expect(d.verdict).toBe("a_couper");
    expect(d.deltaVsPeerMedian).toBeCloseTo(-0.4, 5);
  });

  it("exactement −25 % → a_couper (borne incluse)", () => {
    const d = decideBrick(brick("F1", 58, 750), peers); // −25 %
    expect(d.verdict).toBe("a_couper");
  });

  it("dans la moyenne (entre −25 % et +25 %) → neutre", () => {
    expect(decideBrick(brick("F1", 55, 1000), peers).verdict).toBe("neutre"); // 0 %
    expect(decideBrick(brick("F1", 55, 1100), peers).verdict).toBe("neutre"); // +10 %
    expect(decideBrick(brick("F1", 55, 900), peers).verdict).toBe("neutre"); // −10 %
  });

  it("un seul pair jugeable suffit (MIN_JUDGEABLE_PEERS = 1)", () => {
    const d = decideBrick(brick("F1", 60, 2000), [brick("F2", 60, 1000)]);
    expect(d.verdict).toBe("a_pousser");
    expect(d.peerMedian).toBe(1000);
  });

  it("ignore les pairs sous le seuil dans le calcul de la référence", () => {
    // F2 jugeable (médiane 1000), F3 sous le seuil avec médiane absurde ignorée.
    const mixed = [brick("F2", 60, 1000), brick("F3", 3, 1_000_000)];
    const d = decideBrick(brick("F1", 60, 2000), mixed);
    expect(d.peerMedian).toBe(1000); // F3 exclu
    expect(d.verdict).toBe("a_pousser");
  });

  it("médiane des pairs = médiane des médianes (robuste à un pair extrême)", () => {
    // pairs jugeables : 800, 1000, 50000 → médiane = 1000 (pas la moyenne ~17k).
    const peers3 = [
      brick("F2", 60, 800),
      brick("F3", 60, 1000),
      brick("F4", 60, 50000),
    ];
    const d = decideBrick(brick("F1", 60, 1000), peers3);
    expect(d.peerMedian).toBe(1000);
    expect(d.verdict).toBe("neutre");
  });

  it("pairs à médiane 0 et brique > 0 → a_pousser (pas de division par zéro)", () => {
    const d = decideBrick(brick("F1", 60, 500), [brick("F2", 60, 0)]);
    expect(d.verdict).toBe("a_pousser");
    expect(d.deltaVsPeerMedian).toBeNull(); // delta infini → non renseigné
    expect(d.reason).toContain("∞");
  });

  it("pairs à médiane 0 et brique 0 → neutre", () => {
    const d = decideBrick(brick("F1", 60, 0), [brick("F2", 60, 0)]);
    expect(d.verdict).toBe("neutre");
  });
});

describe("decideKind — juge chaque brique contre les autres", () => {
  it("le gagnant net est a_pousser, le perdant net est a_couper, le médian neutre", () => {
    const bricks = [
      brick("F1", 60, 3000), // très au-dessus
      brick("F2", 60, 1000), // référence
      brick("F3", 60, 1000), // référence
      brick("F4", 60, 300), // très en-dessous
    ];
    const decisions = decideKind(bricks);
    const byKey = Object.fromEntries(decisions.map((d) => [d.key, d.verdict]));
    expect(byKey.F1).toBe("a_pousser");
    expect(byKey.F4).toBe("a_couper");
    // F2/F3 comparés au reste : médiane des pairs reste ~1000 → neutre.
    expect(byKey.F2).toBe("neutre");
    expect(byKey.F3).toBe("neutre");
    expect(decisions).toHaveLength(4);
  });

  it("toutes sous le seuil → toutes en_test (état réaliste avant volume)", () => {
    const bricks = [brick("F1", 12, 5000), brick("F2", 8, 100)];
    expect(decideKind(bricks).every((d) => d.verdict === "en_test")).toBe(true);
  });
});

describe("detectStrongSignals — Porte 3 : flag manuel, jamais d'auto-action", () => {
  const globalMedian = 1000;

  it("jeu vide → []", () => {
    expect(detectStrongSignals([], globalMedian)).toEqual([]);
  });

  it("médiane globale null ou 0 → [] (rien à comparer)", () => {
    const items = [signal("c1", 5, 9999)];
    expect(detectStrongSignals(items, null)).toEqual([]);
    expect(detectStrongSignals(items, 0)).toEqual([]);
  });

  it("combo à ≥ 2× la médiane globale et < 50 posts → signal détecté", () => {
    const items = [signal("c1", 5, 2600)]; // 2.6× sur 5 posts
    const out = detectStrongSignals(items, globalMedian);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("c1");
    expect(out[0].multipleOfGlobal).toBeCloseTo(2.6, 5);
    expect(out[0].reason).toContain("à confirmer manuellement");
  });

  it("le signal fort N'EST PAS auto-actionné : sortie = simple liste descriptive", () => {
    const out = detectStrongSignals([signal("c1", 5, 3000)], globalMedian);
    // Pas de champ d'action/verdict — juste de la description pour l'admin.
    expect(Object.keys(out[0]).sort()).toEqual(
      [
        "key",
        "kind",
        "label",
        "multipleOfGlobal",
        "postCount",
        "reason",
        "viewsMedian",
      ].sort(),
    );
  });

  it("sous le multiple haut (< 2×) → pas de signal", () => {
    expect(detectStrongSignals([signal("c1", 5, 1900)], globalMedian)).toEqual(
      [],
    );
  });

  it("1 seul post à 5× → ignoré (un carton isolé est un accident)", () => {
    expect(detectStrongSignals([signal("c1", 1, 5000)], globalMedian)).toEqual(
      [],
    );
    // 2 posts encore sous MIN_SIGNAL_POSTS (3).
    expect(detectStrongSignals([signal("c1", 2, 5000)], globalMedian)).toEqual(
      [],
    );
    // 3 posts → ça passe.
    expect(
      detectStrongSignals([signal("c1", 3, 5000)], globalMedian),
    ).toHaveLength(1);
  });

  it("≥ seuil de jugement → PAS un signal (passe par un verdict, pas par la revue manuelle)", () => {
    // 60 posts à 3× : c'est un « à pousser » jugé, pas un signal à confirmer.
    expect(detectStrongSignals([signal("c1", 60, 3000)], globalMedian)).toEqual(
      [],
    );
  });

  it("médiane null → ignorée", () => {
    expect(detectStrongSignals([signal("c1", 5, null)], globalMedian)).toEqual(
      [],
    );
  });

  it("trie par multiple décroissant (le plus spectaculaire en tête)", () => {
    const items = [
      signal("c1", 5, 2200), // 2.2×
      signal("c2", 5, 4000), // 4.0×
      signal("c3", 5, 3000), // 3.0×
    ];
    const out = detectStrongSignals(items, globalMedian);
    expect(out.map((s) => s.key)).toEqual(["c2", "c3", "c1"]);
  });

  it("seuils paramétrables via opts", () => {
    // multiple abaissé à 1.5× → un combo à 1.6× passe.
    const out = detectStrongSignals([signal("c1", 5, 1600)], globalMedian, {
      strongSignalMultiple: 1.5,
    });
    expect(out).toHaveLength(1);
  });
});

function signal(
  key: string,
  postCount: number,
  viewsMedian: number | null,
): SignalInput {
  return { key, label: key, kind: "combo", postCount, viewsMedian };
}
