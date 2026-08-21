import { v } from "convex/values";
import { authedQuery, authedMutation } from "./functions";

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
    // l'invitation. `by_user` n'existe pas — les fiches sont indexées par
    // projet ; un créateur peut en avoir plusieurs, on prend la première qui
    // porte une langue (elles sont posées par le même admin, au même moment).
    const fiches = await ctx.db
      .query("creators")
      .filter((q) => q.eq(q.field("userId"), ctx.userId))
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
