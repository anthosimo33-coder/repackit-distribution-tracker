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
 *
 * Plafond 150 $/vidéo (GLOBAL tous projets) appliqué au total (base + bonus).
 */
import { MAX_PAY_PER_VIDEO_EUR } from "./pricing-engine";

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
  const rawTotal = round2(base + viewBonus + bounty);
  if (rawTotal <= MAX_PAY_PER_VIDEO_EUR) {
    return { base, viewBonus, bounty, total: rawTotal };
  }
  // Plafond 150 $/vidéo : on garde la base, on rogne le bonus aux vues (part
  // explosive) puis les primes → base + bonus rognés = 150. Le bonus accru
  // (assignments.computeViewBonus = viewBonus + bounty) est donc capé À LA SOURCE.
  const room = Math.max(0, round2(MAX_PAY_PER_VIDEO_EUR - base));
  const cappedViewBonus = Math.min(viewBonus, room);
  const cappedBounty = Math.min(bounty, round2(room - cappedViewBonus));
  return {
    base,
    viewBonus: cappedViewBonus,
    bounty: cappedBounty,
    total: round2(base + cappedViewBonus + cappedBounty),
  };
}
