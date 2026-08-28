import { v } from "convex/values";
import { authedQuery, authedMutation, requireCreatorViewableByAdmin } from "./functions";
import { getProjectBySlug } from "./projects";
import type { Id } from "./_generated/dataModel";

/**
 * LANGUE D'INTERFACE — lecture et écriture de la préférence de l'utilisateur.
 *
 * Deux porteurs, volontairement :
 *   `users.locale`    — fait foi une fois le compte créé. Seule entité commune
 *                       aux quatre identités (admin, partenaire, talent,
 *                       clippeur), donc le seul endroit où une préférence
 *                       d'INTERFACE a un sens unique.
 *   `creators.locale` — posé par l'admin à la création de la fiche. Sert AVANT
 *                       l'existence du compte : l'e-mail d'invitation part
 *                       quand `creators.userId` est encore undefined, il n'y a
 *                       donc pas d'`users.locale` à lire. Il sert aussi de
 *                       valeur d'amorçage : à la première lecture, un user sans
 *                       préférence hérite de celle de sa fiche.
 *
 * La chaîne complète de résolution (users → creators → cookie →
 * Accept-Language → "fr") vit dans i18n/request.ts ; ce module n'en rend que
 * les deux premiers maillons, en UN aller-retour.
 *
 * ⚠️ Aucune valeur n'est validée ici contre la liste des langues supportées :
 * c'est `i18n/locales.ts` qui normalise, côté Next. Stocker une valeur inconnue
 * n'est pas un risque (on retombe sur le défaut), la refuser en base créerait
 * un couplage entre le schéma et la liste des langues livrées.
 */

/** Préférence de langue de l'appelant : la sienne, sinon celle de sa fiche. */
export const getMyLocale = authedQuery({
  args: {},
  handler: async (ctx): Promise<{ locale: string | null }> => {
    const user = await ctx.db.get(ctx.userId);
    if (user?.locale && user.locale.trim() !== "") {
      return { locale: user.locale };
    }
    // Amorçage : la fiche créatrice porte la langue choisie par l'admin à
    // l'invitation. Un créateur peut avoir plusieurs fiches (une par projet) —
    // on prend la première qui porte une langue, elles sont posées par le même
    // admin au même moment.
    //
    // Via l'index `by_user` (convex/schema.ts:975), PAS un `.filter()` : cette
    // query est appelée par i18n/request.ts à CHAQUE rendu serveur d'un
    // utilisateur sans `users.locale`, un scan de table complet y serait sur le
    // chemin chaud de toutes les pages.
    const fiches = await ctx.db
      .query("creators")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .collect();
    for (const f of fiches) {
      if (f.locale && f.locale.trim() !== "") return { locale: f.locale };
    }
    return { locale: null };
  },
});

/**
 * Change la langue de l'appelant. Écrit sur `users` (qui fait foi) ; le cookie
 * NEXT_LOCALE est posé côté Next par la même action, pour que le prochain rendu
 * SERVEUR ait la bonne langue sans attendre Convex (pas de bascule visible).
 */
export const setMyLocale = authedMutation({
  args: { locale: v.string() },
  handler: async (ctx, { locale }) => {
    await ctx.db.patch(ctx.userId, { locale });
    return { locale };
  },
});

/**
 * Langue de la personne OBSERVÉE, pour le mode admin « voir son espace ».
 *
 * POURQUOI UNE QUERY SÉPARÉE. `getMyLocale` rend la langue de l'APPELANT, et
 * c'est exactement le problème qu'elle ne peut pas résoudre ici : en
 * observation, l'appelant est l'admin. La preview rendait donc dans la langue de
 * l'admin — un espace créé en anglais s'affichait en français, avec des dates et
 * des montants au format français. Or cette preview n'existe que pour montrer ce
 * que la personne voit ; rendue dans une autre langue, elle ne montre plus rien.
 *
 * MÊME ORDRE que la chaîne normale, restreint à ce qu'un tiers peut lire :
 *   1. `users.locale`    — la préférence du compte, si le compte existe ;
 *   2. `creators.locale` — la langue posée par l'admin sur la fiche ;
 *   3. `null`            — l'appelant tranche (« fr », le défaut du produit).
 *
 * Les maillons cookie et `Accept-Language` n'ont AUCUN sens ici : ce sont ceux
 * du navigateur de l'admin, pas ceux de la personne observée. Les inclure
 * ramènerait le défaut qu'on corrige.
 *
 * Le compte peut ne pas exister (fiche invitée, jamais activée) : `creators.locale`
 * est alors le seul porteur, et c'est le cas nominal juste après l'invitation.
 *
 * Gate : `adminViewAsQuery` — identité, rôle admin du projet, fiche ∈ projet.
 */

/**
 * LANGUE D'UN CRÉATEUR, telle qu'elle lui est RÉELLEMENT servie — cœur partagé.
 *
 * Ordre, identique à la chaîne de i18n/request.ts restreinte à ce qu'un tiers
 * peut lire : `users.locale` (le compte fait foi), puis `creators.locale` (posé
 * par l'admin à l'invitation), puis `null` — l'appelant tranche.
 *
 * ⚠️ EXTRAIT EN HELPER, et c'est le point : `getCreatorLocale` (fiche
 * individuelle, preview view-as) et `listCreators` (l'écran createurs, qui
 * filtre par langue) doivent rendre la MÊME réponse. Deux implémentations
 * auraient divergé — et la divergence se serait vue comme un filtre qui ment,
 * pas comme un bug.
 *
 * RIEN N'EST NORMALISÉ ICI : la valeur brute est rendue telle quelle, comme
 * avant. C'est `localeOrDefault` / `normalizeLocale` qui décident, chez
 * l'appelant, ce que « fr » veut dire.
 */
export async function resolveCreatorLocale(
  ctx: { db: { get: (id: Id<"users">) => Promise<{ locale?: string } | null> } },
  creator: { userId?: Id<"users">; locale?: string },
): Promise<string | null> {
  if (creator.userId) {
    const user = await ctx.db.get(creator.userId);
    if (user?.locale && user.locale.trim() !== "") return user.locale;
  }
  const fiche = creator.locale;
  return fiche && fiche.trim() !== "" ? fiche : null;
}

export const getCreatorLocale = authedQuery({
  args: { projectSlug: v.string(), creatorId: v.id("creators") },
  handler: async (ctx, { projectSlug, creatorId }): Promise<{ locale: string | null }> => {
    // Gate posée à la main plutôt que via `adminViewAsQuery` : ce wrapper prend
    // un `projectId`, or le layout ne connaît que le SLUG de l'URL. Résoudre le
    // projet côté client demanderait une query publique qui rende l'id — on
    // préfère un aller-retour de moins et une surface publique inchangée. La
    // garde exécutée est la MÊME (identité, rôle admin du projet, fiche ∈ projet).
    const project = await getProjectBySlug(ctx, projectSlug);
    if (project === null) return { locale: null };
    const creator = await requireCreatorViewableByAdmin(
      ctx,
      ctx.userId,
      project._id,
      creatorId,
    );
    return { locale: await resolveCreatorLocale(ctx, creator) };
  },
});
