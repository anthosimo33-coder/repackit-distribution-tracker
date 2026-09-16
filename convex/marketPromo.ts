/**
 * LA PART PROMO D'UNE VIDÉO, RÉPARTIE ENTRE SES MARCHÉS — logique PURE.
 *
 * Le RPM d'un marché divise des euros par des vues. Les deux côtés doivent
 * porter sur le MÊME périmètre : les posts PROMO. Le warmup n'est pas payé
 * (sauf exception rémunérée) et ne vend pas ; le laisser dans les vues gonfle le
 * dénominateur, le laisser dans le coût gonfle le numérateur (cf la règle du
 * « RPM promo » : un coût divisé par des vues promo prend le coût promo).
 *
 * ⚠️ AUCUN MONTANT N'EST CALCULÉ ICI. Le coût de la vidéo vient du moteur de
 * paie (`convex/marketPnl` → `computeLivePricingBreakdown`) ; ce module en
 * retient la part promo (`promoVideoCost`, le même prorata que la Vue
 * d'ensemble) puis la découpe par marché (`splitCostByMarket`).
 */
import { promoVideoCost } from "./pricing";
import { splitCostByMarket } from "./marketCost";

export type PromoTarget = {
  /** Pays visé du compte. `null` = compte sans pays cible. */
  country: string | null;
  /** Vues MESURÉES du post. */
  views: number;
  /** Post promo (non warmup) ? */
  promo: boolean;
};

export type PromoShare = {
  country: string | null;
  promoCost: number;
  promoViews: number;
};

/**
 * Part PROMO du coût d'une vidéo.
 *
 * `videoCost` est le coût déjà réparti par le moteur (il peut différer de
 * `fixed + cpm` : mois en cours = coût ENGAGÉ). On lui applique la FRACTION promo
 * du couple (fixe, CPM) plutôt que de recalculer un montant.
 */
export function promoCostOfVideo(input: {
  videoCost: number;
  fixed: number;
  cpm: number;
  payableViews: number;
  promoPaidViews: number;
  hasPromoPost: boolean;
}): number {
  // Vidéo 100 % warmup, même rémunérée : rien n'y est dépensé pour vendre.
  if (!input.hasPromoPost || input.videoCost <= 0) return 0;
  const brut = Math.max(0, input.fixed) + Math.max(0, input.cpm);
  if (brut <= 0) return 0;
  const promo = promoVideoCost(
    input.fixed,
    input.cpm,
    input.payableViews,
    input.promoPaidViews,
  );
  return Math.round(input.videoCost * Math.min(1, promo / brut) * 100) / 100;
}

/**
 * Découpe le coût promo d'une vidéo entre les marchés de ses posts PROMO, au
 * prorata de leurs vues (partage égal sans vue mesurée, comme le coût total).
 * Les posts warmup ne reçoivent ni coût ni vues.
 */
export function splitPromoByMarket(
  promoCost: number,
  targets: readonly PromoTarget[],
): PromoShare[] {
  const promo = targets.filter((t) => t.promo);
  if (promo.length === 0) return [];
  const vues = new Map<string | null, number>();
  for (const t of promo) {
    vues.set(t.country, (vues.get(t.country) ?? 0) + Math.max(0, t.views));
  }
  const couts = new Map<string | null, number>(
    splitCostByMarket(
      Math.max(0, promoCost),
      promo.map((t) => ({ country: t.country, views: t.views })),
    ).map((p) => [p.country, p.cost]),
  );
  return [...vues.entries()].map(([country, promoViews]) => ({
    country,
    promoViews,
    promoCost: couts.get(country) ?? 0,
  }));
}
