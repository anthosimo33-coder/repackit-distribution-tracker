import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

/**
 * ACCUEIL ADMIN PRÉ-CALCULÉ (table `dashboardCache`).
 *
 * POURQUOI. `ActionDashboard` (l'accueil admin) monte trois lectures qui
 * relisent chacune tout le projet : les décisions (~2,4 MB), le total dû
 * (~2 MB) et la liste des comptes. Réactives, elles se relancent à CHAQUE
 * écriture de la journée — 689 MB et 504 MB le 2026-09-19 pour les deux
 * premières, contre 120 et 88 MB un jour calme. Elles lisent désormais un
 * résultat calculé d'avance.
 *
 * MÊME RECETTE que le classement du portail (convex/leaderboardCache.ts) :
 *   - recalcul PÉRIODIQUE (cron, 30 min) plutôt qu'un déclencheur par table —
 *     ça couvre sans les énumérer le relevé du soir, une publication confirmée,
 *     un barème modifié, un compte archivé ;
 *   - écriture SEULEMENT si le résultat a changé, sinon on relancerait chez
 *     tous les admins connectés la query qu'on cherche à ne plus relancer ;
 *   - calcul dans une QUERY appelée par une action, jamais dans une mutation :
 *     une mutation qui relit toutes les publications entre en conflit (OCC)
 *     avec chaque commit du relevé du soir.
 *
 * FRAÎCHEUR. Jusqu'à 30 min de retard sur l'accueil admin. Les deux vues
 * portent sur des données de la veille (vues relevées à 23h30) ou sur de
 * l'argent qui ne bouge qu'au fil des validations ; l'écran de paie, lui,
 * reste calculé en direct.
 *
 * PAYLOAD EN JSON. Les deux valeurs sont des agrégats d'affichage, pas des
 * entités : les stocker en JSON évite de dupliquer dans le schéma une forme
 * qui suit l'écran (`DecisionDashboard` porte déjà une dizaine de champs
 * imbriqués). Même choix que `posthogCache`.
 */

export type DashboardCacheKey = "decisions" | "dueTotal";

const keyValidator = v.union(v.literal("decisions"), v.literal("dueTotal"));

/** Le JSON en cache, ou `null` — à l'appelant de calculer en direct. */
export async function readDashboardCache(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  key: DashboardCacheKey,
): Promise<string | null> {
  const row = await ctx.db
    .query("dashboardCache")
    .withIndex("by_project_key", (q) =>
      q.eq("projectId", projectId).eq("key", key),
    )
    .first();
  return row?.json ?? null;
}

/**
 * Écrit le JSON SEULEMENT s'il diffère de celui en cache.
 *
 * EXPORTÉ pour que chaque module garde SON calcul : `payments` sait compter
 * l'argent, `dashboardDecisions` sait assembler les décisions, et ce module-ci
 * ne sait que ranger. L'inverse (ce module important les deux) créait une
 * chaîne d'imports qui tirait la moitié du serveur dans le périmètre i18n.
 */
export async function writeDashboardCacheIfChanged(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  key: DashboardCacheKey,
  json: string,
): Promise<{ changed: boolean }> {
  const existing = await ctx.db
    .query("dashboardCache")
    .withIndex("by_project_key", (q) =>
      q.eq("projectId", projectId).eq("key", key),
    )
    .first();
  if (existing && existing.json === json) return { changed: false };
  if (existing) {
    await ctx.db.patch(existing._id, { json, changedAt: Date.now() });
  } else {
    await ctx.db.insert("dashboardCache", {
      projectId,
      key,
      json,
      changedAt: Date.now(),
    });
  }
  return { changed: true };
}

/**
 * INVALIDE une vue du cache — l'appelant vient de la rendre fausse.
 *
 * Supprimer plutôt que recalculer : la mutation qui appelle ceci est déjà en
 * train d'écrire, et recalculer ici lui ferait relire tout le projet dans SA
 * transaction (conflit OCC avec le relevé du soir, cf en-tête). La lecture
 * suivante retombe sur le calcul direct — quelques MB, une fois — et le cron
 * réécrit la row dans la demi-heure.
 *
 * C'est ce qui garde l'accueil JUSTE tout de suite après une action faite
 * DEPUIS l'accueil : un acompte saisi, un hook désactivé, un cycle payé.
 */
export async function invalidateDashboardCache(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  key: DashboardCacheKey,
): Promise<void> {
  const row = await ctx.db
    .query("dashboardCache")
    .withIndex("by_project_key", (q) =>
      q.eq("projectId", projectId).eq("key", key),
    )
    .first();
  if (row) await ctx.db.delete(row._id);
}

export const writeJson = internalMutation({
  args: {
    projectId: v.id("projects"),
    key: keyValidator,
    json: v.string(),
  },
  handler: async (ctx, { projectId, key, json }) =>
    writeDashboardCacheIfChanged(ctx, projectId, key, json),
});

export const listProjectIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"projects">[]> =>
    (await ctx.db.query("projects").collect()).map((p) => p._id),
});

/** Cron : recalcule l'accueil admin de chaque projet. */
export const refreshAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ projects: number; changed: number }> => {
    const projectIds = await ctx.runQuery(
      internal.dashboardCache.listProjectIds,
      {},
    );
    let changed = 0;
    for (const projectId of projectIds) {
      for (const key of ["decisions", "dueTotal"] as const) {
        const json = await ctx.runQuery(
          key === "decisions"
            ? internal.dashboardDecisions.computeDecisionsJson
            : internal.payments.computeDueTotalJson,
          { projectId },
        );
        const r = await ctx.runMutation(internal.dashboardCache.writeJson, {
          projectId,
          key,
          json,
        });
        if (r.changed) changed += 1;
      }
    }
    return { projects: projectIds.length, changed };
  },
});
