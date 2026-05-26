/**
 * DUPLICAT serveur de lib/snapshot-matching.ts (cross-tsconfig : convex/ ne
 * peut pas importer lib/). Garder aligné avec le fichier client.
 *
 * Module helper pur — n'enregistre aucune fonction Convex (pas de query/
 * mutation), simplement importé par publications.ts / hooks.ts / dashboard.ts.
 */

export type SnapshotAge =
  | "j1"
  | "j3"
  | "j7"
  | "j14"
  | "j30"
  | "j60"
  | "j90"
  | "latest"
  | "custom";

type FixedAge = Exclude<SnapshotAge, "latest" | "custom">;

export const TARGET_DAYS: Record<FixedAge, number> = {
  j1: 1,
  j3: 3,
  j7: 7,
  j14: 14,
  j30: 30,
  j60: 60,
  j90: 90,
};

export const TOLERANCE_DAYS: Record<FixedAge, number> = {
  j1: 0,
  j3: 1,
  j7: 2,
  j14: 3,
  j30: 5,
  j60: 7,
  j90: 10,
};

export function coerceSnapshotAge(value: string | null | undefined): SnapshotAge {
  switch (value) {
    case "j1":
    case "j3":
    case "j7":
    case "j14":
    case "j30":
    case "j60":
    case "j90":
    case "latest":
    case "custom":
      return value;
    default:
      return "latest";
  }
}

export type MatchableSnapshot = {
  daysSincePublication: number;
  capturedAt: number;
};

export function findMatchingSnapshot<T extends MatchableSnapshot>(
  snapshots: readonly T[],
  age: SnapshotAge,
  customDay?: number,
): T | null {
  if (snapshots.length === 0) return null;

  if (age === "latest") {
    return snapshots.reduce((a, b) => (b.capturedAt > a.capturedAt ? b : a));
  }

  let target: number;
  let tolerance: number;
  if (age === "custom") {
    target = customDay ?? 0;
    tolerance = Math.max(2, target * 0.1);
  } else {
    target = TARGET_DAYS[age];
    tolerance = TOLERANCE_DAYS[age];
  }

  let best: T | null = null;
  let bestDist = Infinity;
  for (const s of snapshots) {
    const dist = Math.abs(s.daysSincePublication - target);
    if (dist > tolerance) continue;
    if (
      dist < bestDist ||
      (dist === bestDist && best !== null && s.capturedAt > best.capturedAt)
    ) {
      best = s;
      bestDist = dist;
    }
  }
  return best;
}
