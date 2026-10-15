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
 * retient la part promo (`promoPartOfVideoCost`, la même fraction que la Vue
 * d'ensemble) puis la découpe par marché (`splitCostByMarket`). Les primes
 * CRÉATRICE (paliers, défis) se découpent à part : `splitPrimeByMarket`.
 */
import { promoPartOfVideoCost } from "./pricing";
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
 * `videoCost` est le coût déjà réparti par le moteur, bonus par vidéo compris
 * (cf videoCostsOfMonth ; il peut différer de `fixed + cpm` : mois en cours =
 * coût ENGAGÉ). La fraction est celle de la Vue d'ensemble
 * (pricing.promoPartOfVideoCost) : le bonus entre en entier, le reste prend la
 * part promo du couple (fixe, CPM). Une vidéo au-delà du budget fixe, sur un
 * barème sans CPM, n'a plus que son bonus — le ramener à zéro le sortait du coût
 * de son marché.
 */
export function promoCostOfVideo(input: {
  videoCost: number;
  fixed: number;
  cpm: number;
  /** Bonus par vidéo COMPRIS dans `videoCost`. Absent ⇒ 0. */
  bonus?: number;
  payableViews: number;
  promoPaidViews: number;
  hasPromoPost: boolean;
}): number {
  // Vidéo 100 % warmup, même rémunérée : rien n'y est dépensé pour vendre.
  if (!input.hasPromoPost || input.videoCost <= 0) return 0;
  return promoPartOfVideoCost({
    cost: input.videoCost,
    fixed: input.fixed,
    cpm: input.cpm,
    bonus: input.bonus ?? 0,
    payableViews: input.payableViews,
    promoPaidViews: input.promoPaidViews,
  });
}

/**
 * Répartit une PRIME CRÉATRICE (palier débloqué, victoire de défi) entre ses
 * marchés.
 *
 * Une prime n'a pas de vidéo : un palier se débloque sur le CUMUL de vues
 * rémunérées ET promo de TOUTE l'histoire de la créatrice
 * (pricing.creatorCumulViews). La clé fidèle est donc la part de chaque marché
 * dans ses vues PROMO, toutes vidéos confondues — la même clé de vues que le
 * coût d'une vidéo (splitCostByMarket). Les posts warmup ne font pas avancer un
 * palier : ils ne reçoivent rien.
 *
 * Aucune cible promo (cas théorique : une prime sans aucun post promo) ⇒ la
 * prime reste visible sur « non défini » plutôt que de disparaître.
 */
export function splitPrimeByMarket(
  amount: number,
  targets: readonly PromoTarget[],
): { country: string | null; cost: number }[] {
  const montant = Math.max(0, amount);
  if (montant === 0) return [];
  const promo = targets.filter((t) => t.promo);
  if (promo.length === 0) {
    return [{ country: null, cost: Math.round(montant * 100) / 100 }];
  }
  return splitCostByMarket(
    montant,
    promo.map((t) => ({ country: t.country, views: t.views })),
  ).map((p) => ({ country: p.country, cost: p.cost }));
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
