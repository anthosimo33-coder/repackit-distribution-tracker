import { internalMutation } from "./_generated/server";

/**
 * Outillage opérationnel — réinitialise ENTIÈREMENT l'auth d'un deployment
 * (users + sessions + comptes de connexion). Rouvre la fenêtre bootstrap
 * (cf convex/auth.ts) : le prochain signup redevient possible et superadmin.
 *
 * Cas d'usage : E2E_SECRET changé après création du user e2e (mot de passe
 * désynchronisé), ou compte initial perdu. internal = jamais exposé à l'API
 * publique, exécutable uniquement par le owner du deployment :
 *   ./node_modules/.bin/convex run maintenance:wipeAuthTables
 */
export const wipeAuthTables = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "authSessions",
      "authAccounts",
      "authRefreshTokens",
      "authVerificationCodes",
      "authVerifiers",
      "authRateLimits",
      "users",
    ] as const;
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
      counts[table] = rows.length;
    }
    return counts;
  },
});

/**
 * Vide le cache de veille RADAR (3 tables éphémères : recherches d'outliers +
 * tendances hashtags/vidéos). À exécuter UNE FOIS après le passage du cache au
 * mode GLOBAL (clé sans projectId) pour purger les anciennes lignes scopées
 * projet (doublons cross-projet désormais orphelins). Le cache se reconstruit au
 * premier appel. internal = jamais exposé à l'API publique :
 *   ./node_modules/.bin/convex run maintenance:purgeRadarCaches
 */
export const purgeRadarCaches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "radarSearches",
      "radarTrendHashtags",
      "radarTrendVideos",
    ] as const;
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
      counts[table] = rows.length;
    }
    return counts;
  },
});
