/**
 * P7 — calcul de rémunération d'un post (pur, testé Vitest). Utilisé par le
 * calculateur du brief créateur, sur le rateSnapshot figé de l'assignment.
 *
 * Modèle (documenté, encodé par les tests) :
 *   - base      = basePerPost (tarif fixe par post)
 *   - viewBonus = (viewBonusPer1k ?? 0) × vues / 1000  (continu)
 *   - bounty    = SOMME des primes dont le seuil est ATTEINT (paliers cumulatifs :
 *                 chaque palier franchi paie sa prime)
 *   - total     = base + viewBonus + bounty
 * Tous les montants sont arrondis au centime pour que la somme soit exacte.
 */

export type RateSnapshot = {
  basePerPost: number;
  viewBonusPer1k?: number;
  bounties?: Array<{ thresholdViews: number; amount: number }>;
};

export interface Earnings {
  base: number;
  viewBonus: number;
  bounty: number;
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeEarnings(rate: RateSnapshot, views: number): Earnings {
  const v = Math.max(0, views);
  const base = round2(rate.basePerPost);
  const viewBonus = round2(((rate.viewBonusPer1k ?? 0) * v) / 1000);
  const bounty = round2(
    (rate.bounties ?? [])
      .filter((b) => v >= b.thresholdViews)
      .reduce((sum, b) => sum + b.amount, 0),
  );
  return { base, viewBonus, bounty, total: round2(base + viewBonus + bounty) };
}
