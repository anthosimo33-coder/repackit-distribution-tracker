import { v, type Infer } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
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
 *   - recalcul PÉRIODIQUE (cron, toutes les heures) plutôt qu'un déclencheur par table —
 *     ça couvre sans les énumérer le relevé du soir, une publication confirmée,
 *     un barème modifié, un compte archivé ;
 *   - écriture SEULEMENT si le résultat a changé, sinon on relancerait chez
 *     tous les admins connectés la query qu'on cherche à ne plus relancer ;
 *   - calcul dans une QUERY appelée par une action, jamais dans une mutation :
 *     une mutation qui relit toutes les publications entre en conflit (OCC)
 *     avec chaque commit du relevé du soir.
 *
 * FRAÎCHEUR. Jusqu'à une heure de retard (30 min jusqu'au 2026-11-20, l'heure
 * choisie par le fondateur pour la facture). Les vues portent sur des données
 * de la veille (vues relevées à 23h30) ou sur de l'argent qui ne bouge qu'au
 * fil des validations. Une mutation d'argent invalide la paie et la fait
 * recalculer dans les 20 s (`invalidatePayCaches`) ; « Marquer payé » refuse
 * un montant qui n'est plus celui affiché (convex/payments `markCyclePaid`).
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
 * réécrit la row dans l'heure.
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

/** Le compteur d'invalidations de la paie du projet — 0 tant qu'aucune. */
export async function readPayEpoch(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<number> {
  const row = await ctx.db
    .query("payCacheEpochs")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first();
  return row?.epoch ?? 0;
}

/**
 * Délai du recalcul qui suit une invalidation. Un paiement EN MASSE enchaîne
 * une mutation par cycle : chacune planifie un recalcul, et seul le dernier
 * planifié s'exécute (les autres voient un compteur plus récent que le leur).
 * Entre-temps l'écran lit le calcul direct — juste, au prix d'une lecture.
 */
export const PAY_REFRESH_DELAY_MS = 20_000;

/**
 * INVALIDE ce qui dépend de la paie : le total dû, la carte Rentabilité et
 * les lignes de l'écran Paiements. Un cycle payé gèle son montant, un acompte
 * ou un barème le change : l'écran doit les montrer juste après l'action.
 * Même règle que `invalidateDashboardCache` : supprimer, jamais recalculer
 * dans la mutation. Le compteur avance — un recalcul lu avant cette mutation
 * ne rangera plus rien (cf `writePaymentRows`) — et un recalcul est planifié.
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
  for (const part of await ctx.db
    .query("paymentRowsCache")
    .withIndex("by_project_part", (q) => q.eq("projectId", projectId))
    .collect()) {
    await ctx.db.delete(part._id);
  }
  const compteur = await ctx.db
    .query("payCacheEpochs")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first();
  const epoch = (compteur?.epoch ?? 0) + 1;
  if (compteur) await ctx.db.patch(compteur._id, { epoch });
  else await ctx.db.insert("payCacheEpochs", { projectId, epoch });
  await ctx.scheduler.runAfter(PAY_REFRESH_DELAY_MS, internal.dashboardCache.refreshPay, {
    projectId,
    epoch,
  });
}

/**
 * Les lignes de l'écran Paiements rangées par le dernier passage de paie, dans
 * l'ordre de l'écran, ou `null` (cache invalidé, parts incomplètes) — à
 * l'appelant de calculer en direct.
 */
export async function readPaymentRows(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<unknown[] | null> {
  const parts = await ctx.db
    .query("paymentRowsCache")
    .withIndex("by_project_part", (q) => q.eq("projectId", projectId))
    .collect();
  if (parts.length === 0) return null;
  if (parts.some((p, i) => p.part !== i || p.of !== parts.length)) return null;
  return parts.flatMap((p) => JSON.parse(p.json) as unknown[]);
}

/**
 * Range les parts SI aucune mutation d'argent n'est passée depuis la lecture
 * qui les a produites (`epoch` lu dans la même query que le calcul). Une part
 * identique n'est pas réécrite : l'écran ne se relance que si une ligne change.
 */
export const writePaymentRows = internalMutation({
  args: {
    projectId: v.id("projects"),
    parts: v.array(v.string()),
    epoch: v.number(),
  },
  handler: async (ctx, { projectId, parts, epoch }) => {
    if ((await readPayEpoch(ctx, projectId)) !== epoch) {
      return { changed: false, stale: true };
    }
    const existantes = await ctx.db
      .query("paymentRowsCache")
      .withIndex("by_project_part", (q) => q.eq("projectId", projectId))
      .collect();
    let changed = false;
    for (const [part, json] of parts.entries()) {
      const row = existantes.find((r) => r.part === part);
      if (row && row.json === json && row.of === parts.length) continue;
      changed = true;
      if (row) {
        await ctx.db.patch(row._id, { json, of: parts.length, changedAt: Date.now() });
      } else {
        await ctx.db.insert("paymentRowsCache", {
          projectId,
          part,
          of: parts.length,
          json,
          changedAt: Date.now(),
        });
      }
    }
    for (const row of existantes) {
      if (row.part >= parts.length) {
        changed = true;
        await ctx.db.delete(row._id);
      }
    }
    return { changed, stale: false };
  },
});

export const writeJson = internalMutation({
  args: {
    projectId: v.id("projects"),
    key: keyValidator,
    json: v.string(),
    /** Compteur lu avec le calcul (vues de la paie) : périmé ⇒ rien n'est rangé. */
    epoch: v.optional(v.number()),
  },
  handler: async (ctx, { projectId, key, json, epoch }) => {
    if (epoch !== undefined && (await readPayEpoch(ctx, projectId)) !== epoch) {
      return { changed: false };
    }
    return writeDashboardCacheIfChanged(ctx, projectId, key, json);
  },
});

export const listProjectIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"projects">[]> =>
    (await ctx.db.query("projects").collect()).map((p) => p._id),
});

export const payEpoch = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }): Promise<number> => readPayEpoch(ctx, projectId),
});

/**
 * Les vues de la PAIE d'un projet : total dû, classement du portail, lignes de
 * l'écran Paiements (un passage de paie), puis la carte Rentabilité lot par lot
 * (un lot = une query, cf le plafond d'une seconde de calcul).
 */
async function refreshPayViews(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  etape: (nom: string, f: () => Promise<void>) => Promise<void>,
  compter: (changed: boolean) => void,
): Promise<void> {
  // UN passage de paie pour le total dû, le classement du portail et les
  // lignes de l'écran : ils relisaient chacun tout le projet (cf payments).
  await etape("payroll", async () => {
    const paie = await ctx.runQuery(internal.payments.computePayrollCaches, {
      projectId,
    });
    compter(
      (
        await ctx.runMutation(internal.dashboardCache.writeJson, {
          projectId,
          key: "dueTotal",
          json: paie.dueTotalJson,
          epoch: paie.epoch,
        })
      ).changed,
    );
    compter(
      (
        await ctx.runMutation(internal.leaderboardCache.writeRows, {
          projectId,
          rows: paie.leaderboard,
        })
      ).changed,
    );
    compter(
      (
        await ctx.runMutation(internal.dashboardCache.writePaymentRows, {
          projectId,
          parts: paie.rowsParts,
          epoch: paie.epoch,
        })
      ).changed,
    );
  });
  // `null` = projet sans Whop : la carte se masque sans rien lire, il n'y a
  // rien à ranger.
  for (let lot = 0; lot < PROFIT_COSTS_LOTS; lot++) {
    await etape(`profitCosts:${lot}`, async () => {
      const r = await ctx.runQuery(internal.profitability.computeCostsJson, {
        projectId,
        lot,
        lots: PROFIT_COSTS_LOTS,
      });
      const key = profitCostsKey(lot, PROFIT_COSTS_LOTS);
      if (r === null || key === null) return;
      compter(
        (
          await ctx.runMutation(internal.dashboardCache.writeJson, {
            projectId,
            key,
            json: r.json,
            epoch: r.epoch,
          })
        ).changed,
      );
    });
  }
}

/**
 * Chaque étape à part : un calcul qui échoue (plafond de lecture, donnée
 * inattendue) ne prive pas les autres vues — ni les autres projets — de leur
 * rafraîchissement. L'échec reste visible : on échoue à la fin, avec la
 * première erreur.
 */
function etapesIsolees(source: string) {
  const echecs: unknown[] = [];
  const etape =
    (projectId: Id<"projects">) =>
    async (nom: string, f: () => Promise<void>) => {
      try {
        await f();
      } catch (e) {
        console.error(source, nom, projectId, e);
        echecs.push(e);
      }
    };
  const finir = () => {
    if (echecs.length > 0) throw echecs[0];
  };
  return { etape, finir };
}

/**
 * Cron : recalcule l'accueil admin de chaque projet, le classement du portail,
 * les lignes de l'écran Paiements et la carte Rentabilité.
 */
export const refreshAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ projects: number; changed: number }> => {
    const projectIds = await ctx.runQuery(
      internal.dashboardCache.listProjectIds,
      {},
    );
    let changed = 0;
    const compter = (c: boolean) => {
      if (c) changed += 1;
    };
    const { etape, finir } = etapesIsolees("dashboardCache.refreshAll");
    for (const projectId of projectIds) {
      await etape(projectId)("decisions", async () => {
        const json = await ctx.runQuery(
          internal.dashboardDecisions.computeDecisionsJson,
          { projectId },
        );
        compter(
          (
            await ctx.runMutation(internal.dashboardCache.writeJson, {
              projectId,
              key: "decisions",
              json,
            })
          ).changed,
        );
      });
      await refreshPayViews(ctx, projectId, etape(projectId), compter);
    }
    finir();
    return { projects: projectIds.length, changed };
  },
});

/**
 * Le recalcul planifié par une mutation d'argent (`invalidatePayCaches`). Ne
 * fait rien si une invalidation plus récente en a planifié un autre : un
 * paiement en masse ne recalcule qu'une fois, après le dernier cycle.
 */
export const refreshPay = internalAction({
  args: { projectId: v.id("projects"), epoch: v.number() },
  handler: async (ctx, { projectId, epoch }): Promise<{ skipped: boolean }> => {
    const actuel = await ctx.runQuery(internal.dashboardCache.payEpoch, { projectId });
    if (actuel !== epoch) return { skipped: true };
    const { etape, finir } = etapesIsolees("dashboardCache.refreshPay");
    await refreshPayViews(ctx, projectId, etape(projectId), () => undefined);
    finir();
    return { skipped: false };
  },
});
