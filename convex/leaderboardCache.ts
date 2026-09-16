import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { e2eMutation } from "./functions";
import { computeProjectLeaderboard } from "./payments";

/**
 * CLASSEMENT DU CYCLE PRÉ-CALCULÉ (table `leaderboardCache`).
 *
 * POURQUOI. Le classement du portail était recalculé à chaque lecture : tout le
 * projet relu (~2 MB), pour chaque créatrice (le cache Convex est par
 * identité), sur chaque page (monté dans le layout), et relancé chez toutes les
 * connectées à la moindre écriture sur une assignation. 45 % de la bande
 * passante base facturée le 2026-09-15.
 *
 * FRAÎCHEUR. Recalcul toutes les 10 minutes (convex/crons.ts). C'est ce qui
 * couvre TOUT ce qui fait bouger un montant sans avoir à l'énumérer : le relevé
 * de vues du soir, une publication confirmée, un barème modifié, un cycle qui
 * bascule avec l'heure. Le portail a donc jusqu'à 10 minutes de retard ; les
 * vues, elles, n'arrivent qu'une fois par nuit. Le classement ADMIN
 * (`payments.leaderboard`) reste calculé en direct — c'est lui que les écrans
 * de paie et les specs e2e comparent au centime.
 *
 * COÛT. Un calcul toutes les 10 minutes (~144/jour) au lieu d'un par
 * affichage, et AUCUNE écriture quand rien n'a changé : réécrire la row à
 * l'identique relancerait chez toutes les créatrices la query qu'on cherche à
 * ne plus relancer.
 *
 * CONCURRENCE. Le calcul tourne dans une QUERY appelée par une action, pas dans
 * une mutation : une mutation qui relit toutes les publications entrerait en
 * conflit (OCC) avec chaque commit du relevé du soir, et chaque nouvel essai
 * relirait les 2 MB. La mutation d'écriture ne lit que la row du cache.
 */

export type CachedLeaderboardRow = Doc<"leaderboardCache">["rows"][number];

const rowValidator = v.object({
  creatorId: v.id("creators"),
  name: v.string(),
  rank: v.number(),
  totalDue: v.number(),
  cycleStart: v.number(),
  cycleEnd: v.number(),
});

/** Deux classements identiques ligne à ligne (ordre compris). */
export function sameLeaderboardRows(
  a: readonly CachedLeaderboardRow[],
  b: readonly CachedLeaderboardRow[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) => {
    const o = b[i];
    return (
      r.creatorId === o.creatorId &&
      r.name === o.name &&
      r.rank === o.rank &&
      r.totalDue === o.totalDue &&
      r.cycleStart === o.cycleStart &&
      r.cycleEnd === o.cycleEnd
    );
  });
}

/** Écrit le classement SEULEMENT s'il diffère de celui en cache. */
async function writeIfChanged(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  rows: CachedLeaderboardRow[],
): Promise<{ changed: boolean }> {
  const existing = await ctx.db
    .query("leaderboardCache")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first();
  if (existing && sameLeaderboardRows(existing.rows, rows)) {
    return { changed: false };
  }
  if (existing) {
    await ctx.db.patch(existing._id, { rows, changedAt: Date.now() });
  } else {
    await ctx.db.insert("leaderboardCache", {
      projectId,
      rows,
      changedAt: Date.now(),
    });
  }
  return { changed: true };
}

/** Le classement tel que le cache le stocke (sans `isMe`, propre au lecteur). */
function toCachedRows(
  board: Awaited<ReturnType<typeof computeProjectLeaderboard>>,
): CachedLeaderboardRow[] {
  return board.map(({ creatorId, name, rank, totalDue, cycleStart, cycleEnd }) => ({
    creatorId,
    name,
    rank,
    totalDue,
    cycleStart,
    cycleEnd,
  }));
}

export const listProjectIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"projects">[]> =>
    (await ctx.db.query("projects").collect()).map((p) => p._id),
});

export const computeRows = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }): Promise<CachedLeaderboardRow[]> =>
    toCachedRows(await computeProjectLeaderboard(ctx, projectId, Date.now())),
});

export const writeRows = internalMutation({
  args: { projectId: v.id("projects"), rows: v.array(rowValidator) },
  handler: async (ctx, { projectId, rows }) =>
    writeIfChanged(ctx, projectId, rows),
});

/** Cron : recalcule le classement de chaque projet. */
export const refreshAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ projects: number; changed: number }> => {
    const projectIds = await ctx.runQuery(
      internal.leaderboardCache.listProjectIds,
      {},
    );
    let changed = 0;
    for (const projectId of projectIds) {
      const rows = await ctx.runQuery(internal.leaderboardCache.computeRows, {
        projectId,
      });
      const r = await ctx.runMutation(internal.leaderboardCache.writeRows, {
        projectId,
        rows,
      });
      if (r.changed) changed += 1;
    }
    return { projects: projectIds.length, changed };
  },
});

/**
 * E2E — recalcul immédiat, sans attendre le cron. En une mutation : pas de
 * relevé concurrent en test, la raison de passer par une action ne s'applique
 * pas.
 */
export const e2eRefreshLeaderboardCache = e2eMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) =>
    writeIfChanged(
      ctx,
      projectId,
      toCachedRows(await computeProjectLeaderboard(ctx, projectId, Date.now())),
    ),
});
