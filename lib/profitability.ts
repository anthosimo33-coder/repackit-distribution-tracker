/**
 * Rentabilité par projet — logique PURE (testée Vitest, aucune dép Convex/React).
 *
 * Met en face le REVENU Whop net (prompt 2) et le COÛT créateurs (moteur de paie,
 * posts warmup déjà exclus par le prompt 1) → MARGE = revenu net − coût. Plus un
 * RPM BUSINESS = revenu net / (vues / 1000).
 *
 * TOGGLE warmup : il change UNIQUEMENT le DÉNOMINATEUR (les vues), JAMAIS le
 * revenu ni le coût.
 *   - sans warmup : vues = posts monétisés (non-warmup) → vrai RPM business ;
 *   - avec warmup : vues = toutes les vues (warmup inclus) → RPM dilué.
 * Le revenu Whop ne dépend pas des posts → identique dans les deux cas.
 */

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

/** Ventilation des vues d'un projet : monétisées (non-warmup) vs warmup. */
export interface ViewsSplit {
  /** Vues des posts NON-warmup (monétisées). */
  monetizedViews: number;
  /** Vues des posts warmup (exclues de la paie, cf prompt 1). */
  warmupViews: number;
}

/**
 * Vues retenues selon le toggle : sans warmup = monétisées seules ; avec warmup =
 * monétisées + warmup. SEUL levier du toggle sur les métriques de vues.
 */
export function viewsForToggle(split: ViewsSplit, includeWarmup: boolean): number {
  const monetized = Math.max(0, finite(split.monetizedViews));
  const warmup = Math.max(0, finite(split.warmupViews));
  return includeWarmup ? monetized + warmup : monetized;
}

export interface ProfitabilityInput extends ViewsSplit {
  /** Revenu Whop NET (après frais), en devise du revenu (€) — CONSTANT vis-à-vis du toggle. */
  revenueNet: number;
  /** Coût créateurs (fixe + CPM + bonus, warmup déjà exclu), en devise de paie ($) — CONSTANT. */
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
  includeWarmup: boolean;
}

/**
 * Métriques de rentabilité pour un état de toggle donné. `revenueNet`,
 * `creatorCost` et `margin` sont INVARIANTS ; seuls `views` et `rpm` changent
 * avec `includeWarmup` (dilution du RPM quand on inclut les vues warmup).
 */
export function computeProfitability(
  input: ProfitabilityInput,
  includeWarmup: boolean,
): ProfitabilityMetrics {
  const views = viewsForToggle(input, includeWarmup);
  return {
    revenueNet: round2(finite(input.revenueNet)),
    creatorCost: round2(finite(input.creatorCost)),
    margin: computeMargin(input.revenueNet, input.creatorCost, input.fxRateToRevenue),
    views,
    rpm: computeRpm(input.revenueNet, views),
    includeWarmup,
  };
}
