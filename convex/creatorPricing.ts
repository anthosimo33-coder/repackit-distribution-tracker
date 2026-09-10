/**
 * QUEL BARÈME S'APPLIQUE À CETTE CRÉATRICE — la résolution, seule et pure.
 *
 * Même règle que `effectiveBonusPricing` (convex/pricing.ts) : la grille écrite
 * sur la fiche PRIME, sinon celle par défaut du projet. Les deux lectures DOIVENT
 * rester la même — si l'écran d'assignation proposait un barème et que la paie en
 * lisait un autre, l'écart n'apparaîtrait qu'au versement.
 */

export type PricingLike = { _id: string; name: string; status: string };

export type ResolvedPricing = {
  pricingId: string | null;
  pricingName: string | null;
};

const AUCUN: ResolvedPricing = { pricingId: null, pricingName: null };

/**
 * ⚠️ UN BARÈME ARCHIVÉ NE SORT JAMAIS. Le sélecteur d'assignation ne liste que
 * les barèmes actifs : rendre ici une valeur absente de cette liste afficherait
 * un champ vide — soit exactement le « choisis un barème » qu'on veut supprimer,
 * mais sans le dire. Une créatrice restée sur une grille archivée est donc
 * traitée comme SANS grille, et l'écran le lui dit.
 */
export function resolveCreatorPricing(
  creator: { bonusPricingId?: string },
  defaultPricingId: string | null,
  pricings: readonly PricingLike[],
): ResolvedPricing {
  const id = creator.bonusPricingId ?? defaultPricingId;
  if (!id) return AUCUN;
  const p = pricings.find((x) => x._id === id);
  if (!p || p.status === "archived") return AUCUN;
  return { pricingId: p._id, pricingName: p.name };
}
