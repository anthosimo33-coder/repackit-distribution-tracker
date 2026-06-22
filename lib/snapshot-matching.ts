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
 *  Générique sur le type d'id (lib/ ne connaît pas Id<"metricSnapshots">). */
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
