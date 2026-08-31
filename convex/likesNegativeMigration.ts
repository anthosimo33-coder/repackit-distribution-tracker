import { internalMutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { recomputeLatestMetrics } from "./metricSnapshots";

/**
 * MIGRATION PONCTUELLE — effacer les likes NÉGATIFS laissés en base par l'actor
 * Instagram, sur UN projet nommé.
 *
 * POURQUOI. `likesCount: -1` est le code que renvoie l'actor Instagram quand le
 * compte masque son nombre de likes. Il était stocké tel quel : la ligne
 * affichait « -1 like », la somme des likes du projet était minorée d'autant, et
 * le taux d'engagement — (likes + commentaires) / vues — devenait NÉGATIF sur
 * les posts sans commentaire. Le correctif de collecte (`toCount` rejette
 * désormais tout négatif, cf lib/apifyPosts.ts et ses deux répliques A6) empêche
 * d'en écrire de nouveaux ; il ne touche PAS le stock déjà écrit.
 *
 * ⚠️ ORDRE IMPOSÉ — LE CORRECTIF DE COLLECTE D'ABORD, CE BACKFILL ENSUITE.
 * Le relevé nocturne écrit `args.likes ?? pub.likesLatest ?? 0`
 * (cf convex/apifySync.ts) : la règle « ne jamais écraser un like connu par 0 »
 * se retourne contre nous ici. Backfillé AVANT le déploiement du correctif, le
 * run de 23h30 relit la valeur brute de l'actor et réinscrit -1. Backfillé
 * APRÈS, l'actor rend `null`, la publication porte 0, et `null ?? 0 ?? 0` vaut
 * 0 : la valeur est stable relevé après relevé.
 *
 * CE QUE ÇA VAUT, ET CE QUE ÇA NE VAUT PAS. `0` n'est pas la vérité — les likes
 * existent, la plateforme les masque. L'aval n'a aucun canal « non collecté »
 * pour les likes (`metricSnapshots.likes` est requis, contrairement à `saves`
 * qui a `savesAvailability`). Le choix assumé est donc de remplacer un
 * faux-négatif par un faux-zéro, pas de rétablir une mesure. Conséquence à
 * connaître : convex/decisions.ts et convex/graduation.ts calculent un likeRate
 * depuis ce champ — ces posts échoueront désormais le seuil comme s'ils avaient
 * été MESURÉS à zéro, là où le code tient soigneusement « non mesuré ≠
 * satisfait » pour les saves. Construire le canal d'absence des likes est un
 * chantier séparé.
 *
 * CE QUI N'EST JAMAIS TOUCHÉ. Un seul champ est écrit : `metricSnapshots.likes`,
 * et seulement sur les lignes strictement négatives. Vues, commentaires, saves,
 * subsGained, dates, source : intacts. `publications.likesLatest` n'est PAS
 * patché à la main — il est REDÉRIVÉ par `recomputeLatestMetrics`, la fonction
 * de dénormalisation de la prod, pour qu'aucune seconde vérité ne soit écrite
 * ici. Aucune suppression : les snapshots sont corrigés en place.
 *
 * SÛRETÉ :
 *   1. `slug` obligatoire — le périmètre est nommé, jamais deviné ni global ;
 *   2. `expectedSnapshots` / `expectedPublications` vérifiés AVANT le premier
 *      write, dry-run compris ;
 *   3. seules les valeurs `< 0` sont touchées — un 0 légitime est invisible ;
 *   4. DRY-RUN PAR DÉFAUT : sans `commit: true`, aucune écriture.
 *
 * IDEMPOTENCE : relancer après coup ne trouve plus de négatif et ne fait rien.
 *
 *   ./scripts/convex-prod.sh run likesNegativeMigration:clearNegativeLikes \
 *     '{"slug":"snytch","expectedSnapshots":554,"expectedPublications":63}'
 *   ./scripts/convex-prod.sh run likesNegativeMigration:clearNegativeLikes \
 *     '{"slug":"snytch","expectedSnapshots":554,"expectedPublications":63,"commit":true}'
 */
export const clearNegativeLikes = internalMutation({
  args: {
    /** Slug du projet ciblé — explicite, jamais deviné. */
    slug: v.string(),
    /** false/absent = dry-run (lecture seule). true = écriture. */
    commit: v.optional(v.boolean()),
    /** Snapshots négatifs attendus. Vérifié AVANT toute écriture. */
    expectedSnapshots: v.optional(v.number()),
    /** Publications dont le `likesLatest` est attendu négatif. Idem. */
    expectedPublications: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { slug, commit = false, expectedSnapshots, expectedPublications },
  ) => {
    const project = (await ctx.db.query("projects").collect()).find(
      (p) => p.slug === slug,
    );
    if (!project) throw new ConvexError(`Projet introuvable : ${slug}`);

    // `metricSnapshots` porte `projectId` et son index : le périmètre est lu
    // directement, sans passer par les publications ni scanner les autres
    // projets.
    const snapshots = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const negatives = snapshots.filter((s) => s.likes < 0);

    // Publications à redénormaliser : celles qui portent au moins un snapshot
    // corrigé. Le `likesLatest` négatif est le SYMPTÔME ; on repart des lignes
    // réellement touchées plutôt que de la valeur dénormalisée.
    const touchedPubIds = [...new Set(negatives.map((s) => s.publicationId))];
    const pubs = new Map<Id<"publications">, Doc<"publications">>();
    for (const id of touchedPubIds) {
      const p = await ctx.db.get(id);
      if (p) pubs.set(id, p);
    }
    const negativeLatest = [...pubs.values()].filter(
      (p) => (p.likesLatest ?? 0) < 0,
    );

    // Garde-fou de volume — AVANT le premier write, dry-run compris (un dry-run
    // qui ne cadre pas doit s'arrêter aussi fort qu'une écriture).
    if (
      expectedSnapshots !== undefined &&
      negatives.length !== expectedSnapshots
    ) {
      throw new ConvexError(
        `Volume inattendu : ${negatives.length} snapshot(s) négatif(s) pour ${expectedSnapshots} attendu(s) ` +
          `sur ${snapshots.length} scanné(s). Rien n'a été écrit — vérifie le périmètre avant de relancer.`,
      );
    }
    if (
      expectedPublications !== undefined &&
      negativeLatest.length !== expectedPublications
    ) {
      throw new ConvexError(
        `Volume inattendu : ${negativeLatest.length} publication(s) à likesLatest négatif pour ` +
          `${expectedPublications} attendue(s). Rien n'a été écrit — vérifie le périmètre avant de relancer.`,
      );
    }

    // Ce que la correction ajoute aux totaux : la somme des négatifs, en valeur
    // absolue. Calculé avant/après sur les MÊMES lignes, pour que le rapport
    // porte le contrôle plutôt que de le laisser à un script externe.
    const likesBefore = snapshots.reduce((s, m) => s + m.likes, 0);
    const likesAfter = snapshots.reduce((s, m) => s + Math.max(m.likes, 0), 0);

    const rows = negatives.map((s) => ({
      snapshotId: s._id as string,
      publicationId: s.publicationId as string,
      source: s.source,
      capturedAt: s.capturedAt,
      from: s.likes,
      to: 0,
    }));

    let updatedSnapshots = 0;
    let recomputedPublications = 0;
    if (commit) {
      for (const s of negatives) {
        // SEUL champ patché, et seulement parce qu'il est strictement négatif.
        await ctx.db.patch(s._id, { likes: 0 });
        updatedSnapshots++;
      }
      // Dénormalisation par la fonction de PROD — `likesLatest` n'est jamais
      // écrit à la main ici. Les publications dont le latest n'était pas la
      // ligne négative retombent naturellement sur leur vraie valeur.
      for (const id of touchedPubIds) {
        if (!pubs.has(id)) continue;
        await recomputeLatestMetrics(ctx, id);
        recomputedPublications++;
      }
      console.log(
        `[likes-neg] projet ${slug} : ${updatedSnapshots} snapshot(s) remis à 0, ` +
          `${recomputedPublications} publication(s) redénormalisée(s). ` +
          `Somme des likes ${likesBefore} → ${likesAfter}.`,
      );
    }

    return {
      dryRun: !commit,
      project: slug,
      scannedSnapshots: snapshots.length,
      negativeSnapshots: negatives.length,
      touchedPublications: touchedPubIds.length,
      negativeLatestPublications: negativeLatest.length,
      likesSumBefore: likesBefore,
      likesSumAfter: likesAfter,
      delta: likesAfter - likesBefore,
      updatedSnapshots,
      recomputedPublications,
      // Échantillon : le rapport doit tenir dans une réponse lisible.
      sample: rows.slice(0, 20),
    };
  },
});
