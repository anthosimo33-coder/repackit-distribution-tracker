import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assertE2eSecret } from "./functions";
import {
  newOwnerLookupCache,
  publicationOwnerAssignment,
  syncBonusUnlocks,
} from "./pricing";

/**
 * PALIERS APRÈS UN RELEVÉ EN MASSE — une synchro par créatrice, pas par post.
 *
 * Chaque relevé unitaire rejouait `syncBonusUnlocks`, qui recalcule le cumul À
 * VIE de la créatrice : toutes ses assignations, toutes leurs publications, le
 * relevé de fin de fenêtre de chacune. Mesuré en prod le 2026-10-06 (relevé
 * manuel de 09:14 UTC) : pour la créatrice aux 273 assignations, ~1 240
 * documents et ~1,45 MB lus À CHACUN de ses ~440 posts — 232 appels sur 453,
 * 336 MB et ~5 min d'écritures pour un seul passage. Le coût était
 * quadratique : n posts × un cumul en O(n).
 *
 * Le relevé en masse écrit donc ses snapshots avec `differerBonus: true`, puis
 * appelle `syncBonusAfterReleves` UNE fois en fin de passage (relevé manuel) ou
 * de lot (relevé de nuit) : les propriétaires des publications sont résolus en
 * une lecture partagée, puis chaque créatrice est synchronisée une fois.
 *
 * MÊMES MONTANTS. `syncBonusUnlocks` est idempotent et ne lit que l'état
 * courant : le rejouer une fois après le dernier post d'une créatrice rend ce
 * que rendait le rejeu après chacun. Ce qui change est le MOMENT où une ligne
 * d'unlock apparaît (fin du passage au lieu du post qui franchit le seuil), et
 * jamais ce qui est payé : le gel d'un paiement (`markPaymentPaid`,
 * `markPeriodPaid`, `markCyclePaid`) rejoue lui-même `syncBonusUnlocks` juste
 * avant de figer, et l'affichage des paliers lit le cumul en direct.
 */

/** Ids par requête : borne la lecture (publication + résolution) d'un appel. */
const OWNERS_CHUNK = 400;

/**
 * Créatrices PROPRIÉTAIRES d'un ensemble de publications, sans doublon — la
 * même résolution que la synchro unitaire (`publicationOwnerAssignment`), avec
 * ses lectures partagées entre les publications de l'appel.
 */
export const bonusOwnersOfPublications = internalQuery({
  args: { publicationIds: v.array(v.id("publications")) },
  handler: async (
    ctx,
    { publicationIds },
  ): Promise<{ projectId: Id<"projects">; creatorId: Id<"creators"> }[]> => {
    const cache = newOwnerLookupCache();
    const owners = new Map<
      string,
      { projectId: Id<"projects">; creatorId: Id<"creators"> }
    >();
    for (const id of new Set(publicationIds)) {
      const pub = await ctx.db.get(id);
      if (!pub) continue;
      const a = await publicationOwnerAssignment(ctx, pub, cache);
      if (!a) continue;
      // `pub.projectId`, comme `syncBonusForPublication` : c'est le projet dont
      // la grille et les paiements s'appliquent.
      owners.set(`${pub.projectId}|${a.creatorId}`, {
        projectId: pub.projectId,
        creatorId: a.creatorId,
      });
    }
    return [...owners.values()];
  },
});

/** `syncBonusUnlocks` pour UNE créatrice — une transaction par créatrice. */
export const syncBonusForCreator = internalMutation({
  args: { projectId: v.id("projects"), creatorId: v.id("creators") },
  handler: async (
    ctx,
    { projectId, creatorId },
  ): Promise<{ unlocked: number; revoked: number }> =>
    syncBonusUnlocks(ctx, projectId, creatorId),
});

export interface BonusAfterRelevesSummary {
  creatrices: number;
  unlocked: number;
  revoked: number;
  /** Créatrices dont la synchro a levé — journalisées, rattrapées au passage suivant. */
  echecs: number;
}

/**
 * Synchro des paliers des propriétaires de `publicationIds`, une fois chacune.
 *
 * L'appelant passe les publications qu'il a TENTÉ de relever, pas seulement
 * celles qui ont abouti : la liste est connue avant la première écriture, donc
 * un lot interrompu à mi-chemin synchronise quand même ce qu'il a écrit.
 * Synchroniser une créatrice dont rien n'a bougé ne coûte qu'une lecture.
 *
 * Ne lève JAMAIS : une créatrice en échec est journalisée et les autres
 * passent — un relevé ne doit pas tomber pour un palier.
 */
export async function syncBonusAfterReleves(
  ctx: ActionCtx,
  publicationIds: readonly Id<"publications">[],
): Promise<BonusAfterRelevesSummary> {
  const out: BonusAfterRelevesSummary = {
    creatrices: 0,
    unlocked: 0,
    revoked: 0,
    echecs: 0,
  };
  const ids = [...new Set(publicationIds)];
  const owners = new Map<
    string,
    { projectId: Id<"projects">; creatorId: Id<"creators"> }
  >();
  for (let i = 0; i < ids.length; i += OWNERS_CHUNK) {
    try {
      const part: { projectId: Id<"projects">; creatorId: Id<"creators"> }[] =
        await ctx.runQuery(internal.bonusSync.bonusOwnersOfPublications, {
          publicationIds: ids.slice(i, i + OWNERS_CHUNK),
        });
      for (const o of part) owners.set(`${o.projectId}|${o.creatorId}`, o);
    } catch (e) {
      out.echecs += 1;
      console.error("[bonus-sync] résolution des propriétaires en échec :", e);
    }
  }
  for (const o of owners.values()) {
    try {
      const r: { unlocked: number; revoked: number } = await ctx.runMutation(
        internal.bonusSync.syncBonusForCreator,
        o,
      );
      out.creatrices += 1;
      out.unlocked += r.unlocked;
      out.revoked += r.revoked;
    } catch (e) {
      out.echecs += 1;
      console.error(`[bonus-sync] créatrice ${o.creatorId} en échec :`, e);
    }
  }
  return out;
}

/**
 * Test e2e — la synchro de fin de relevé, par le VRAI chemin (requête puis une
 * mutation par créatrice). Gated par le secret e2e, comme les e2eMutation.
 */
export const e2eSyncBonusAfterReleves = action({
  args: {
    secret: v.string(),
    publicationIds: v.array(v.id("publications")),
  },
  handler: async (
    ctx,
    { secret, publicationIds },
  ): Promise<BonusAfterRelevesSummary> => {
    assertE2eSecret(secret);
    return syncBonusAfterReleves(ctx, publicationIds);
  },
});
