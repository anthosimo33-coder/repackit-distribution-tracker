export type Verdict = "WINNER" | "MOYEN" | "FOLD" | null;

export function calculateSaveRate(
  saves: number | null,
  vues: number | null,
): number | null {
  if (saves === null || vues === null || vues === 0) return null;
  return saves / vues;
}

export function calculateVerdict(saveRate: number | null): Verdict {
  if (saveRate === null) return null;
  if (saveRate >= 0.03) return "WINNER";
  if (saveRate >= 0.01) return "MOYEN";
  return "FOLD";
}

/**
 * Verdict à partir d'un jeu de métriques (typiquement les `displayMetrics`
 * résolus pour la période sélectionnée). Pivot du refactor multi-snapshots :
 * le verdict suit le snapshot affiché (décision C1 — cohérence KPI + verdict).
 *
 * Retourne `null` ("En attente") si aucune métrique ou saves/vues manquants —
 * équivalent du "PENDING" de la spec, conservé en `null` pour que VerdictBadge
 * et tous ses callers restent inchangés.
 */
export function computeVerdict(
  metrics: { saves: number | null; vues: number | null } | null | undefined,
): Verdict {
  if (!metrics) return null;
  return calculateVerdict(calculateSaveRate(metrics.saves, metrics.vues));
}

export function calculateAuditConversion(
  commentsAudit: number | null,
  vues: number | null,
): number | null {
  if (commentsAudit === null || vues === null || vues === 0) return null;
  return commentsAudit / vues;
}

// Legacy re-exports — please import from "@/lib/format" instead.
export { formatPercent, formatNumber } from "./format";
