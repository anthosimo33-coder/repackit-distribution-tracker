/**
 * Rentabilité par projet — logique PURE (testée Vitest, aucune dép Convex/React).
 *
 * Vit dans convex/ pour servir l'écran (via lib/profitability, qui ré-exporte) ET
 * l'outil MCP `rentabilite` : A6 interdit `convex/ → lib/`, pas l'inverse. Une
 * seule implémentation, donc Claude et la carte Rentabilité annoncent les mêmes
 * chiffres.
 *
 * Met en face le REVENU Whop net (prompt 2) et le COÛT créateurs (moteur de paie,
 * posts non rémunérés déjà exclus) → MARGE = revenu net − coût. Plus un
 * RPM BUSINESS = revenu net / (vues / 1000).
 *
 * TOGGLE : il change UNIQUEMENT le DÉNOMINATEUR (les vues), JAMAIS le revenu ni
 * le coût.
 *   - sans les non rémunérées : vues = posts RÉMUNÉRÉS → vrai RPM business ;
 *   - avec : vues = toutes les vues → RPM dilué.
 * Le revenu Whop ne dépend pas des posts → identique dans les deux cas.
 *
 * ⚠️ « rémunéré » n'est PAS « non-warmup » : cf `ViewsSplit`. Le dénominateur
 * suit la paie, sinon le RPM raconte une histoire que le grand livre contredit.
 */

import { effectiveFxRate } from "./currencyRate";

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

/**
 * Marge, DANS LA DEVISE DU REVENU = revenu net − coût créateurs converti. Le revenu
 * est en euros, le coût en dollars : `fxRateToRevenue` exprime 1 unité de paie dans
 * la devise du revenu (1 si même devise). SANS taux (`null`), la marge n'est PAS
 * calculée — on ne soustrait jamais deux devises sans conversion. Peut être négative.
 */
export function computeMargin(
  revenueNet: number,
  creatorCost: number,
  fxRateToRevenue: number | null,
): number | null {
  if (fxRateToRevenue === null || !(fxRateToRevenue > 0)) return null;
  return round2(finite(revenueNet) - finite(creatorCost) * fxRateToRevenue);
}

/**
 * RPM business = revenu net pour 1000 vues = revenu net / (vues / 1000). null si
 * vues ≤ 0 (RPM indéfini). Basé sur le REVENU (jamais le coût), cf décision.
 */
export function computeRpm(revenueNet: number, views: number): number | null {
  const v = finite(views);
  if (!(v > 0)) return null;
  return round2(finite(revenueNet) / (v / 1000));
}

/**
 * Ventilation des vues d'un projet : RÉMUNÉRÉES vs non rémunérées.
 *
 * ⚠️ La coupure est FINANCIÈRE, pas éditoriale (cf convex/viewCounters
 * `viewsSplitOf`, qui la calcule) : `unpaidViews` contient le warmup ET les posts
 * retirés de la paie à la main, et n'exclut PAS un post warmup explicitement payé.
 * Le champ s'appelait `warmupViews` — un nom qui décrivait mal son contenu, et un
 * calcul qui, lui, s'y conformait à tort.
 */
export interface ViewsSplit {
  /** Vues des posts RÉMUNÉRÉS — dénominateur du VRAI RPM business. */
  paidViews: number;
  /** Vues des posts NON rémunérés (warmup, ou explicitement retirés de la paie). */
  unpaidViews: number;
}

/**
 * Vues retenues selon le toggle : sans les non rémunérées = monétisées seules ;
 * avec = toutes. SEUL levier du toggle sur les métriques de vues.
 */
export function viewsForToggle(split: ViewsSplit, includeUnpaid: boolean): number {
  const monetized = Math.max(0, finite(split.paidViews));
  const unpaid = Math.max(0, finite(split.unpaidViews));
  return includeUnpaid ? monetized + unpaid : monetized;
}

export interface ProfitabilityInput extends ViewsSplit {
  /** Revenu Whop NET (après frais), en devise du revenu (€) — CONSTANT vis-à-vis du toggle. */
  revenueNet: number;
  /** Coût créateurs (fixe + CPM + bonus, non rémunérés déjà exclus), en devise de paie ($) — CONSTANT. */
  creatorCost: number;
  /** Taux paie→revenu EFFECTIF (1 si même devise, null si non reliées). Voir lib/currency. */
  fxRateToRevenue: number | null;
}

export interface ProfitabilityMetrics {
  /** Constant (ne bouge PAS avec le toggle). Devise du revenu. */
  revenueNet: number;
  /** Constant. Devise de la paie. */
  creatorCost: number;
  /** Constant : revenu net − coût converti (devise du revenu). null si devises non reliées. */
  margin: number | null;
  /** Dépend du toggle (monétisées vs toutes). */
  views: number;
  /** Dépend du toggle : revenu net / (vues / 1000) ; null si 0 vue. Devise du revenu. */
  rpm: number | null;
  includeUnpaid: boolean;
}

/**
 * Métriques de rentabilité pour un état de toggle donné. `revenueNet`,
 * `creatorCost` et `margin` sont INVARIANTS ; seuls `views` et `rpm` changent
 * avec `includeUnpaid` (dilution du RPM quand on inclut les vues non rémunérées).
 */
export function computeProfitability(
  input: ProfitabilityInput,
  includeUnpaid: boolean,
): ProfitabilityMetrics {
  const views = viewsForToggle(input, includeUnpaid);
  return {
    revenueNet: round2(finite(input.revenueNet)),
    creatorCost: round2(finite(input.creatorCost)),
    margin: computeMargin(input.revenueNet, input.creatorCost, input.fxRateToRevenue),
    views,
    rpm: computeRpm(input.revenueNet, views),
    includeUnpaid,
  };
}

/** Revenu, coût et vues d'une période — ce que sert `getProjectProfitability`. */
export interface ProfitabilityTotals extends ViewsSplit {
  revenueNet: number;
  creatorCost: number;
}

/** La réponse de `getProjectProfitability` (projet configuré), réduite à ce qu'on calcule. */
export interface ProfitabilitySource<M extends ProfitabilityTotals = ProfitabilityTotals> {
  /** Devise du REVENU (Whop). */
  currency: string | null;
  /** Devise de la PAIE créatrices. */
  payCurrency: string | null;
  fxRateToRevenue: number | null;
  total: ProfitabilityTotals;
  months: readonly M[];
}

export interface ProfitabilityReport<M extends ProfitabilityTotals = ProfitabilityTotals> {
  /** Taux paie → revenu RETENU (1 si même devise, null si non reliées). */
  fxRate: number | null;
  total: ProfitabilityMetrics;
  /** Chaque mois tel que servi, avec ses métriques calculées. */
  months: Array<M & { metrics: ProfitabilityMetrics }>;
}

/**
 * LE calcul de rentabilité d'un projet — cumul et mois par mois, pour un état du
 * toggle. La carte Rentabilité (écran Paiements) et l'outil MCP `rentabilite`
 * l'appellent tous les deux : ce que Claude annonce est ce que l'écran affiche,
 * au centime près, parce que c'est la même fonction.
 */
export function profitabilityReport<M extends ProfitabilityTotals>(
  source: ProfitabilitySource<M>,
  includeUnpaid: boolean,
): ProfitabilityReport<M> {
  const fxRate = effectiveFxRate(
    source.payCurrency,
    source.currency,
    source.fxRateToRevenue,
  );
  const metriques = (x: ProfitabilityTotals) =>
    computeProfitability({ ...x, fxRateToRevenue: fxRate }, includeUnpaid);
  return {
    fxRate,
    total: metriques(source.total),
    months: source.months.map((m) => ({ ...m, metrics: metriques(m) })),
  };
}
