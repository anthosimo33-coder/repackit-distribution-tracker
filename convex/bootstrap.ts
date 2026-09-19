import { publicQuery } from "./functions";

/**
 * La fenêtre bootstrap est-elle OUVERTE ? (table users vide → le premier
 * signup devient superadmin, cf convex/auth.ts.)
 *
 * Lue par /login, AVANT session, pour n'afficher « Premier démarrage ? Créer le
 * compte initial » que lorsqu'il peut aboutir. Hors bootstrap, tout signup sans
 * jeton d'invitation est rejeté : le lien ne menait qu'à une erreur.
 *
 * Ne révèle qu'un booléen — « ce déploiement a-t-il déjà un compte » — sans
 * rien sur les comptes eux-mêmes.
 */
export const isBootstrapOpen = publicQuery({
  args: {},
  handler: async (ctx) => {
    return (await ctx.db.query("users").first()) === null;
  },
});
