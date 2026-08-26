/**
 * P6 — rendu de la grille de rémunération d'un format (pur, testé Vitest).
 */

/**
 * Langue de mise en forme par défaut. Tant qu'un appelant ne passe pas la
 * langue active, le rendu est celui d'avant l'i18n — à l'octet près.
 */
export const FORMAT_LOCALE_DEFAULT = "fr-FR";

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
/**
 * En-tête d'une colonne de MONTANT (CSV, export). Le montant lui-même reste un
 * nombre nu — un tableur doit pouvoir le parser — donc la devise se dit dans
 * l'en-tête, et elle vient de la DONNÉE, exactement comme dans formatMoney.
 *
 * L'en-tête du CSV des cycles annonçait « Total dû (€) » au-dessus de montants
 * libellés en dollars (projects.payCurrency = "usd" sur les trois projets) : un
 * document envoyé à des créateurs, qui se trompait de devise.
 *
 * Devise absente ⇒ AUCUNE mention, jamais une devise inventée (même règle que
 * formatMoney, qui rend alors un nombre sans symbole). On affiche le CODE ISO
 * (« USD ») et non le symbole : dans un fichier lu par un tableur, « $ » est
 * ambigu (USD, CAD, AUD…).
 */
export function moneyColumnHeader(
  label: string,
  currency?: string | null,
): string {
  const code =
    currency && currency.trim() !== "" ? currency.trim().toUpperCase() : null;
  return code === null ? label : `${label} (${code})`;
}

export function formatMoney(
  n: number,
  currency?: string | null,
  /**
   * Langue de MISE EN FORME (séparateurs, position du symbole). Elle ne change
   * JAMAIS la devise : celle-ci vient de la transaction, jamais de la langue —
   * un payout en dollars reste en dollars dans une interface en français.
   *
   * Défaut « fr-FR » : le rendu actuel est strictement préservé tant qu'un
   * appelant ne passe pas explicitement la langue active. Les ~120 points
   * d'appel migrent écran par écran, avec l'extraction de chaque écran.
   */
  locale: string = FORMAT_LOCALE_DEFAULT,
): string {
  const code =
    currency && currency.trim() !== "" ? currency.trim().toUpperCase() : null;
  if (code === null) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Vues compactes : 1500 → « 1,5 k » en français, « 1.5k » en anglais.
 *
 * Le séparateur décimal suit la langue, et l'espace avant le suffixe disparaît
 * en anglais (« 1.5k », pas « 1.5 k »).
 */
export function formatViews(
  n: number,
  locale: string = FORMAT_LOCALE_DEFAULT,
): string {
  const sep = locale.startsWith("fr") ? " " : "";
  if (n >= 1_000_000) return `${trimZero(n / 1_000_000, locale)}${sep}M`;
  if (n >= 1_000) return `${trimZero(n / 1_000, locale)}${sep}k`;
  return String(n);
}

function trimZero(n: number, locale: string): string {
  const s = n.toFixed(1).replace(/\.0$/, "");
  return locale.startsWith("fr") ? s.replace(".", ",") : s;
}

/**
 * Lignes de la grille (base, bonus aux vues, primes triées par seuil), en
 * ENTRÉES STRUCTURÉES et non en phrases.
 *
 * Elles étaient assemblées ici en français (« 15,00 $ par post »), dans un
 * module pur qui ne connaît pas la langue du lecteur — le brief d'une créatrice
 * anglophone affichait donc sa grille de paie en français. Chaque entrée porte
 * sa clé et ses paramètres ; c'est l'écran qui compose la phrase.
 *
 * La grille est de la PAIE créatrices : `currency` = projects.payCurrency
 * (dollars pour Snytch), absente → montants sans symbole. La `locale` ne pilote
 * que la MISE EN FORME, jamais la devise.
 */
export type RateLine = {
  key: string;
  params: Record<string, string | number>;
};

export function rateSummary(
  rate: RateModel,
  currency?: string | null,
  locale: string = FORMAT_LOCALE_DEFAULT,
): RateLine[] {
  const lines: RateLine[] = [
    {
      key: "rate.base",
      params: { amount: formatMoney(rate.basePerPost, currency, locale) },
    },
  ];
  if (rate.viewBonusPer1k && rate.viewBonusPer1k > 0) {
    lines.push({
      key: "rate.viewBonus",
      params: { amount: formatMoney(rate.viewBonusPer1k, currency, locale) },
    });
  }
  const bounties = [...(rate.bounties ?? [])].sort(
    (a, b) => a.thresholdViews - b.thresholdViews,
  );
  for (const b of bounties) {
    lines.push({
      key: "rate.bounty",
      params: {
        amount: formatMoney(b.amount, currency, locale),
        views: formatViews(b.thresholdViews, locale),
      },
    });
  }
  return lines;
}
