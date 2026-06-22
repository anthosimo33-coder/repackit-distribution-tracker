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

/** Millisecondes par jour — base du calcul daysSincePublication. */
export const DAY_MS = 86_400_000;

export type MatchableSnapshot = {
  daysSincePublication: number;
  capturedAt: number;
};

/** Cible (jours depuis publication) + tolérance pour une période non-"latest".
 *  Source UNIQUE partagée par findMatchingSnapshot et ageWindowDays (évite que
 *  la fenêtre de range-scan et le matching divergent). */
function ageTargetAndTolerance(
  age: Exclude<SnapshotAge, "latest">,
  customDay?: number,
): { target: number; tolerance: number } {
  if (age === "custom") {
    const target = customDay ?? 0;
    return { target, tolerance: Math.max(2, target * 0.1) };
  }
  return { target: TARGET_DAYS[age], tolerance: TOLERANCE_DAYS[age] };
}

/**
 * Fenêtre [lo, hi] en jours-depuis-publication couvrant TOUS les snapshots que
 * findMatchingSnapshot pourrait retenir pour `age` (hors "latest"). Permet un
 * range-scan borné sur capturedAt (datePubli + lo·jour … datePubli + (hi+1)·jour)
 * au lieu de charger tout l'historique : tout snapshot hors de cette fenêtre a
 * un daysSincePublication hors tolérance, donc serait de toute façon rejeté.
 */
export function ageWindowDays(
  age: Exclude<SnapshotAge, "latest">,
  customDay?: number,
): { lo: number; hi: number } {
  const { target, tolerance } = ageTargetAndTolerance(age, customDay);
  return { lo: target - tolerance, hi: target + tolerance };
}

/** Champs dénormalisés "latest" d'une publication (cf recomputeLatestMetrics).
 *  Générique sur le type d'id (aligné sur lib/snapshot-matching.ts). */
export type LatestMetricsSource<IdT> = {
  datePubli: number;
  vuesLatest?: number;
  likesLatest?: number;
  savesLatest?: number;
  subsGainedLatest?: number;
  commentsLatest?: number;
  latestSnapshotId?: IdT;
  latestSnapshotAt?: number;
  latestSnapshotDaysSince?: number;
};

export type ResolvedDisplayMetrics<IdT> = {
  vues: number | null;
  likes: number | null;
  saves: number | null;
  subsGained: number | null;
  comments: number | null;
  snapshotUsed: {
    id: IdT;
    capturedAt: number;
    daysSincePublication: number;
  } | null;
  matchExact: boolean;
};

/**
 * Construit les métriques d'affichage "latest" à partir des champs DÉNORMALISÉS
 * de la publication, SANS lire les snapshots. Équivaut exactement à
 * buildDisplayMetrics(snaps, "latest") :
 *  - même snapshot retenu (capturedAt max == latestSnapshot*) ;
 *  - mêmes métriques (copies verbatim du latest) ;
 *  - daysSincePublication = valeur STOCKÉE du snapshot (latestSnapshotDaysSince),
 *    avec fallback recalculé depuis datePubli pour les rows pas encore
 *    reprocessées (exact tant que datePubli n'a pas été édité après le snapshot).
 */
export function buildLatestMetricsFromDenorm<IdT>(
  src: LatestMetricsSource<IdT>,
): ResolvedDisplayMetrics<IdT> {
  if (src.latestSnapshotId === undefined || src.latestSnapshotAt === undefined) {
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
  const daysSincePublication =
    src.latestSnapshotDaysSince ??
    Math.floor((src.latestSnapshotAt - src.datePubli) / DAY_MS);
  return {
    vues: src.vuesLatest ?? null,
    likes: src.likesLatest ?? null,
    saves: src.savesLatest ?? null,
    subsGained: src.subsGainedLatest ?? null,
    comments: src.commentsLatest ?? null,
    snapshotUsed: {
      id: src.latestSnapshotId,
      capturedAt: src.latestSnapshotAt,
      daysSincePublication,
    },
    matchExact: true,
  };
}

export function findMatchingSnapshot<T extends MatchableSnapshot>(
  snapshots: readonly T[],
  age: SnapshotAge,
  customDay?: number,
): T | null {
  if (snapshots.length === 0) return null;

  if (age === "latest") {
    return snapshots.reduce((a, b) => (b.capturedAt > a.capturedAt ? b : a));
  }

  const { target, tolerance } = ageTargetAndTolerance(age, customDay);

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
