/**
 * Sélection du snapshot de métriques correspondant à une période d'âge
 * demandée (J+1, J+7, …, Latest, Custom). Pur, testé en vitest.
 *
 * ⚠️ Cross-tsconfig : les modules `convex/` ne peuvent PAS importer `lib/`.
 * Ce fichier est donc DUPLIQUÉ côté serveur dans `convex/snapshotMatching.ts`.
 * Toute évolution de TARGET_DAYS / TOLERANCE_DAYS / de l'algo doit être
 * répercutée dans les deux fichiers (pattern existant : isFormatAllowedOnPlatform).
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

export type FixedAge = Exclude<SnapshotAge, "latest" | "custom">;

/** Âge cible (en jours depuis publication) par preset. */
export const TARGET_DAYS: Record<FixedAge, number> = {
  j1: 1,
  j3: 3,
  j7: 7,
  j14: 14,
  j30: 30,
  j60: 60,
  j90: 90,
};

/** Tolérance proportionnelle (décision verrouillée #9). Plus la période est
 *  lointaine, plus l'écart toléré au snapshot le plus proche est large. */
export const TOLERANCE_DAYS: Record<FixedAge, number> = {
  j1: 0,
  j3: 1,
  j7: 2,
  j14: 3,
  j30: 5,
  j60: 7,
  j90: 10,
};

/** Liste ordonnée des presets pour l'UI (hors latest/custom). */
export const FIXED_AGES: readonly FixedAge[] = [
  "j1",
  "j3",
  "j7",
  "j14",
  "j30",
  "j60",
  "j90",
];

export type MatchableSnapshot = {
  daysSincePublication: number;
  capturedAt: number;
};

/** Coerce une string (arg query / localStorage) en SnapshotAge valide.
 *  Fallback "latest" pour toute valeur inconnue. */
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

/**
 * Retourne le snapshot correspondant le mieux à la période demandée, ou null.
 *  - "latest" : capturedAt max (robuste à l'ordre d'entrée).
 *  - "custom" : cible = customDay, tolérance = max(2, customDay*0.1).
 *  - presets  : |daysSincePublication − TARGET| ≤ TOLERANCE, le plus proche
 *               du target (tie-break = capturedAt le plus récent).
 */
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
