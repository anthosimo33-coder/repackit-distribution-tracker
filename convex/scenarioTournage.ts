/**
 * MODE TOURNAGE BLUSH — un fichier FIGÉ et un lien par créatrice et par histoire
 * (décision du 15/10/2026).
 *
 * En mode tournage, BLUSH ne lit pas la conv que la créatrice importe : il
 * REJOUE le rapport d'un import fait une fois par l'équipe (verdict, vocal
 * enregistré avec le prénom de ce fichier, dates, nombre de messages). Pour que
 * tout ce qu'elle filme colle, elle doit donc importer EXACTEMENT le fichier que
 * l'équipe a importé — à son prénom, pour que le vocal le dise. D'où, pour
 * chaque créatrice et chaque histoire :
 *
 *   1. « Préparer » fabrique le fichier une fois (son prénom, une graine propre à
 *      la paire, fin LA VEILLE) et le range dans le storage — plus jamais
 *      régénéré : corriger la bible ensuite ne le change pas, BLUSH a lu celui-là ;
 *   2. l'équipe l'importe dans BLUSH, crée le lien de tournage, le colle ici ;
 *   3. la mission de la créatrice sert CE fichier et CE lien — et rien tant que
 *      le lien n'est pas collé : importer sans lien, c'est une vraie lecture
 *      payée par l'équipe et l'écran de paiement pour elle.
 *
 * Le lien est lu en direct : en changer (lien arrêté dans BLUSH) suit sur toutes
 * les missions de la paire.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  authedAction,
  creatorScopeFor,
  permissionMutation,
  permissionQuery,
  requireCreatorInScope,
  requirePermission,
} from "./functions";
import { filterByCreatorScope } from "./creatorScope";
import { ERR, err } from "./errorCodes";
import { lireBible } from "./scenarioBible";
import { genererConversation } from "./scenarioEngine";
import { firstNameOf, lireLienTournage, veille } from "./scenarioTournageRegles";
import { graineMission } from "./scriptConversation";
import { deleteStorageBestEffort } from "./storageCleanup";
import { parisDayKey } from "./viewsDaily";

/** Les créatrices à qui l'on prépare des tournages : celles qui reçoivent des missions. */
function recoitDesMissions(c: Doc<"creators">): boolean {
  return (c.kind === undefined || c.kind === "partner") && c.status !== "churned";
}

/** Le tournage d'une créatrice pour une histoire, s'il est préparé. */
export async function tournageDe(
  ctx: { db: QueryCtx["db"] },
  creatorId: Id<"creators">,
  scenarioId: Id<"scenarios">,
): Promise<Doc<"scenarioTournages"> | null> {
  return ctx.db
    .query("scenarioTournages")
    .withIndex("by_creator_scenario", (q) => q.eq("creatorId", creatorId).eq("scenarioId", scenarioId))
    .first();
}

/** Supprime des tournages ET leurs fichiers (créatrice ou histoire supprimée). */
export async function supprimerTournages(ctx: MutationCtx, rows: Doc<"scenarioTournages">[]): Promise<void> {
  for (const t of rows) {
    await ctx.db.delete(t._id);
    await deleteStorageBestEffort(ctx, t.fichierId);
  }
}

// ─── Écran « Mode tournage » ─────────────────────────────────────────────────

/**
 * Pour chaque créatrice (du périmètre) et chaque histoire en service : le
 * fichier à importer dans BLUSH et le lien collé. Une histoire archivée reste
 * listée tant qu'un tournage la sert.
 */
export const tournagesDuProjet = permissionQuery("scripts.manage")({
  args: {},
  handler: async (ctx) => {
    const scope = await creatorScopeFor(ctx, ctx.userId, ctx.projectId);
    const tournages = await ctx.db
      .query("scenarioTournages")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const servies = new Set(tournages.map((t) => t.scenarioId as string));
    const scenarios = (
      await ctx.db
        .query("scenarios")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    )
      .filter((s) => s.statut !== "archive" || servies.has(s._id))
      .sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }))
      .map((s) => ({ _id: s._id, code: s.code, titre: s.titre, theme: s.theme }));
    const createatrices = filterByCreatorScope(
      (
        await ctx.db
          .query("creators")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect()
      ).filter(recoitDesMissions),
      (c) => c._id,
      scope,
    ).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return {
      scenarios,
      createatrices: await Promise.all(
        createatrices.map(async (c) => ({
          _id: c._id,
          nom: c.name,
          prenom: firstNameOf(c.name),
          tournages: await Promise.all(
            tournages
              .filter((t) => t.creatorId === c._id)
              .map(async (t) => ({
                _id: t._id,
                scenarioId: t.scenarioId,
                lien: t.lien ?? null,
                nomFichier: t.nomFichier,
                messages: t.messages,
                finLe: t.finLe,
                url: await ctx.storage.getUrl(t.fichierId),
              })),
          ),
        })),
      ),
    };
  },
});

/** Interne : la garde (bloc scripts + périmètre), puis ce qu'il reste à préparer pour elle. */
export const planPreparation = internalQuery({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    creatorId: v.id("creators"),
    scenarioIds: v.optional(v.array(v.id("scenarios"))),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.userId, args.projectId, "scripts.manage");
    const creator = await ctx.db.get(args.creatorId);
    if (!creator || creator.projectId !== args.projectId || !recoitDesMissions(creator)) {
      throw err(ERR.CREATOR_NOT_FOUND, "Créatrice introuvable.");
    }
    await requireCreatorInScope(ctx, args.userId, args.projectId, creator._id);
    const prenom = firstNameOf(creator.name);
    if (!prenom) throw err(ERR.CREATOR_NOT_FOUND, "Créatrice sans prénom.");
    const scenarios = await ctx.db
      .query("scenarios")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const voulues = args.scenarioIds ? new Set<string>(args.scenarioIds) : null;
    const aPreparer: { scenarioId: Id<"scenarios">; bible: string }[] = [];
    for (const s of scenarios) {
      if (voulues && !voulues.has(s._id)) continue;
      if (s.statut === "archive" || (await tournageDe(ctx, creator._id, s._id))) continue;
      aPreparer.push({ scenarioId: s._id, bible: s.bible });
    }
    return { prenom, aPreparer };
  },
});

/** Interne : range un fichier préparé — sauf si une autre préparation est passée avant. */
export const enregistrerTournage = internalMutation({
  args: {
    projectId: v.id("projects"),
    scenarioId: v.id("scenarios"),
    creatorId: v.id("creators"),
    prenom: v.string(),
    graine: v.number(),
    finLe: v.string(),
    fichierId: v.id("_storage"),
    nomFichier: v.string(),
    messages: v.number(),
  },
  handler: async (ctx, args) => {
    if (await tournageDe(ctx, args.creatorId, args.scenarioId)) {
      await deleteStorageBestEffort(ctx, args.fichierId);
      return false;
    }
    const maintenant = Date.now();
    await ctx.db.insert("scenarioTournages", { ...args, createdAt: maintenant, updatedAt: maintenant });
    return true;
  },
});

/**
 * « Préparer ses fichiers » : un fichier figé par histoire en service qui n'en a
 * pas encore pour elle (ou seulement `scenarioIds`). Ceux déjà préparés ne
 * bougent pas (BLUSH les a peut-être déjà lus).
 */
export const preparerTournages = authedAction({
  args: {
    projectId: v.id("projects"),
    creatorId: v.id("creators"),
    scenarioIds: v.optional(v.array(v.id("scenarios"))),
  },
  handler: async (ctx, args): Promise<{ prepares: number }> => {
    const plan = await ctx.runQuery(internal.scenarioTournage.planPreparation, {
      userId: ctx.userId,
      projectId: args.projectId,
      creatorId: args.creatorId,
      ...(args.scenarioIds ? { scenarioIds: args.scenarioIds } : {}),
    });
    const finLe = veille(parisDayKey(Date.now()));
    let prepares = 0;
    for (const { scenarioId, bible } of plan.aPreparer) {
      const lue = lireBible(bible);
      if (!lue.ok) continue;
      const graine = graineMission(`${args.creatorId}:${scenarioId}`);
      const gen = genererConversation(lue.bible, { prenom: plan.prenom, graine, finLe });
      const fichierId = await ctx.storage.store(new Blob([gen.texte], { type: "text/plain;charset=utf-8" }));
      const range = await ctx.runMutation(internal.scenarioTournage.enregistrerTournage, {
        projectId: args.projectId,
        scenarioId,
        creatorId: args.creatorId,
        prenom: plan.prenom,
        graine,
        finLe,
        fichierId,
        nomFichier: gen.nomFichier,
        messages: gen.messages.length,
      });
      if (range) prepares += 1;
    }
    return { prepares };
  },
});

/** Colle (ou retire, avec "") le lien de tournage que BLUSH a créé pour ce fichier. */
export const poserLienTournage = permissionMutation("scripts.manage")({
  args: { id: v.id("scenarioTournages"), lien: v.string() },
  handler: async (ctx, args) => {
    const t = await ctx.db.get(args.id);
    if (!t || t.projectId !== ctx.projectId) throw err(ERR.TOURNAGE_NOT_READY, "Tournage introuvable.");
    await requireCreatorInScope(ctx, ctx.userId, ctx.projectId, t.creatorId);
    const lu = lireLienTournage(args.lien);
    if (!lu.ok) throw err(ERR.TOURNAGE_LINK_INVALID, "Ce n'est pas un lien https.");
    await ctx.db.patch(t._id, { lien: lu.lien ?? undefined, updatedAt: Date.now() });
    return { ok: true };
  },
});
