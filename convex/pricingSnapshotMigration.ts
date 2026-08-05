import { internalMutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { buildPricingSnapshot, type PricingSnapshot } from "./pricing";
import type { MutationCtx } from "./_generated/server";

/**
 * MIGRATION PONCTUELLE — re-tamponner `pricingSnapshot` sur les assignations
 * NON PUBLIÉES d'un projet, depuis le barème VIVANT que la ligne porte déjà.
 *
 * POURQUOI. Le snapshot est figé à l'attribution (cf convex/pricing.ts
 * buildPricingSnapshot) : éditer un pricing n'affecte que les futures
 * attributions. Après un changement de barème assumé côté admin, les vidéos
 * DÉJÀ TOURNÉES mais pas encore publiées doivent basculer sur le nouveau tarif.
 * On ne peut pas les supprimer/réassigner : la réassignation réassemble le
 * script et rejoue l'anti-coordination, or la vidéo est déjà produite sur le
 * texte actuel — un script qui change après tournage rend la vidéo inutilisable.
 * D'où ce re-tamponnage CHIRURGICAL : `pricingSnapshot` et RIEN d'autre.
 *
 * CE QUI N'EST JAMAIS TOUCHÉ. Script/scriptCombo/comboKey, statut, cibles,
 * postDate, échéance, instructions, assetFolderIds, modelVideos : le patch ne
 * porte que sur `pricingSnapshot`. Le moteur de paie, le warmup, le modèle de
 * période et les statuts ne sont pas modifiés — la migration ne fait que
 * remplacer une valeur figée par sa valeur vivante.
 *
 * SÛRETÉ (quatre verrous cumulés) :
 *   1. statuts éligibles limités à `todo` / `to_publish` — `published` et `paid`
 *      sont hors périmètre par construction (elles gardent le tarif annoncé) ;
 *   2. toute ligne portant déjà une publication matérialisée est écartée, même
 *      si son statut n'a pas suivi (ceinture : le statut n'est pas la vérité) ;
 *   3. toute ligne référencée par un paiement `paid` est écartée (cycle payé) ;
 *   4. `expected` — le volume attendu, vérifié AVANT le moindre write.
 *
 * DRY-RUN PAR DÉFAUT : sans `commit: true`, aucune écriture. Le rapport est
 * identique dans les deux modes, seul `updated` change.
 *
 * IDEMPOTENCE : une ligne dont le snapshot vaut déjà le barème vivant est
 * comptée dans `alreadyUpToDate` et n'est pas réécrite. Relancer ne fait rien.
 *
 *   npx convex run pricingSnapshotMigration:restampPricingSnapshots \
 *     '{"slug":"snytch","expected":26}' --prod                    # dry-run
 *   npx convex run pricingSnapshotMigration:restampPricingSnapshots \
 *     '{"slug":"snytch","expected":26,"commit":true}' --prod      # écriture
 */

/** Statuts re-tamponnables : pré-publication, aucun tarif encore annoncé au réel. */
const RESTAMPABLE_STATUSES = new Set<string>(["todo", "to_publish"]);

/** Les 5 champs du snapshot, comparés à l'identique (idempotence). */
function sameSnapshot(a: PricingSnapshot, b: PricingSnapshot): boolean {
  return (
    a.pricingId === b.pricingId &&
    a.montantFixe === b.montantFixe &&
    a.nbVideosCible === b.nbVideosCible &&
    a.tauxCPM === b.tauxCPM &&
    a.seuilBonusVues === b.seuilBonusVues &&
    a.montantBonus === b.montantBonus
  );
}

/** Forme courte lisible dans le rapport et les logs. */
function brief(s: PricingSnapshot): string {
  return `fixe ${s.montantFixe}$/${s.nbVideosCible} vidéos · CPM ${s.tauxCPM}`;
}

/** La ligne porte-t-elle déjà une publication (URL, date ou publication liée) ? */
function hasMaterializedPublication(a: Doc<"assignments">): boolean {
  return (a.targets ?? []).some(
    (t) =>
      t.publicationId !== undefined ||
      t.publishedAt !== undefined ||
      t.publishedUrl !== undefined,
  );
}

/** assignmentIds référencés par un paiement DÉJÀ PAYÉ (cycle gelé, intouchable). */
async function paidAssignmentIds(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<Set<string>> {
  const payments = await ctx.db.query("payments").collect();
  const out = new Set<string>();
  for (const p of payments) {
    if (p.projectId !== projectId || p.status !== "paid") continue;
    for (const li of p.lineItems) {
      if (li.assignmentId !== undefined) out.add(li.assignmentId);
    }
  }
  return out;
}

export const restampPricingSnapshots = internalMutation({
  args: {
    /** Slug du projet ciblé — explicite, jamais deviné. */
    slug: v.string(),
    /** false/absent = dry-run (lecture seule). true = écriture. */
    commit: v.optional(v.boolean()),
    /**
     * Volume attendu. Fourni, il est vérifié AVANT toute écriture : un écart
     * arrête la migration au lieu de toucher un périmètre non validé.
     */
    expected: v.optional(v.number()),
  },
  handler: async (ctx, { slug, commit = false, expected }) => {
    const project = (await ctx.db.query("projects").collect()).find(
      (p) => p.slug === slug,
    );
    if (!project) throw new ConvexError(`Projet introuvable : ${slug}`);

    const assignments = (
      await ctx.db
        .query("assignments")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect()
    ).sort((a, b) => a.createdAt - b.createdAt);

    const paidIds = await paidAssignmentIds(ctx, project._id);
    const creators = new Map(
      (await ctx.db.query("creators").collect()).map((c) => [c._id, c] as const),
    );
    const nameOf = (a: Doc<"assignments">): string =>
      creators.get(a.creatorId)?.name ?? a.creatorNameSnapshot ?? "(supprimée)";

    type Row = {
      assignmentId: string;
      creator: string;
      status: string;
      from: string;
      to: string;
    };
    const toUpdate: { doc: Doc<"assignments">; next: PricingSnapshot; row: Row }[] =
      [];
    const alreadyUpToDate: Row[] = [];
    const skipped: { assignmentId: string; status: string; reason: string }[] = [];
    const byStatus: Record<string, number> = {};

    for (const a of assignments) {
      if (!RESTAMPABLE_STATUSES.has(a.status)) {
        skipped.push({
          assignmentId: a._id,
          status: a.status,
          reason: "statut hors périmètre (garde le tarif annoncé)",
        });
        continue;
      }
      if (a.pricingSnapshot === undefined) {
        skipped.push({
          assignmentId: a._id,
          status: a.status,
          reason: "aucun pricingSnapshot (ligne legacy, autre modèle de paie)",
        });
        continue;
      }
      if (hasMaterializedPublication(a)) {
        skipped.push({
          assignmentId: a._id,
          status: a.status,
          reason: "publication déjà matérialisée malgré le statut",
        });
        continue;
      }
      if (paidIds.has(a._id)) {
        skipped.push({
          assignmentId: a._id,
          status: a.status,
          reason: "référencée par un paiement déjà payé",
        });
        continue;
      }
      // Barème VIVANT du pricing que la ligne porte déjà — même helper que
      // l'attribution, aucune logique dupliquée. Il refuse un pricing archivé
      // ou hors projet : on l'écarte proprement au lieu d'abandonner le lot.
      let next: PricingSnapshot;
      try {
        next = await buildPricingSnapshot(
          ctx,
          project._id,
          a.pricingSnapshot.pricingId,
        );
      } catch (e) {
        skipped.push({
          assignmentId: a._id,
          status: a.status,
          reason: `barème illisible : ${e instanceof ConvexError ? String(e.data) : String(e)}`,
        });
        continue;
      }
      const row: Row = {
        assignmentId: a._id,
        creator: nameOf(a),
        status: a.status,
        from: brief(a.pricingSnapshot),
        to: brief(next),
      };
      if (sameSnapshot(a.pricingSnapshot, next)) {
        alreadyUpToDate.push(row);
        continue;
      }
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      toUpdate.push({ doc: a, next, row });
    }

    // Garde-fou de volume — AVANT le premier write, dry-run compris (un dry-run
    // qui ne cadre pas doit s'arrêter aussi fort qu'une écriture).
    if (expected !== undefined && toUpdate.length !== expected) {
      throw new ConvexError(
        `Volume inattendu : ${toUpdate.length} ligne(s) à re-tamponner pour ${expected} attendue(s). ` +
          `Répartition ${JSON.stringify(byStatus)}, déjà à jour ${alreadyUpToDate.length}. ` +
          `Rien n'a été écrit — vérifie le périmètre avant de relancer.`,
      );
    }

    let updated = 0;
    if (commit) {
      for (const { doc, next, row } of toUpdate) {
        // SEUL champ patché. Tout le reste de la ligne est laissé intact.
        await ctx.db.patch(doc._id, { pricingSnapshot: next });
        updated++;
        console.log(
          `[restamp] ${doc._id} | ${row.creator} | ${row.status} | ${row.from} → ${row.to}`,
        );
      }
      console.log(
        `[restamp] projet ${slug} : ${updated} snapshot(s) re-tamponné(s), ${alreadyUpToDate.length} déjà à jour, ${skipped.length} hors périmètre.`,
      );
    }

    return {
      dryRun: !commit,
      project: slug,
      scanned: assignments.length,
      eligible: toUpdate.length,
      byStatus,
      updated,
      alreadyUpToDate: alreadyUpToDate.length,
      skippedCount: skipped.length,
      // LISTE, pas un objet indexé par motif : un nom de champ Convex n'accepte
      // que de l'ASCII, et les motifs sont rédigés en français (accentués).
      skippedByReason: [
        ...skipped
          .reduce((acc, s) => acc.set(s.reason, (acc.get(s.reason) ?? 0) + 1), new Map<string, number>())
          .entries(),
      ].map(([reason, count]) => ({ reason, count })),
      rows: toUpdate.map((u) => u.row),
    };
  },
});
