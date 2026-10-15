/**
 * LA CONVERSATION D'UNE MISSION — ce que la créatrice importe sur BLUSH.
 *
 * Depuis le MODE TOURNAGE (15/10/2026, cf convex/scenarioTournage), c'est le
 * fichier FIGÉ de sa paire créatrice × histoire, celui que l'équipe a importé
 * dans BLUSH : BLUSH rejoue le rapport de cet import, une version régénérée ne
 * collerait plus (nombre de messages, dates, prénom du vocal). Rien n'est servi
 * tant que le lien de tournage n'est pas collé.
 */
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { authedAction, requireCreator, requireCreatorObservable } from "./functions";
import { ERR, err } from "./errorCodes";
import { tournageDe } from "./scenarioTournage";

const ACCES = {
  projectId: v.id("projects"),
  assignmentId: v.id("assignments"),
  viewAsCreatorId: v.optional(v.id("creators")),
};

/**
 * Le scénario d'une mission, s'il est encore servable : une mission de script
 * qui en a reçu un, de son projet. null sinon. Archivé, il reste servi — la
 * mission l'a reçu quand il tournait.
 */
export async function scenarioDeMission(
  ctx: QueryCtx,
  a: Doc<"assignments">,
): Promise<Doc<"scenarios"> | null> {
  if (!a.scenarioId || !a.scriptCombo) return null;
  const scenario = await ctx.db.get(a.scenarioId);
  return scenario && scenario.projectId === a.projectId ? scenario : null;
}

/**
 * La GARDE du téléchargement : la créatrice de la mission, ou une personne de
 * l'équipe qui observe son espace. Une mission d'une autre créatrice rend une
 * conversation ABSENTE (introuvable, jamais « refusée »).
 */
async function missionDeLaCreatrice(
  ctx: QueryCtx,
  args: {
    userId: Id<"users">;
    projectId: Id<"projects">;
    assignmentId: Id<"assignments">;
    viewAsCreatorId?: Id<"creators">;
  },
): Promise<{ a: Doc<"assignments"> | null; creatorId: Id<"creators"> }> {
  const creatorId = args.viewAsCreatorId
    ? (await requireCreatorObservable(ctx, args.userId, args.projectId, args.viewAsCreatorId))._id
    : await requireCreator(ctx, args.userId, args.projectId);
  const a = await ctx.db.get(args.assignmentId);
  const mienne = a !== null && a.creatorId === creatorId && a.projectId === args.projectId;
  return { a: mienne ? a : null, creatorId };
}

/** Interne : la garde d'accès, puis le fichier figé de la paire — s'il a son lien. */
export const planConversationMission = internalQuery({
  args: { userId: v.id("users"), ...ACCES },
  handler: async (ctx, args) => {
    const { a } = await missionDeLaCreatrice(ctx, args);
    const scenario = a ? await scenarioDeMission(ctx, a) : null;
    if (!a || !scenario) {
      throw err(ERR.SCENARIO_NOT_FOUND, "Scénario introuvable.");
    }
    const t = await tournageDe(ctx, a.creatorId, scenario._id);
    if (!t?.lien) throw err(ERR.TOURNAGE_NOT_READY, "Conv et lien de tournage pas encore prêts.");
    return { fichierId: t.fichierId, nomFichier: t.nomFichier };
  },
});

/** Le fichier à importer en mode tournage : exactement celui que l'équipe a importé dans BLUSH. */
export const conversationMission = authedAction({
  args: ACCES,
  handler: async (ctx, args): Promise<{ nomFichier: string; texte: string }> => {
    const plan = await ctx.runQuery(internal.scenarioMission.planConversationMission, {
      userId: ctx.userId,
      projectId: args.projectId,
      assignmentId: args.assignmentId,
      ...(args.viewAsCreatorId ? { viewAsCreatorId: args.viewAsCreatorId } : {}),
    });
    const fichier = await ctx.storage.get(plan.fichierId);
    if (!fichier) throw err(ERR.TOURNAGE_NOT_READY, "Fichier de tournage introuvable.");
    return { nomFichier: plan.nomFichier, texte: await fichier.text() };
  },
});
