/**
 * P6 — rendu de la grille de rémunération d'un format (pur, testé Vitest).
 */

export type RateModel = {
  basePerPost: number;
  viewBonusPer1k?: number;
  bounties?: Array<{ thresholdViews: number; amount: number }>;
};

/** Devise par défaut du projet quand la donnée ne porte pas de code (paie créatrices, euros). */
export const DEFAULT_CURRENCY = "EUR";

/**
 * Montant formaté dans SA devise. Le code devise vient TOUJOURS de la donnée
 * (paiements Whop, grille de paie), JAMAIS écrit en dur dans un composant : un
 * symbole codé en dur affichait des euros en dollars (bug de l'audit initial).
 * `narrowSymbol` donne un symbole propre (« 4,99 € », « 4,99 $ ») sans coller le
 * code pays. La devise est acceptée en minuscules (« eur ») comme en majuscules.
 */
export function formatMoney(n: number, currency: string = DEFAULT_CURRENCY): string {
  const code = currency && currency.trim() !== "" ? currency.trim().toUpperCase() : DEFAULT_CURRENCY;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
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
  const lines = [`${formatMoney(rate.basePerPost)} par post`];
  if (rate.viewBonusPer1k && rate.viewBonusPer1k > 0) {
    lines.push(`+ ${formatMoney(rate.viewBonusPer1k)} / 1 000 vues`);
  }
  const bounties = [...(rate.bounties ?? [])].sort(
    (a, b) => a.thresholdViews - b.thresholdViews,
  );
  for (const b of bounties) {
    lines.push(
      `Prime ${formatMoney(b.amount)} à ${formatViews(b.thresholdViews)} vues`,
    );
  }
  return lines;
}
