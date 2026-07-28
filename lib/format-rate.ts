/**
 * P6 — rendu de la grille de rémunération d'un format (pur, testé Vitest).
 */

export type RateModel = {
  basePerPost: number;
  viewBonusPer1k?: number;
  bounties?: Array<{ thresholdViews: number; amount: number }>;
};

/**
 * Montant formaté dans SA devise. Le code devise vient TOUJOURS de la donnée : la
 * paie créatrices est en DOLLARS (projects.payCurrency), le revenu Whop en EUROS
 * (whopPayments.currency). Il n'y a PAS de devise par défaut : appliquer une seule
 * devise partout affichait la paie ($) en euros (régression #157).
 *
 * `currency` absent ou vide → montant SANS symbole (jamais inventer une devise, on
 * préfère un nombre nu à un faux symbole). `narrowSymbol` donne « 4,99 $ » / « 4,99 €
 * » sans coller le code pays. Devise acceptée en minuscules (« usd », « eur »).
 */
export function formatMoney(n: number, currency?: string | null): string {
  const code =
    currency && currency.trim() !== "" ? currency.trim().toUpperCase() : null;
  if (code === null) {
    return new Intl.NumberFormat("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  }
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
 * Sert l'aperçu créateur ET la liste admin. La grille est de la PAIE créatrices :
 * `currency` = projects.payCurrency (dollars pour Snytch), absente → sans symbole.
 */
export function rateSummary(rate: RateModel, currency?: string | null): string[] {
  const lines = [`${formatMoney(rate.basePerPost, currency)} par post`];
  if (rate.viewBonusPer1k && rate.viewBonusPer1k > 0) {
    lines.push(`+ ${formatMoney(rate.viewBonusPer1k, currency)} / 1 000 vues`);
  }
  const bounties = [...(rate.bounties ?? [])].sort(
    (a, b) => a.thresholdViews - b.thresholdViews,
  );
  for (const b of bounties) {
    lines.push(
      `Prime ${formatMoney(b.amount, currency)} à ${formatViews(b.thresholdViews)} vues`,
    );
  }
  return lines;
}
