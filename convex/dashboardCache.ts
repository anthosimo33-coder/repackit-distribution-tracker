import { v, type Infer } from "convex/values";
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

/**
 * `profitCosts:<lot>/<lots>` = la moitié COÛT de la carte Rentabilité (écran
 * Paiements), un lot de créatrices par row — cf `getProfitabilityCosts`. Elle
 * déroule le moteur de paie créatrice × mois sur tout le projet : 5,8 Mo lus
 * par lot sur Snytch, 255 appels le 2026-11-19, relancés à chaque écriture
 * d'une assignation ou d'une publication tant que l'écran était ouvert.
 */
const keyValidator = v.union(
  v.literal("decisions"),
  v.literal("dueTotal"),
  v.literal("profitCosts:0/2"),
  v.literal("profitCosts:1/2"),
);

export type DashboardCacheKey = Infer<typeof keyValidator>;

/** Les lots que monte la carte (components/ProfitabilityCard) — ceux que le cron range. */
export const PROFIT_COSTS_LOTS = 2;

/** La row d'un lot de la carte ; `null` pour un découpage que le cron ne range pas. */
export function profitCostsKey(lot: number, lots: number): DashboardCacheKey | null {
  if (lots !== PROFIT_COSTS_LOTS) return null;
  if (lot === 0) return "profitCosts:0/2";
  if (lot === 1) return "profitCosts:1/2";
  return null;
}

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

/**
 * INVALIDE ce qui dépend de la paie : le total dû ET la carte Rentabilité. Un
 * cycle payé gèle son montant (le coût du mois devient « réglé »), un acompte ou
 * un barème le change : l'écran Paiements, qui porte les deux, doit les montrer
 * juste après l'action. Même règle que `invalidateDashboardCache` : supprimer,
 * jamais recalculer dans la mutation.
 */
export async function invalidatePayCaches(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<void> {
  const rows = await ctx.db
    .query("dashboardCache")
    .withIndex("by_project_key", (q) => q.eq("projectId", projectId))
    .collect();
  for (const row of rows) {
    if (row.key === "dueTotal" || row.key.startsWith("profitCosts:")) {
      await ctx.db.delete(row._id);
    }
  }
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

/**
 * Cron : recalcule l'accueil admin de chaque projet, le classement du portail
 * et la carte Rentabilité de l'écran Paiements.
 */
export const refreshAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ projects: number; changed: number }> => {
    const projectIds = await ctx.runQuery(
      internal.dashboardCache.listProjectIds,
      {},
    );
    let changed = 0;
    const write = async (
      projectId: Id<"projects">,
      key: DashboardCacheKey,
      json: string,
    ) => {
      const r = await ctx.runMutation(internal.dashboardCache.writeJson, {
        projectId,
        key,
        json,
      });
      if (r.changed) changed += 1;
    };
    // Chaque étape à part : un calcul qui échoue (plafond de lecture, donnée
    // inattendue) ne prive pas les autres vues — ni les autres projets — de
    // leur rafraîchissement. Le classement avait son propre cron jusqu'au
    // 2026-11-20 ; il ne doit pas tomber avec les décisions. L'échec reste
    // visible : le cron échoue à la fin, avec la première erreur.
    const echecs: unknown[] = [];
    const etape = async (nom: string, projectId: Id<"projects">, f: () => Promise<void>) => {
      try {
        await f();
      } catch (e) {
        console.error(`dashboardCache.refreshAll : ${nom} (${projectId})`, e);
        echecs.push(e);
      }
    };
    for (const projectId of projectIds) {
      await etape("décisions", projectId, async () => {
        await write(
          projectId,
          "decisions",
          await ctx.runQuery(internal.dashboardDecisions.computeDecisionsJson, {
            projectId,
          }),
        );
      });
      // UN passage de paie pour le total dû ET le classement du portail : ils
      // relisaient chacun tout le projet, dans deux crons (cf payments).
      await etape("paie", projectId, async () => {
        const paie = await ctx.runQuery(internal.payments.computePayrollCaches, {
          projectId,
        });
        await write(projectId, "dueTotal", paie.dueTotalJson);
        const lb = await ctx.runMutation(internal.leaderboardCache.writeRows, {
          projectId,
          rows: paie.leaderboard,
        });
        if (lb.changed) changed += 1;
      });
      // La carte Rentabilité, lot par lot (un lot = une query, cf le plafond
      // d'une seconde de calcul). `null` = projet sans Whop : la carte se
      // masque sans rien lire, il n'y a rien à ranger.
      for (let lot = 0; lot < PROFIT_COSTS_LOTS; lot++) {
        await etape(`rentabilité ${lot}`, projectId, async () => {
          const json = await ctx.runQuery(internal.profitability.computeCostsJson, {
            projectId,
            lot,
            lots: PROFIT_COSTS_LOTS,
          });
          const key = profitCostsKey(lot, PROFIT_COSTS_LOTS);
          if (json !== null && key !== null) await write(projectId, key, json);
        });
      }
    }
    if (echecs.length > 0) throw echecs[0];
    return { projects: projectIds.length, changed };
  },
});
