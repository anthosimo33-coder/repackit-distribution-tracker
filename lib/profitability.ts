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

/** Marge = revenu net − coût créateurs (arrondi au centime, peut être négatif). */
export function computeMargin(revenueNet: number, creatorCost: number): number {
  return round2(finite(revenueNet) - finite(creatorCost));
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
  /** Revenu Whop NET (après frais) — CONSTANT vis-à-vis du toggle. */
  revenueNet: number;
  /** Coût créateurs (fixe + CPM + bonus, warmup déjà exclu) — CONSTANT. */
  creatorCost: number;
}

export interface ProfitabilityMetrics {
  /** Constant (ne bouge PAS avec le toggle). */
  revenueNet: number;
  /** Constant. */
  creatorCost: number;
  /** Constant : revenu net − coût. */
  margin: number;
  /** Dépend du toggle (monétisées vs toutes). */
  views: number;
  /** Dépend du toggle : revenu net / (vues / 1000) ; null si 0 vue. */
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
    margin: computeMargin(input.revenueNet, input.creatorCost),
    views,
    rpm: computeRpm(input.revenueNet, views),
    includeWarmup,
  };
}
