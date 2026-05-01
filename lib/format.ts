export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("fr-FR");
}

export function formatPercent(
  n: number | null | undefined,
  decimals: number = 2,
): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(decimals).replace(".", ",")} %`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}
