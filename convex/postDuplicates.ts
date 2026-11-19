/**
 * LIEN EN DOUBLE — le drapeau `duplicateOf` et ce qui le pose.
 *
 * Une publication marquée en double (sa vidéo est déjà celle d'une autre
 * publication du projet) est traitée comme `foreignOwner` :
 *   - le relevé n'écrit plus rien pour elle (`upsertApifySnapshot`, YouTube,
 *     relevé rapide) et les listes de relevé la sautent ;
 *   - ses relevés d'avant sont EFFACÉS : ce sont des copies de ceux de la
 *     publication gardée, les garder compterait la vidéo deux fois partout
 *     (Tracker, Rentabilité « Par jour », analytics par campagne, outils MCP) ;
 *   - elle ne paie plus : ni fixe, ni CPM, ni palier (`payFlagsOfPublication`).
 * Arbitrage du fondateur, 19/11/2026 : « lien à corriger, non payée ». Le geste
 * qui le lève est « Corriger le lien » (`retrackPublication`).
 *
 * Qui le pose :
 *   - la résolution d'un lien court TikTok (`postUrlResolution.patchPostUrl`),
 *     quand la vidéo résolue est déjà rattachée — le filet de la garde de saisie,
 *     qui ne connaît la vidéo d'un lien court que si l'écran l'a résolu avant ;
 *   - l'outil MCP `marquer_doublons` (journalisé), pour les doublons d'avant la
 *     garde.
 */

import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { e2eMutation } from "./functions";
import { recomputeLatestMetrics } from "./metricSnapshots";
import { purgeMeasurements } from "./publications";
import { syncBonusForPublication } from "./pricing";
import { DUPLICATE_LINK_REASON, storedPostKey } from "./postDuplicateGuard";

/**
 * Marque `pub` en double de `keeperId` : efface ses relevés, vide ses chiffres
 * « latest », pose le drapeau et le motif affiché, resynchronise les paliers.
 * Rend les documents effacés (le journal MCP les garde en entier).
 */
export async function markDuplicate(
  ctx: MutationCtx,
  pub: Doc<"publications">,
  keeperId: Id<"publications">,
  now: number,
): Promise<{ snapshots: Doc<"metricSnapshots">[]; earlyReadings: Doc<"earlyReadings">[] }> {
  const purged = await purgeMeasurements(ctx, pub._id);
  await ctx.db.patch(pub._id, {
    duplicateOf: { publicationId: keeperId, at: now },
    // Le motif dit à l'écran POURQUOI ce post n'a pas de chiffre, par le même
    // canal que « lien d'un autre compte » : statut de collecte « en échec ».
    lastCollectFailureAt: now,
    collectFailureStreak: Math.max(1, pub.collectFailureStreak ?? 0),
    lastCollectFailureReason: DUPLICATE_LINK_REASON,
  });
  await recomputeLatestMetrics(ctx, pub._id);
  // Le cumul de paliers de la créatrice vient de perdre ces vues.
  await syncBonusForPublication(ctx, pub._id);
  return purged;
}

// ─── Clé de post des publications d'avant la clé ──────────────────────────────

/** Publications traitées par passage : borne d'écriture d'une mutation. */
const BACKFILL_BATCH = 200;

/**
 * Remplit `postKey` des publications qui n'en ont pas (écrites avant la clé, ou
 * par un chemin qui l'oublierait). Idempotente et bornée : lit au plus
 * BACKFILL_BATCH lignes sans clé par passage, via l'index (`postKey` absent), et
 * se replanifie tant qu'il en reste. Planifiée par cron (convex/crons.ts) : sans
 * clé, une publication échappe à la garde de saisie.
 *
 * N'écrit QUE la clé, dérivée du lien : aucun chiffre, aucun montant, aucun
 * drapeau. Un doublon trouvé ici n'est PAS marqué — c'est l'outil MCP
 * `marquer_doublons` qui le fait, journalisé.
 */
export const backfillPostKeys = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ written: number }> => {
    const written = await backfillPostKeysBatch(ctx);
    // Lot plein : il en reste peut-être — on enchaîne sans attendre le cron.
    if (written >= BACKFILL_BATCH) {
      await ctx.scheduler.runAfter(0, internal.postDuplicates.backfillPostKeys, {});
    }
    return { written };
  },
});

/** E2E — un passage de la tâche de rattrapage, à la demande. */
export const e2eBackfillPostKeys = e2eMutation({
  args: {},
  handler: async (ctx): Promise<{ written: number }> => ({ written: await backfillPostKeysBatch(ctx) }),
});

/**
 * E2E — une publication D'AVANT la garde : son lien posé tel quel, sans clé ni
 * contrôle, comme les 48 doublons constatés le 19/11/2026. Seul moyen de
 * reproduire un doublon que la garde empêche désormais de créer.
 */
export const e2eLegacyPostUrl = e2eMutation({
  args: { publicationId: v.id("publications"), url: v.string() },
  handler: async (ctx, { publicationId, url }): Promise<null> => {
    await ctx.db.patch(publicationId, { postUrl: url, postKey: undefined });
    return null;
  },
});

async function backfillPostKeysBatch(ctx: MutationCtx): Promise<number> {
  const projects = await ctx.db.query("projects").collect();
  let written = 0;
  for (const project of projects) {
    const rows = await ctx.db
      .query("publications")
      .withIndex("by_project_postKey", (q) =>
        q.eq("projectId", project._id).eq("postKey", undefined),
      )
      .take(BACKFILL_BATCH - written);
    for (const p of rows) {
      await ctx.db.patch(p._id, { postKey: storedPostKey(p.postUrl) });
      written += 1;
    }
    if (written >= BACKFILL_BATCH) break;
  }
  return written;
}
