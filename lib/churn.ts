/**
 * CHURN — le calcul vit dans convex/churn.ts (partagé avec l'outil MCP
 * `retention`). Ce module garde le TEXTE d'écran : le libellé d'un abonnement
 * sans offre connue.
 */

import {
  computeChurn as computeChurnPartage,
  type ChurnParams as ChurnParamsPartages,
  type ChurnResult,
  type MembershipInput,
} from "../convex/churn";

export type {
  ChurnByPlan,
  ChurnResult,
  ChurnState,
  MembershipInput,
  ResiliationDetail,
  UpcomingExpiration,
} from "../convex/churn";
export { classifyMembership, intervalToDays } from "../convex/churn";

/** Libellé (et clé de regroupement) d'un abonnement sans offre connue. */
export const LIBELLE_SANS_OFFRE = "(sans offre)";

export type ChurnParams = Omit<ChurnParamsPartages, "libelleSansOffre">;

/** Métriques de churn de l'onglet Rétention (cf convex/churn.computeChurn). */
export function computeChurn(
  memberships: MembershipInput[],
  params: ChurnParams,
): ChurnResult {
  return computeChurnPartage(memberships, { ...params, libelleSansOffre: LIBELLE_SANS_OFFRE });
}
