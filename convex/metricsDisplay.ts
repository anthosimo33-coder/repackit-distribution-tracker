import type { Doc, Id } from "./_generated/dataModel";
import {
  findMatchingSnapshot,
  TARGET_DAYS,
  type SnapshotAge,
} from "./snapshotMatching";

/**
 * Métriques "affichables" résolues pour une période d'âge donnée. Calculées
 * côté serveur dans les queries (listPublications, getByCarouselId,
 * dashboardKpis) à partir des metricSnapshots, et consommées par l'UI à la
 * place des anciens champs scalaires (vuesJ7…).
 */
export type DisplayMetrics = {
  vues: number | null;
  likes: number | null;
  saves: number | null;
  subsGained: number | null;
  comments: number | null;
  snapshotUsed: {
    id: Id<"metricSnapshots">;
    capturedAt: number;
    daysSincePublication: number;
  } | null;
  // true si le snapshot retenu tombe EXACTEMENT sur la cible (ou "latest").
  // false si la tolérance a été utilisée (badge "≈" / tooltip côté UI).
  matchExact: boolean;
};

export const EMPTY_DISPLAY_METRICS: DisplayMetrics = {
  vues: null,
  likes: null,
  saves: null,
  subsGained: null,
  comments: null,
  snapshotUsed: null,
  matchExact: false,
};

/** Regroupe une liste plate de snapshots par publicationId, chaque groupe
 *  trié par capturedAt desc (plus récent d'abord) — prêt pour findMatchingSnapshot. */
export function groupSnapshotsByPublication(
  snaps: Doc<"metricSnapshots">[],
): Map<string, Doc<"metricSnapshots">[]> {
  const map = new Map<string, Doc<"metricSnapshots">[]>();
  for (const s of snaps) {
    const arr = map.get(s.publicationId);
    if (arr) arr.push(s);
    else map.set(s.publicationId, [s]);
  }
  for (const arr of map.values()) arr.sort((a, b) => b.capturedAt - a.capturedAt);
  return map;
}

export function buildDisplayMetrics(
  snapshots: Doc<"metricSnapshots">[],
  age: SnapshotAge,
  customDay?: number,
): DisplayMetrics {
  const match = findMatchingSnapshot(snapshots, age, customDay);
  if (!match) return EMPTY_DISPLAY_METRICS;

  let matchExact: boolean;
  if (age === "latest") {
    matchExact = true;
  } else {
    const target = age === "custom" ? customDay ?? 0 : TARGET_DAYS[age];
    matchExact = match.daysSincePublication === target;
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
    matchExact,
  };
}
