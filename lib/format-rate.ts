/**
 * P6 — rendu de la grille de rémunération d'un format (pur, testé Vitest).
 */

export type RateModel = {
  basePerPost: number;
  viewBonusPer1k?: number;
  bounties?: Array<{ thresholdViews: number; amount: number }>;
};

export function formatEuros(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

/** Vues compactes : 1500 → « 1,5 k », 2_000_000 → « 2 M ». */
export function formatViews(n: number): string {
  if (n >= 1_000_000) return `${trimZero(n / 1_000_000)} M`;
  if (n >= 1_000) return `${trimZero(n / 1_000)} k`;
  return String(n);
}

function trimZero(n: number): string {
  return n
    .toFixed(1)
    .replace(/\.0$/, "")
    .replace(".", ",");
}

/**
 * Lignes lisibles de la grille (base, bonus aux vues, primes triées par seuil).
 * Sert l'aperçu créateur ET la liste admin.
 */
export function rateSummary(rate: RateModel): string[] {
  const lines = [`${formatEuros(rate.basePerPost)} par post`];
  if (rate.viewBonusPer1k && rate.viewBonusPer1k > 0) {
    lines.push(`+ ${formatEuros(rate.viewBonusPer1k)} / 1 000 vues`);
  }
  const bounties = [...(rate.bounties ?? [])].sort(
    (a, b) => a.thresholdViews - b.thresholdViews,
  );
  for (const b of bounties) {
    lines.push(
      `Prime ${formatEuros(b.amount)} à ${formatViews(b.thresholdViews)} vues`,
    );
  }
  return lines;
}
