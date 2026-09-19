import { publicQuery } from "./functions";
import { getProjectBySlug } from "./projects";

/**
 * Chiffres de la page d'accueil publique (`/`, visiteur non connecté) : la
 * vitrine d'UNE app du studio, lue en direct.
 *
 * Endpoint PUBLIC (pré-session) : il ne renvoie que des TOTAUX — aucun nom,
 * aucun handle, aucun montant. Le slug est figé ici, jamais reçu du client :
 * la page ne peut pas s'en servir pour interroger un autre projet.
 *
 * Périmètre :
 *   - videos   : publications du projet, warmup compris (ce sont des vidéos
 *                réellement en ligne) ;
 *   - views    : somme des dernières vues relevées (`vuesLatest`) ;
 *   - accounts : comptes distincts qui ont publié ;
 *   - creators : fiches créateurs au statut « active ».
 * `null` si le projet n'existe pas (déploiement de dev, e2e) : la page masque
 * alors le bloc de chiffres au lieu d'afficher des zéros.
 */
export const SHOWCASE_PROJECT_SLUG = "snytch";

export const getShowcaseStats = publicQuery({
  args: {},
  handler: async (ctx) => {
    const project = await getProjectBySlug(ctx, SHOWCASE_PROJECT_SLUG);
    if (project === null) return null;

    const publications = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    let views = 0;
    const accounts = new Set<string>();
    let firstPublishedAt: number | null = null;
    for (const p of publications) {
      if (typeof p.vuesLatest === "number") views += p.vuesLatest;
      if (p.compte) accounts.add(p.compte.toLowerCase());
      if (typeof p.datePubli === "number") {
        firstPublishedAt =
          firstPublishedAt === null
            ? p.datePubli
            : Math.min(firstPublishedAt, p.datePubli);
      }
    }

    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();

    return {
      videos: publications.length,
      views,
      accounts: accounts.size,
      creators: creators.filter((c) => c.status === "active").length,
      firstPublishedAt,
    };
  },
});
