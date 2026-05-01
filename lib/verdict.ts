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

export function calculateAuditConversion(
  commentsAudit: number | null,
  vues: number | null,
): number | null {
  if (commentsAudit === null || vues === null || vues === 0) return null;
  return commentsAudit / vues;
}

export function formatPercent(rate: number | null, digits = 2): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

export function formatNumber(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("fr-FR");
}
