import { describe, it, expect } from "vitest";
import {
  findMatchingSnapshot,
  coerceSnapshotAge,
  TARGET_DAYS,
  TOLERANCE_DAYS,
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
