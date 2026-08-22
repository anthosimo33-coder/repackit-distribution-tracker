import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { e2eMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  computeQuadrant,
  type QuadrantInput,
  type QuadrantResult,
  type QuadrantSnapshot,
} from "./quadrant";

/**
 * RECALCUL NOCTURNE du quadrant « Vues × Intent ».
 *
 * Branché en FIN de chaîne du relevé de vues (`finishNightlyRun`) : le
 * classement se rafraîchit exactement quand les vues et les saves qu'il lit
 * viennent d'être rafraîchies. C'est le point : un classement recalculé à un
 * autre moment ne serait pas « plus frais », il serait calculé sur les mêmes
 * chiffres avec un horodatage trompeur.
 *
 * Le CALCUL n'est pas ici — il vit dans le module pur `convex/quadrant.ts`,
 * importé à l'identique par la carte du tracker. Ce fichier ne fait que trois
 * choses : lire, appeler le module, écrire.
 *
 * IDEMPOTENT : rejouer un run sur des données inchangées réécrit les mêmes
 * valeurs. Utilisable à la main pour peupler un déploiement sans attendre la
 * nuit :  `npx convex run quadrantSync:runQuadrantRecompute '{}'`
 *
 * ⚠️ N'ÉCRIT QUE le champ `publications.quadrant`. Aucune autre valeur de la
 * publication n'est touchée — ni les métriques, ni `isWarmup`, ni `remunere`,
 * donc ni la paie, ni la graduation LAB, ni le moteur de décision.
 */

/**
 * Publications patchées par transaction. Le calcul, lui, lit TOUJOURS l'ensemble
 * des posts du projet (une médiane de compte ne se calcule pas sur une tranche) ;
 * seule l'ÉCRITURE est découpée, pour rester loin des limites d'une mutation
 * Convex sur un projet volumineux. L'action enchaîne les tranches.
 */
const PATCH_CHUNK = 400;

/** Garde-fou de boucle : au-delà, on log et on s'arrête plutôt que de tourner. */
const MAX_CHUNKS = 50;

/** Un post est « publié » dès qu'il porte une URL (cf lib/publication-status). */
function isPublished(p: Doc<"publications">): boolean {
  return typeof p.postUrl === "string" && p.postUrl.length > 0;
}

/**
 * Forme STOCKÉE d'un résultat. Les champs absents sont OMIS et non posés à
 * `null` : le validateur du schéma les déclare optionnels, et un `null` explicite
 * ferait passer « pas de référence » pour une valeur mesurée.
 */
function toStored(r: QuadrantResult, computedAt: number): QuadrantSnapshot {
  return {
    computedAt,
    status: r.status,
    ...(r.reason !== null ? { reason: r.reason } : {}),
    ...(r.baselineViews !== null ? { baselineViews: r.baselineViews } : {}),
    baselineSample: r.baselineSample,
    ...(r.scoreDistribution !== null
      ? { scoreDistribution: r.scoreDistribution }
      : {}),
    ...(r.scoreIntent !== null ? { scoreIntent: r.scoreIntent } : {}),
    ...(r.quadrant !== null ? { key: r.quadrant } : {}),
    breakoutWindow: r.breakoutWindow,
  };
}

/** Projets à recalculer. Tous : un projet sans post publié coûte un collect vide. */
export const listProjectIds = internalQuery({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }): Promise<Id<"projects">[]> => {
    if (projectId) {
      const p = await ctx.db.get(projectId);
      return p ? [p._id] : [];
    }
    return (await ctx.db.query("projects").collect()).map((p) => p._id);
  },
});

/**
 * Recalcule le projet et écrit UNE TRANCHE de ses publications publiées.
 *
 * `offset` porte sur la liste triée par `_id` — un ordre stable et indépendant
 * des données, donc une tranche qui ne se déplace pas entre deux appels si une
 * métrique bouge au même moment.
 *
 * Les posts NON publiés qui traînent un classement (URL retirée après coup) sont
 * nettoyés : garder un quadrant sur un post dépublié le ferait réapparaître dans
 * une lecture ultérieure.
 *
 * Fonction NUE partagée par le chemin nocturne et le déclencheur e2e : les deux
 * doivent exercer le même code, sans quoi le test ne prouverait rien du recalcul
 * réel.
 */
async function recomputeChunk(
  ctx: MutationCtx,
  {
    projectId,
    offset,
    now,
  }: { projectId: Id<"projects">; offset: number; now: number },
): Promise<{ total: number; patched: number; next: number | null }> {
  const all = await ctx.db
    .query("publications")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();

  const published = all
    .filter(isPublished)
    .sort((a, b) => (a._id as string).localeCompare(b._id as string));

  const inputs: QuadrantInput[] = published.map((p) => ({
    id: p._id as string,
    compte: p.compte,
    plateforme: p.plateforme,
    datePubli: p.datePubli,
    // `?? null` et jamais `?? 0` : une absence de relevé n'est pas une mesure à
    // zéro, et la médiane du compte se calcule sur les mesures seulement.
    vues: p.vuesLatest ?? null,
    saves: p.savesLatest ?? null,
    isWarmup: p.isWarmup,
  }));

  const results = computeQuadrant(inputs, now);
  const byId = new Map(results.map((r) => [r.id, r]));

  let patched = 0;
  if (offset === 0) {
    for (const p of all) {
      if (!isPublished(p) && p.quadrant !== undefined) {
        await ctx.db.patch(p._id, { quadrant: undefined });
        patched += 1;
      }
    }
  }

  const slice = published.slice(offset, offset + PATCH_CHUNK);
  for (const p of slice) {
    const r = byId.get(p._id as string);
    if (!r) continue;
    await ctx.db.patch(p._id, { quadrant: toStored(r, now) });
    patched += 1;
  }

  const consumed = offset + slice.length;
  return {
    total: published.length,
    patched,
    next: consumed < published.length ? consumed : null,
  };
}

/** La tranche nocturne. Enchaînée par `runQuadrantRecompute`. */
export const recomputeProjectQuadrantsChunk = internalMutation({
  args: {
    projectId: v.id("projects"),
    offset: v.number(),
    now: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ total: number; patched: number; next: number | null }> =>
    recomputeChunk(ctx, args),
});

/**
 * Déclencheur e2e — MÊME chemin de code que la nuit (`recomputeChunk`), jamais
 * une réplique : un test qui exercerait une seconde implémentation ne prouverait
 * rien du recalcul réel.
 *
 * `now` est fourni par la spec pour ancrer les fenêtres de 48 h et de 14 jours
 * sur une horloge choisie plutôt que sur celle du runner. Gate `e2eMutation` :
 * refusée d'office sur un déploiement sans E2E_SECRET, donc en prod.
 */
export const e2eRecomputeQuadrant = e2eMutation({
  args: {
    projectId: v.id("projects"),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { projectId, now },
  ): Promise<{ total: number; patched: number; next: number | null }> =>
    recomputeChunk(ctx, { projectId, offset: 0, now: now ?? Date.now() }),
});

export type QuadrantRecomputeSummary = {
  projects: number;
  posts: number;
  patched: number;
};

/**
 * Recalcule TOUS les projets (ou un seul si `projectId` est fourni).
 *
 * Annoté explicitement (TS7022) : l'action appelle `ctx.runMutation` sur des
 * fonctions générées, son type de retour ne peut pas être inféré.
 */
export const runQuadrantRecompute = internalAction({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }): Promise<QuadrantRecomputeSummary> => {
    // UNE seule horloge pour tout le run : les fenêtres de 48 h et de 14 jours
    // doivent se lire au même instant pour tous les projets, sinon deux posts
    // identiques classés à trois minutes d'écart peuvent tomber de part et
    // d'autre d'une bordure.
    const now = Date.now();
    const ids = await ctx.runQuery(
      internal.quadrantSync.listProjectIds,
      projectId ? { projectId } : {},
    );

    let posts = 0;
    let patched = 0;
    for (const id of ids) {
      let offset: number | null = 0;
      let chunks = 0;
      let total = 0;
      while (offset !== null) {
        if (chunks >= MAX_CHUNKS) {
          console.error(
            `[quadrant] projet ${id} — arrêt après ${MAX_CHUNKS} tranches ` +
              `(${offset}/${total} posts). Volume inattendu, à instrumenter.`,
          );
          break;
        }
        const res: { total: number; patched: number; next: number | null } =
          await ctx.runMutation(
            internal.quadrantSync.recomputeProjectQuadrantsChunk,
            { projectId: id, offset, now },
          );
        total = res.total;
        patched += res.patched;
        offset = res.next;
        chunks += 1;
      }
      posts += total;
    }

    console.info(
      `[quadrant] recalcul terminé — ${ids.length} projet(s), ${posts} post(s) publié(s), ` +
        `${patched} écriture(s).`,
    );
    return { projects: ids.length, posts, patched };
  },
});
