import type { Doc } from "@/convex/_generated/dataModel";

/**
 * Refonte multi-snapshots.
 *
 * - Mode "aggregate" : la série temporelle (axe X = date calendaire) est
 *   calculée SERVEUR (convex/metricSnapshots.aggregateTimeseries) à partir des
 *   metricSnapshots, car elle nécessite TOUS les snapshots d'une plage de
 *   dates — pas seulement le snapshot affiché. Ce module n'expose donc plus
 *   l'ancien getTimeseries (qui bucketait par datePubli → graphe plat).
 * - Mode "single_publication" : pur, côté client, sur les snapshots d'UNE
 *   publication (axe X = daysSincePublication). Cf getSinglePublicationTimeseries.
 */

/** Clé métrique alignée sur les champs metricSnapshots (≠ ChartMetric de
 *  format-config qui utilise "views" — mappé dans MetricChart). */
export type ChartMetricKey = "vues" | "likes" | "saves" | "subsGained" | "comments";

/** Fenêtre glissante de l'axe X (ChartPeriodToggle). NB : sémantique distincte
 *  du SnapshotAgeSelector (âge du snapshot). */
export type Period = "J7" | "J30" | "J90" | "All";
export type Granularity = "day" | "week";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Début de la fenêtre (epoch ms) pour une Period donnée. "All" → 0. */
export function getPeriodStart(period: Period, now: number): number {
  switch (period) {
    case "J7":
      return now - 7 * DAY_MS;
    case "J30":
      return now - 30 * DAY_MS;
    case "J90":
      return now - 90 * DAY_MS;
    case "All":
      return 0;
  }
}

type SnapshotLike = Pick<
  Doc<"metricSnapshots">,
  "daysSincePublication" | "vues" | "likes" | "saves" | "subsGained" | "comments"
>;

function readSnapshotMetric(
  s: SnapshotLike,
  metric: ChartMetricKey,
): number | null {
  switch (metric) {
    case "vues":
      return s.vues;
    case "likes":
      return s.likes;
    case "saves":
      return s.saves ?? null;
    case "subsGained":
      return s.subsGained ?? null;
    case "comments":
      return s.comments ?? null;
  }
}

export type SinglePublicationPoint = {
  day: number;
  label: string;
  value: number;
};

/**
 * Évolution d'UNE publication : 1 point par snapshot, axe X = âge (J+X).
 * Pur — opère sur les snapshots déjà chargés (listSnapshotsByPublication).
 */
export function getSinglePublicationTimeseries(
  snapshots: readonly SnapshotLike[],
  metric: ChartMetricKey,
): SinglePublicationPoint[] {
  return snapshots
    .map((s) => ({
      day: s.daysSincePublication,
      value: readSnapshotMetric(s, metric),
    }))
    .filter((p): p is { day: number; value: number } => p.value !== null)
    .sort((a, b) => a.day - b.day)
    .map((p) => ({ day: p.day, label: `J+${p.day}`, value: p.value }));
}
