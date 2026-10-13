/**
 * LA CONVERSATION D'UNE MISSION, générée depuis son scénario — ce que la
 * créatrice importe sur BLUSH.
 *
 * Rien n'est stocké : l'export est DÉTERMINISTE (bible + prénom + graine de la
 * mission) et il FINIT LE JOUR DU TÉLÉCHARGEMENT (option A, décision du
 * 13/10/2026 : BLUSH compare les messages au jour de l'import). Le même jour,
 * la même mission retélécharge donc le même fichier ; un autre jour, le même
 * contenu, dates glissées. Corriger une bible répare les missions pas encore
 * filmées, comme une consigne.
 */
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { authedAction, requireCreator, requireCreatorObservable } from "./functions";
import { ERR, err } from "./errorCodes";
import { lireBible } from "./scenarioBible";
import { genererConversation } from "./scenarioEngine";
import { graineMission } from "./scriptConversation";
import { parisDayKey } from "./viewsDaily";

const ACCES = {
  projectId: v.id("projects"),
  assignmentId: v.id("assignments"),
  viewAsCreatorId: v.optional(v.id("creators")),
};

/** Le prénom d'un nom complet (« Juliette Chetrit » → « Juliette »). Vide si le nom l'est. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

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

/** Interne : la garde d'accès, puis la bible et le prénom. */
export const planConversationMission = internalQuery({
  args: { userId: v.id("users"), ...ACCES },
  handler: async (ctx, args) => {
    const { a, creatorId } = await missionDeLaCreatrice(ctx, args);
    const scenario = a ? await scenarioDeMission(ctx, a) : null;
    if (!a || !scenario) {
      throw err(ERR.SCENARIO_NOT_FOUND, "Scénario introuvable.");
    }
    const creator = await ctx.db.get(creatorId);
    return {
      bible: scenario.bible,
      prenom: firstNameOf(creator?.name ?? ""),
      graine: graineMission(a._id),
    };
  },
});

/** L'export WhatsApp de la mission, au prénom de la créatrice, qui finit aujourd'hui (Paris). */
export const genererConversationMission = authedAction({
  args: ACCES,
  handler: async (
    ctx,
    args,
  ): Promise<{ nomFichier: string; texte: string; prenom: string; lui: string }> => {
    const plan = await ctx.runQuery(internal.scenarioMission.planConversationMission, {
      userId: ctx.userId,
      projectId: args.projectId,
      assignmentId: args.assignmentId,
      ...(args.viewAsCreatorId ? { viewAsCreatorId: args.viewAsCreatorId } : {}),
    });
    const lue = lireBible(plan.bible);
    if (!lue.ok || !plan.prenom) throw err(ERR.SCENARIO_NOT_FOUND, "Scénario introuvable.");
    const gen = genererConversation(lue.bible, {
      prenom: plan.prenom,
      graine: plan.graine,
      finLe: parisDayKey(Date.now()),
    });
    return { nomFichier: gen.nomFichier, texte: gen.texte, prenom: gen.noms.L, lui: gen.noms.Y };
  },
});
