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
import { internalMutation, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
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
import { apiBlush, arreterLiensBlush, demanderLiensBlush } from "./scenarioTournageBlush";
import { parisDayKey } from "./viewsDaily";

/** Les créatrices à qui l'on prépare des tournages : celles qui reçoivent des missions. */
export function recoitDesMissions(c: Doc<"creators">): boolean {
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

/** Supprime des tournages ET leurs fichiers (créatrice ou histoire supprimée) ; leurs liens BLUSH créés par l'API s'arrêtent. */
export async function supprimerTournages(ctx: MutationCtx, rows: Doc<"scenarioTournages">[]): Promise<void> {
  await arreterLiensBlush(ctx, rows);
  for (const t of rows) {
    await ctx.db.delete(t._id);
    await deleteStorageBestEffort(ctx, t.fichierId);
  }
}

/**
 * Les histoires à préparer pour une créatrice : en service, sans fichier pour
 * elle (ou seulement `voulues`). Écran et Claude (convex/mcpTournage).
 */
export async function histoiresAPreparer(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  voulues: ReadonlySet<string> | null,
): Promise<Doc<"scenarios">[]> {
  const scenarios = await ctx.db
    .query("scenarios")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const out: Doc<"scenarios">[] = [];
  for (const s of scenarios) {
    if (voulues && !voulues.has(s._id)) continue;
    if (s.statut === "archive" || (await tournageDe(ctx, creatorId, s._id))) continue;
    out.push(s);
  }
  return out.sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }));
}

/** Ce qu'un fichier préparé porte, rangé dans `scenarioTournages`. */
export type FichierPrepare = {
  scenarioId: Id<"scenarios">;
  prenom: string;
  graine: number;
  finLe: string;
  fichierId: Id<"_storage">;
  nomFichier: string;
  messages: number;
};

/**
 * FABRIQUE et range dans le storage le fichier d'une paire (action) : le moteur
 * des missions, son prénom, une graine propre à la paire, fin la veille. null =
 * bible illisible.
 */
export async function fabriquerFichier(
  ctx: Pick<ActionCtx, "storage">,
  creatorId: Id<"creators">,
  scenario: { scenarioId: Id<"scenarios">; bible: string },
  prenom: string,
): Promise<FichierPrepare | null> {
  const lue = lireBible(scenario.bible);
  if (!lue.ok) return null;
  const graine = graineMission(`${creatorId}:${scenario.scenarioId}`);
  const finLe = veille(parisDayKey(Date.now()));
  const gen = genererConversation(lue.bible, { prenom, graine, finLe });
  const fichierId = await ctx.storage.store(new Blob([gen.texte], { type: "text/plain;charset=utf-8" }));
  return {
    scenarioId: scenario.scenarioId,
    prenom,
    graine,
    finLe,
    fichierId,
    nomFichier: gen.nomFichier,
    messages: gen.messages.length,
  };
}

/** Range un fichier préparé ; null si la paire en a déjà un (le fichier en trop est effacé). */
export async function rangerTournage(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  f: FichierPrepare,
): Promise<Id<"scenarioTournages"> | null> {
  if (await tournageDe(ctx, creatorId, f.scenarioId)) {
    await deleteStorageBestEffort(ctx, f.fichierId);
    return null;
  }
  const maintenant = Date.now();
  return ctx.db.insert("scenarioTournages", { projectId, creatorId, ...f, createdAt: maintenant, updatedAt: maintenant });
}

/** Pose (ou retire, avec "") le lien d'un tournage ; refuse ce qui n'est pas un lien https. */
export async function poserLienCore(
  ctx: MutationCtx,
  t: Doc<"scenarioTournages">,
  texte: string,
): Promise<{ avant: string | null; apres: string | null }> {
  const lu = lireLienTournage(texte);
  if (!lu.ok) throw err(ERR.TOURNAGE_LINK_INVALID, "Ce n'est pas un lien https.");
  await ctx.db.patch(t._id, { lien: lu.lien ?? undefined, updatedAt: Date.now() });
  return { avant: t.lien ?? null, apres: lu.lien };
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
      // L'API BLUSH crée les liens elle-même quand le déploiement a sa clé.
      apiBlush: apiBlush() !== null,
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
                blush: t.blush ? { statut: t.blush.statut, erreur: t.blush.erreur ?? null } : null,
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
    const voulues = args.scenarioIds ? new Set<string>(args.scenarioIds) : null;
    const aPreparer = (await histoiresAPreparer(ctx, args.projectId, creator._id, voulues)).map((s) => ({
      scenarioId: s._id,
      bible: s.bible,
    }));
    return { prenom, aPreparer };
  },
});

/** Interne : range un fichier préparé — sauf si une autre préparation est passée avant. */
export const fichierPrepareValidator = v.object({
  scenarioId: v.id("scenarios"),
  prenom: v.string(),
  graine: v.number(),
  finLe: v.string(),
  fichierId: v.id("_storage"),
  nomFichier: v.string(),
  messages: v.number(),
});

export const enregistrerTournage = internalMutation({
  args: { projectId: v.id("projects"), creatorId: v.id("creators"), fichier: fichierPrepareValidator },
  handler: async (ctx, args) => {
    const id = await rangerTournage(ctx, args.projectId, args.creatorId, args.fichier);
    if (!id) return false;
    // L'API BLUSH (si la clé est posée) crée le lien : ~3 min, une lecture payée.
    await demanderLiensBlush(ctx, [(await ctx.db.get(id))!]);
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
    let prepares = 0;
    for (const s of plan.aPreparer) {
      const fichier = await fabriquerFichier(ctx, args.creatorId, s, plan.prenom);
      if (!fichier) continue;
      const range = await ctx.runMutation(internal.scenarioTournage.enregistrerTournage, {
        projectId: args.projectId,
        creatorId: args.creatorId,
        fichier,
      });
      if (range) prepares += 1;
    }
    return { prepares };
  },
});

/**
 * « Créer les liens BLUSH » : demande à l'API le lien des fichiers d'une
 * créatrice qui n'en ont pas (ou seulement `scenarioIds` — « Réessayer »).
 * Chaque demande = une lecture payée (~1 €). Sans clé : rien.
 */
export const demanderLiensTournage = permissionMutation("scripts.manage")({
  args: { creatorId: v.id("creators"), scenarioIds: v.optional(v.array(v.id("scenarios"))) },
  handler: async (ctx, args) => {
    await requireCreatorInScope(ctx, ctx.userId, ctx.projectId, args.creatorId);
    const voulues = args.scenarioIds ? new Set<string>(args.scenarioIds) : null;
    const rows = (
      await ctx.db
        .query("scenarioTournages")
        .withIndex("by_creator_scenario", (q) => q.eq("creatorId", args.creatorId))
        .collect()
    ).filter((t) => t.projectId === ctx.projectId && (!voulues || voulues.has(t.scenarioId)));
    return { demandes: await demanderLiensBlush(ctx, rows) };
  },
});

/** Colle (ou retire, avec "") le lien de tournage que BLUSH a créé pour ce fichier. */
export const poserLienTournage = permissionMutation("scripts.manage")({
  args: { id: v.id("scenarioTournages"), lien: v.string() },
  handler: async (ctx, args) => {
    const t = await ctx.db.get(args.id);
    if (!t || t.projectId !== ctx.projectId) throw err(ERR.TOURNAGE_NOT_READY, "Tournage introuvable.");
    await requireCreatorInScope(ctx, ctx.userId, ctx.projectId, t.creatorId);
    await poserLienCore(ctx, t, args.lien);
    return { ok: true };
  },
});
