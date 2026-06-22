import { describe, it, expect } from "vitest";
import {
  findMatchingSnapshot,
  coerceSnapshotAge,
  TARGET_DAYS,
  TOLERANCE_DAYS,
  DAY_MS,
  ageWindowDays,
  buildLatestMetricsFromDenorm,
  type LatestMetricsSource,
} from "./snapshot-matching";

type S = { daysSincePublication: number; capturedAt: number; id: string };

function snap(days: number, capturedAt: number, id = `s${days}`): S {
  return { daysSincePublication: days, capturedAt, id };
}

describe("findMatchingSnapshot", () => {
  it("returns null when there are no snapshots", () => {
    expect(findMatchingSnapshot([], "j7")).toBeNull();
    expect(findMatchingSnapshot([], "latest")).toBeNull();
  });

  it("matches an exact target (j7 → 7 jours)", () => {
    const snaps = [snap(1, 100), snap(7, 700), snap(30, 3000)];
    expect(findMatchingSnapshot(snaps, "j7")?.id).toBe("s7");
  });

  it("matches within tolerance (j7 tol=2 → un snapshot à 8 jours)", () => {
    const snaps = [snap(8, 800)];
    expect(findMatchingSnapshot(snaps, "j7")?.id).toBe("s8");
  });

  it("returns null when the closest snapshot is outside tolerance (j7 tol=2, snapshot à 10)", () => {
    const snaps = [snap(10, 1000)];
    expect(findMatchingSnapshot(snaps, "j7")).toBeNull();
  });

  it("enforces tolerance 0 for j1", () => {
    expect(findMatchingSnapshot([snap(2, 200)], "j1")).toBeNull();
    expect(findMatchingSnapshot([snap(1, 100)], "j1")?.id).toBe("s1");
  });

  it("picks the closest to target among several within tolerance", () => {
    // target 30, tol 5 : 27 (d=3) vs 33 (d=3) vs 31 (d=1) → 31 gagne
    const snaps = [snap(27, 270), snap(33, 330), snap(31, 310)];
    expect(findMatchingSnapshot(snaps, "j30")?.id).toBe("s31");
  });

  it("tie-breaks equal distance by most recent capturedAt", () => {
    // target 30, tol 5 : 28 (d=2, capturedAt 280) vs 32 (d=2, capturedAt 999)
    const snaps = [
      { daysSincePublication: 28, capturedAt: 280, id: "old" },
      { daysSincePublication: 32, capturedAt: 999, id: "recent" },
    ];
    expect(findMatchingSnapshot(snaps, "j30")?.id).toBe("recent");
  });

  it("'latest' returns the snapshot with max capturedAt regardless of input order", () => {
    const snaps = [snap(1, 100), snap(30, 5000), snap(7, 700)];
    expect(findMatchingSnapshot(snaps, "latest")?.id).toBe("s30");
  });

  it("'custom' uses customDay as target with tolerance max(2, day*0.1)", () => {
    // custom 5 → tol max(2, 0.5) = 2 ; snapshot à 6 (d=1) matche
    expect(findMatchingSnapshot([snap(6, 600)], "custom", 5)?.id).toBe("s6");
    // snapshot à 8 (d=3 > 2) ne matche pas
    expect(findMatchingSnapshot([snap(8, 800)], "custom", 5)).toBeNull();
    // custom 100 → tol max(2, 10) = 10 ; snapshot à 109 (d=9) matche
    expect(findMatchingSnapshot([snap(109, 1090)], "custom", 100)?.id).toBe(
      "s109",
    );
  });
});

describe("coerceSnapshotAge", () => {
  it("passes through valid ages", () => {
    expect(coerceSnapshotAge("j7")).toBe("j7");
    expect(coerceSnapshotAge("custom")).toBe("custom");
    expect(coerceSnapshotAge("latest")).toBe("latest");
  });
  it("falls back to 'latest' for unknown/empty values", () => {
    expect(coerceSnapshotAge("nope")).toBe("latest");
    expect(coerceSnapshotAge(null)).toBe("latest");
    expect(coerceSnapshotAge(undefined)).toBe("latest");
  });
});

describe("constants", () => {
  it("TARGET_DAYS and TOLERANCE_DAYS cover the 7 fixed presets", () => {
    expect(Object.keys(TARGET_DAYS).sort()).toEqual(
      ["j1", "j14", "j3", "j30", "j60", "j7", "j90"].sort(),
    );
    expect(TOLERANCE_DAYS.j1).toBe(0);
    expect(TOLERANCE_DAYS.j90).toBe(10);
  });
});

// ─── Vue "latest" servie depuis le dénormalisé (perf : 0 lecture snapshot) ───
// On prouve l'égalité EXACTE entre :
//  - buildLatestMetricsFromDenorm(champs dénormalisés)         [nouveau chemin]
//  - buildDisplayMetrics(snapshots, "latest") émulé ci-dessous [ancien chemin]
type FullSnap = {
  _id: string;
  capturedAt: number;
  daysSincePublication: number;
  vues: number;
  likes: number;
  saves?: number;
  subsGained?: number;
  comments?: number;
};

/** Réplique buildDisplayMetrics(snaps, "latest") (cf convex/metricsDisplay.ts). */
function latestDisplayFromSnaps(snaps: FullSnap[]) {
  const match = findMatchingSnapshot(snaps, "latest");
  if (!match) {
    return {
      vues: null,
      likes: null,
      saves: null,
      subsGained: null,
      comments: null,
      snapshotUsed: null,
      matchExact: false,
    };
  }
  return {
    vues: match.vues,
    likes: match.likes,
    saves: match.saves ?? null,
    subsGained: match.subsGained ?? null,
    comments: match.comments ?? null,
    snapshotUsed: {
      id: match._id,
      capturedAt: match.capturedAt,
      daysSincePublication: match.daysSincePublication,
    },
    matchExact: true,
  };
}

/** Réplique recomputeLatestMetrics : latest = capturedAt max, copie verbatim. */
function denormFromSnaps(
  datePubli: number,
  snaps: FullSnap[],
): LatestMetricsSource<string> {
  if (snaps.length === 0) return { datePubli };
  const latest = snaps.reduce((a, b) => (b.capturedAt > a.capturedAt ? b : a));
  return {
    datePubli,
    vuesLatest: latest.vues,
    likesLatest: latest.likes,
    savesLatest: latest.saves,
    subsGainedLatest: latest.subsGained,
    commentsLatest: latest.comments,
    latestSnapshotId: latest._id,
    latestSnapshotAt: latest.capturedAt,
    latestSnapshotDaysSince: latest.daysSincePublication,
  };
}

describe("buildLatestMetricsFromDenorm (dénormalisé == latest calculé)", () => {
  const datePubli = 1_700_000_000_000;
  const fs = (
    _id: string,
    days: number,
    vues: number,
    likes: number,
    saves?: number,
    subsGained?: number,
    comments?: number,
  ): FullSnap => ({
    _id,
    capturedAt: datePubli + days * DAY_MS,
    daysSincePublication: days,
    vues,
    likes,
    saves,
    subsGained,
    comments,
  });

  it("égale le calcul-depuis-snapshots pour 'latest' (cas plein, plusieurs snapshots)", () => {
    const snaps = [
      fs("a", 1, 100, 10, 5, 2, 3),
      fs("c", 30, 9000, 900, 40, 80, 70), // latest (capturedAt max)
      fs("b", 7, 700, 70, 20, 15, 12),
    ];
    expect(buildLatestMetricsFromDenorm(denormFromSnaps(datePubli, snaps))).toEqual(
      latestDisplayFromSnaps(snaps),
    );
  });

  it("préserve les métriques optionnelles absentes (saves/subs/comments → null)", () => {
    const snaps = [fs("only", 12, 1234, 56)]; // saves/subs/comments undefined
    const out = buildLatestMetricsFromDenorm(denormFromSnaps(datePubli, snaps));
    expect(out).toEqual(latestDisplayFromSnaps(snaps));
    expect(out.saves).toBeNull();
    expect(out.subsGained).toBeNull();
    expect(out.comments).toBeNull();
    expect(out.matchExact).toBe(true);
  });

  it("aucun snapshot → EMPTY (tout null, snapshotUsed null, matchExact false)", () => {
    expect(buildLatestMetricsFromDenorm(denormFromSnaps(datePubli, []))).toEqual(
      latestDisplayFromSnaps([]),
    );
  });

  it("vues=0 dénormalisé reste 0 (et pas null)", () => {
    const snaps = [fs("z", 3, 0, 0)];
    expect(buildLatestMetricsFromDenorm(denormFromSnaps(datePubli, snaps)).vues).toBe(0);
  });

  it("fallback : sans latestSnapshotDaysSince, recalcule depuis datePubli (== stocké si datePubli inchangé)", () => {
    const snaps = [fs("d", 9, 555, 55)];
    const denorm = denormFromSnaps(datePubli, snaps);
    const { latestSnapshotDaysSince, ...withoutStored } = denorm;
    void latestSnapshotDaysSince;
    const out = buildLatestMetricsFromDenorm(withoutStored);
    expect(out.snapshotUsed?.daysSincePublication).toBe(9);
    expect(out).toEqual(latestDisplayFromSnaps(snaps));
  });
});

describe("ageWindowDays (bornage des vues âgées)", () => {
  it("renvoie [target-tolérance, target+tolérance] pour les presets", () => {
    expect(ageWindowDays("j7")).toEqual({ lo: 5, hi: 9 });
    expect(ageWindowDays("j30")).toEqual({ lo: 25, hi: 35 });
    expect(ageWindowDays("j1")).toEqual({ lo: 1, hi: 1 }); // tol 0
  });

  it("custom : tolérance max(2, day*0.1)", () => {
    expect(ageWindowDays("custom", 100)).toEqual({ lo: 90, hi: 110 });
    expect(ageWindowDays("custom", 5)).toEqual({ lo: 3, hi: 7 }); // tol 2
  });

  it("invariant : tout snapshot hors fenêtre est rejeté par findMatchingSnapshot", () => {
    const { lo, hi } = ageWindowDays("j30"); // [25, 35]
    // dans la fenêtre → accepté ; hors fenêtre → rejeté (donc inutile à charger)
    expect(findMatchingSnapshot([snap(hi, 1)], "j30")).not.toBeNull();
    expect(findMatchingSnapshot([snap(lo, 1)], "j30")).not.toBeNull();
    expect(findMatchingSnapshot([snap(hi + 1, 1)], "j30")).toBeNull();
    expect(findMatchingSnapshot([snap(lo - 1, 1)], "j30")).toBeNull();
  });
});
