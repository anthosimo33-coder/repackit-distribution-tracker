import { creatorQuery, adminViewAsMoneyQuery } from "./functions";
import { effectiveBonusPricing, MAX_PAY_PER_VIDEO_EUR } from "./pricing";
import { pricingPayCurrency } from "./creatorPayCurrency";
import { resolveCreatorKind } from "./roles";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * « MON CONTRAT » — le barème d'une créatrice, tel qu'elle doit pouvoir le relire
 * à tout moment : fixe, vues, bonus par vidéo, et les règles qui vont avec.
 *
 * LE BARÈME AFFICHÉ EST CELUI DE LA PAIE : `effectiveBonusPricing` (la grille de
 * la fiche, sinon le défaut du projet), la même résolution que les paliers et la
 * pré-sélection à l'assignation. Une page qui lirait un autre barème que celui
 * qui paie annoncerait un contrat que personne n'applique.
 *
 * Lu EN DIRECT : modifier le barème modifie la page. Les vidéos déjà attribuées
 * gardent leur snapshot (fixe, CPM) — l'écran le dit quand le cycle en cours en
 * contient (cf lib/creator-terms).
 *
 * Ce qui NE sort PAS : le NOM du barème (« Juliette Nouveau Contrat 🇫🇷 » est le
 * libellé de l'équipe, pas le sien), ni rien d'un autre barème.
 *
 * PARTENAIRES SEULEMENT : un clippeur est payé au clip, un talent au forfait ;
 * leur montrer une grille de CPM décrirait une paie qu'ils ne touchent pas.
 */
export type CreatorTerms = {
  pricing: {
    pricingId: Id<"pricings">;
    /** Devise de TOUS les montants ci-dessous (celle du barème, sinon du projet). */
    currency: string | null;
    montantFixe: number;
    nbVideosCible: number;
    /** Montant pour 1 000 vues. 0 = pas de rémunération aux vues. */
    tauxCPM: number;
    /** Vues cumulées du cycle qui débloquent le fixe. 0 = aucune condition. */
    seuilVuesFixe: number;
    /** Plafond par vidéo, fixe + vues (hors bonus). */
    plafondParVideo: number;
    /** Grille de bonus PAR VIDÉO, paliers triés ; null = aucune. */
    videoBonus: {
      tiers: { seuilVues: number; montant: number }[];
      cumulative: boolean;
    } | null;
    /** Le barème porte des paliers sur le CUMUL de vues (écran Progression). */
    hasCumulTiers: boolean;
  } | null;
};

async function termsFor(
  ctx: QueryCtx,
  creatorId: Id<"creators">,
): Promise<CreatorTerms> {
  const creator = await ctx.db.get(creatorId);
  if (!creator || resolveCreatorKind(creator.kind) !== "partner") {
    return { pricing: null };
  }
  const effective = await effectiveBonusPricing(ctx, creator);
  const pricing = effective ? await ctx.db.get(effective.pricingId) : null;
  if (!pricing) return { pricing: null };
  const project = await ctx.db.get(creator.projectId);
  const tiers = (pricing.videoBonus?.tiers ?? [])
    .filter((t) => t.montant > 0 && t.seuilVues > 0)
    .map((t) => ({ seuilVues: t.seuilVues, montant: t.montant }))
    .sort((a, b) => a.seuilVues - b.seuilVues);
  return {
    pricing: {
      pricingId: pricing._id,
      currency: pricingPayCurrency(pricing, project),
      montantFixe: Math.max(0, pricing.montantFixe),
      nbVideosCible: Math.max(0, pricing.nbVideosCible),
      tauxCPM: Math.max(0, pricing.tauxCPM),
      seuilVuesFixe: Math.max(0, pricing.seuilVuesFixe ?? 0),
      plafondParVideo: MAX_PAY_PER_VIDEO_EUR,
      videoBonus:
        tiers.length > 0
          ? { tiers, cumulative: pricing.videoBonus?.cumulative === true }
          : null,
      hasCumulTiers: (effective?.tiers.length ?? 0) > 0,
    },
  };
}

/** CRÉATRICE — son contrat sur CE projet. Aucun id en argument. */
export const getMyTerms = creatorQuery({
  args: {},
  handler: async (ctx): Promise<CreatorTerms> => termsFor(ctx, ctx.creatorId),
});

/**
 * ADMIN view-as — le même contrat. Garde ARGENT : un barème dit ce qu'elle
 * gagne, comme ses paiements (cf lib/view-as-access, MONEY_SUBS).
 */
export const getTermsAsAdmin = adminViewAsMoneyQuery({
  args: {},
  handler: async (ctx): Promise<CreatorTerms> => termsFor(ctx, ctx.creatorId),
});
