/**
 * CHANGER LE BARÈME DE VIDÉOS DÉJÀ ATTRIBUÉES — « elle est passée à son nouveau
 * contrat le 7 : ses vidéos depuis le 7 sont payées au nouveau barème ».
 *
 * POURQUOI. Le fixe, le CPM et la condition de vues sont FIGÉS à l'attribution
 * (`pricingSnapshot`, cf buildPricingSnapshot), et le bonus par vidéo se lit sur
 * le barème que le snapshot désigne : créer le nouveau barème, ou poser la
 * grille de la créatrice, ne change la paie d'aucune vidéo déjà attribuée. Le
 * seul chemin était une migration (`restampPricingSnapshots`), qui ne change pas
 * de barème et écarte les vidéos publiées.
 *
 * CE QUE ÇA FAIT. Re-tamponne `pricingSnapshot` — et RIEN d'autre — des vidéos
 * d'UNE créatrice dont le jour tombe dans la plage (cf convex/pricingReassignPlan :
 * publication, sinon jour prévu), publiées comprises, depuis le barème choisi et
 * avec la garde de devise de toute attribution (`buildPricingSnapshotFor`). Les
 * vidéos d'un cycle payé, de défi ou sans barème sont listées et laissées.
 *
 * CE QUE ÇA NE FAIT PAS. La grille de paliers de la créatrice (`bonusPricingId`)
 * ne bouge pas : c'est « Créatrices sur cette grille ». Les missions futures
 * prennent le barème de la créatrice à l'assignation, comme avant.
 *
 * Trois chemins, un seul cœur : l'écran Barèmes (aperçu puis « Appliquer »),
 * l'outil MCP `changer_bareme` (simuler puis écrire, journalisé), et `defaire`
 * (`restaurerBaremesCore`).
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  creatorScopeFor,
  permissionMutation,
  permissionQuery,
  requireCreatorInScope,
  type ProjectMutationCtx,
} from "./functions";
import { isInCreatorScope } from "./creatorScope";
import { ERR, err } from "./errorCodes";
import { resolveCreatorKind } from "./roles";
import { buildPricingSnapshot, buildPricingSnapshotFor, type PricingSnapshot } from "./pricing";
import { creatorPayCurrency, pricingPayCurrency } from "./creatorPayCurrency";
import { resolvePayCurrency } from "./payCurrency";
import { invalidateDashboardCache } from "./dashboardCache";
import { parisDayOf } from "./managerCpm";
import {
  classerVideos,
  cycleDeLaVideo,
  jourValide,
  memeSnapshot,
  type Payes,
  type VideoClassee,
} from "./pricingReassignPlan";

type Lecteur = (QueryCtx | MutationCtx) & { userId: Id<"users">; projectId: Id<"projects"> };

/** Les paiements PAYÉS d'une créatrice sur le projet (cf `Payes`). */
async function payesDe(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
): Promise<Payes> {
  const payes = (
    await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter((p) => p.projectId === projectId && p.status === "paid");
  return {
    periodes: new Set(payes.map((p) => p.period)),
    assignments: new Set(payes.flatMap((p) => p.lineItems.flatMap((li) => (li.assignmentId ? [li.assignmentId as string] : [])))),
  };
}

export type DemandeBareme = {
  creatorId: Id<"creators">;
  pricingId: Id<"pricings">;
  /** Premier jour concerné, AAAA-MM-JJ (Paris), inclus. */
  du: string;
  /** Dernier jour concerné, inclus — absent : sans fin. */
  au?: string;
};

/**
 * Le PLAN : la créatrice, le barème visé, ses termes (snapshot), et chaque vidéo
 * de la plage avec sa raison d'être laissée. Lecture seule — l'aperçu de
 * l'écran, la simulation MCP et l'écriture partagent exactement cette liste.
 */
export async function planChangementBareme(ctx: Lecteur, d: DemandeBareme) {
  if (!jourValide(d.du) || (d.au !== undefined && (!jourValide(d.au) || d.au < d.du))) {
    throw err(
      ERR.PRICING_REASSIGN_DAY_INVALID,
      "Plage de jours invalide : des jours AAAA-MM-JJ, le premier avant le dernier.",
    );
  }
  const creator = await ctx.db.get(d.creatorId);
  if (!creator || creator.projectId !== ctx.projectId) {
    throw err(ERR.CREATOR_NOT_IN_PROJECT, "Créateur introuvable dans le projet.");
  }
  await requireCreatorInScope(ctx, ctx.userId, ctx.projectId, creator._id);
  if (resolveCreatorKind(creator.kind) !== "partner") {
    throw err(
      ERR.CREATOR_NOT_IN_PROJECT,
      `${creator.name} n'est pas un créateur partenaire : sa rémunération ne passe pas par un barème.`,
      { name: creator.name },
    );
  }
  // Mêmes refus qu'une attribution : barème d'un autre projet, ou archivé.
  const cible = await buildPricingSnapshot(ctx, ctx.projectId, d.pricingId);
  const pricing = (await ctx.db.get(d.pricingId))!;

  const assignments = (
    await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect()
  ).filter((a) => a.projectId === ctx.projectId);
  const now = Date.now();
  const videos = classerVideos({
    assignments,
    du: d.du,
    au: d.au ?? null,
    aujourdhui: parisDayOf(now),
    now,
    firstPostAt: creator.firstPostAt,
    payes: await payesDe(ctx, ctx.projectId, creator._id),
    cible,
  });

  // Les barèmes ACTUELS des vidéos, pour les nommer (un barème supprimé depuis : null).
  const noms = new Map(
    (
      await ctx.db
        .query("pricings")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    ).map((p) => [p._id as string, p.name]),
  );

  // Devise : une créatrice est payée dans UNE devise. L'écriture refuse un
  // barème d'une autre devise (ensureCreatorPayCurrency) ; l'aperçu le dit avant.
  const project = await ctx.db.get(ctx.projectId);
  const deviseCreatrice = creatorPayCurrency(creator, project);
  const deviseBareme = resolvePayCurrency(cible.currency, project?.payCurrency);

  return {
    creator,
    pricing,
    cible,
    videos,
    noms,
    // Une créatrice sans aucun barème prendrait la devise du barème, mais elle
    // n'aurait alors aucune vidéo à changer : l'écart suffit à dire le refus.
    devise: { createatrice: deviseCreatrice, bareme: deviseBareme, compatible: deviseCreatrice === deviseBareme },
  };
}

export type ChangementBareme = {
  assignmentId: Id<"assignments">;
  avant: PricingSnapshot;
  apres: PricingSnapshot;
};

/**
 * Le geste : re-tamponne les vidéos du plan qui ne sont pas laissées.
 *
 * `attendu` — le nombre de vidéos que l'aperçu a montré. Fourni, il est vérifié
 * AVANT toute écriture : une vidéo publiée, payée ou ajoutée entre l'aperçu et
 * le clic arrête le geste au lieu de toucher un périmètre que personne n'a vu.
 */
export async function changerBaremeCore(
  ctx: ProjectMutationCtx,
  d: DemandeBareme & { attendu?: number },
): Promise<{ plan: Awaited<ReturnType<typeof planChangementBareme>>; changements: ChangementBareme[] }> {
  const plan = await planChangementBareme(ctx, d);
  const aChanger = plan.videos.filter((x) => x.refus === null);
  if (d.attendu !== undefined && aChanger.length !== d.attendu) {
    throw err(
      ERR.PRICING_REASSIGN_STALE,
      `La liste a changé depuis l'aperçu : ${aChanger.length} vidéo(s) à passer sur ce barème, ${d.attendu} attendue(s). Rien n'a été écrit.`,
      { found: aChanger.length, expected: d.attendu },
    );
  }
  if (aChanger.length === 0) return { plan, changements: [] };
  // Le snapshot de TOUTE attribution : garde « une devise par créatrice ».
  const apres = await buildPricingSnapshotFor(ctx, ctx.projectId, d.pricingId, plan.creator);
  const changements: ChangementBareme[] = [];
  for (const x of aChanger) {
    await ctx.db.patch(x.a._id, { pricingSnapshot: apres });
    changements.push({ assignmentId: x.a._id, avant: x.a.pricingSnapshot!, apres });
  }
  // Le total dû de l'accueil admin est un pré-calcul : il vient de changer.
  await invalidateDashboardCache(ctx, ctx.projectId, "dueTotal");
  return { plan, changements };
}

/**
 * DÉFAIRE un changement de barème : remet le snapshot d'avant de chaque vidéo —
 * SEULEMENT si toutes montrent encore celui écrit, et qu'aucune n'est entrée
 * dans un cycle payé depuis. Tout ou rien : un barème à moitié rendu laisserait
 * une paie que personne n'a décidée.
 */
export async function restaurerBaremesCore(
  ctx: MutationCtx & { projectId: Id<"projects"> },
  lignes: readonly ChangementBareme[],
): Promise<{ restaurees: number } | { refus: string }> {
  const docs = await Promise.all(lignes.map((l) => ctx.db.get(l.assignmentId)));
  if (docs.some((x) => x === null)) return { refus: "une vidéo a été supprimée depuis" };
  const changees = lignes.filter((l, i) => {
    const s = docs[i]!.pricingSnapshot;
    return s === undefined || !memeSnapshot(s, l.apres);
  });
  if (changees.length > 0) return { refus: `${changees.length} vidéo(s) ont changé de barème depuis` };
  // Toutes les vidéos d'un changement sont d'UNE créatrice (un appel = une créatrice).
  const creator = docs.length > 0 ? await ctx.db.get(docs[0]!.creatorId) : null;
  if (creator) {
    const payes = await payesDe(ctx, ctx.projectId, creator._id);
    const payeesDepuis = docs.filter((x) => cycleDeLaVideo(x!, creator.firstPostAt, payes, Date.now()).paye).length;
    if (payeesDepuis > 0) return { refus: `${payeesDepuis} vidéo(s) sont dans un cycle payé depuis : leur montant est gelé` };
  }
  for (const l of lignes) await ctx.db.patch(l.assignmentId, { pricingSnapshot: l.avant });
  await invalidateDashboardCache(ctx, ctx.projectId, "dueTotal");
  return { restaurees: lignes.length };
}

// ─── L'écran Barèmes ────────────────────────────────────────────────────────

const demandeValidator = {
  creatorId: v.id("creators"),
  pricingId: v.id("pricings"),
  du: v.string(),
  au: v.optional(v.string()),
};

const termes = (s: PricingSnapshot) => ({
  montantFixe: s.montantFixe,
  nbVideosCible: s.nbVideosCible,
  tauxCPM: s.tauxCPM,
  seuilVuesFixe: s.seuilVuesFixe ?? 0,
  currency: s.currency ?? null,
});

/** Les créatrices dont on peut changer le barème : partenaires, dans le périmètre. */
export const listReassignCreators = permissionQuery("pricing.manage")({
  args: {},
  handler: async (ctx) => {
    const scope = await creatorScopeFor(ctx, ctx.userId, ctx.projectId);
    const project = await ctx.db.get(ctx.projectId);
    return (
      await ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    )
      .filter((c) => resolveCreatorKind(c.kind) === "partner" && isInCreatorScope(scope, c._id))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map((c) => ({ _id: c._id, name: c.name, payCurrency: creatorPayCurrency(c, project) }));
  },
});

/** L'aperçu : chaque vidéo de la plage, son barème actuel, et ce qui la laisse. */
export const previewReassign = permissionQuery("pricing.manage")({
  args: demandeValidator,
  handler: async (ctx, d) => {
    const plan = await planChangementBareme(ctx, d);
    const project = await ctx.db.get(ctx.projectId);
    return {
      creatorName: plan.creator.name,
      pricingName: plan.pricing.name,
      terms: { ...termes(plan.cible), currency: pricingPayCurrency(plan.pricing, project) },
      currency: plan.devise,
      toChange: plan.videos.filter((x) => x.refus === null).length,
      videos: plan.videos.map((x: VideoClassee) => ({
        assignmentId: x.a._id,
        day: x.jour,
        published: x.publiee,
        status: x.a.status,
        cycleStart: x.cycle?.start ?? null,
        cycleEnd: x.cycle?.end ?? null,
        currentPricingName: x.a.pricingSnapshot ? (plan.noms.get(x.a.pricingSnapshot.pricingId) ?? null) : null,
        currentTerms: x.a.pricingSnapshot
          ? { ...termes(x.a.pricingSnapshot), currency: resolvePayCurrency(x.a.pricingSnapshot.currency, project?.payCurrency) }
          : null,
        refusal: x.refus,
      })),
    };
  },
});

/** « Appliquer » : `expected` = le nombre de vidéos montré par l'aperçu. */
export const reassignPricing = permissionMutation("pricing.manage")({
  args: { ...demandeValidator, expected: v.number() },
  handler: async (ctx, { expected, ...d }) => {
    const r = await changerBaremeCore(ctx, { ...d, attendu: expected });
    return { changed: r.changements.length };
  },
});
