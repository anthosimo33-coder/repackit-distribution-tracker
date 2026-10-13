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
 *
 * Le PNG de l'écran choc se dessine dans le navigateur de la créatrice à partir
 * de cet export (components/scenarios/ecranChoc.ts).
 */
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { authedAction } from "./functions";
import { ERR, err } from "./errorCodes";
import { conversationDeMission } from "./conversationFiles";
import { firstNameOf } from "./conversationExport";
import { lireBible } from "./scenarioBible";
import { genererConversation } from "./scenarioEngine";
import { graineMission } from "./scriptConversation";
import { parisDayKey } from "./viewsDaily";

const ACCES = {
  projectId: v.id("projects"),
  assignmentId: v.id("assignments"),
  viewAsCreatorId: v.optional(v.id("creators")),
};

/** Interne : la garde d'accès, puis la bible et le prénom. */
export const planConversationMission = internalQuery({
  args: { userId: v.id("users"), ...ACCES },
  handler: async (ctx, args) => {
    const { a, brick, creatorId } = await conversationDeMission(ctx, args);
    const scenario = brick?.scenarioId ? await ctx.db.get(brick.scenarioId) : null;
    if (!a || !scenario || scenario.projectId !== args.projectId) {
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
