/**
 * DÉCISIONS DE LA VALIDATION — la trace (table `videoReviews`) et sa lecture
 * (temps de réponse de l'équipe, écran Validation et outil MCP `validation`).
 * Les calculs sont dans convex/reviewDelay (pur, testé).
 */

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { creatorScopeFor, permissionQuery, type ProjectQueryCtx } from "./functions";
import { filterByCreatorScope } from "./creatorScope";
import {
  JOURS_LUS,
  fenetre,
  tempsDeReponse,
  type Decision,
  type Fenetre,
  type TempsDeReponse,
} from "./reviewDelay";

/**
 * Note la décision d'une vidéo de la file. Rien quand l'entrée dans la file
 * n'est pas connue (vidéo envoyée avant la mesure) : un délai inventé fausserait
 * la moyenne, une absence ne fausse rien.
 */
export async function enregistrerDecision(
  ctx: MutationCtx,
  a: Doc<"assignments">,
  decision: Decision,
  par: { userId: Id<"users">; via?: "claude" },
): Promise<void> {
  if (a.inReviewSince === undefined) return;
  await ctx.db.insert("videoReviews", {
    projectId: a.projectId,
    assignmentId: a._id,
    creatorId: a.creatorId,
    submittedAt: a.inReviewSince,
    decidedAt: Date.now(),
    decision,
    by: par.userId,
    ...(par.via ? { via: par.via } : {}),
  });
}

/** Les décisions partent avec la mission. */
export async function supprimerDecisionsDe(ctx: MutationCtx, assignmentId: Id<"assignments">): Promise<void> {
  const lignes = await ctx.db
    .query("videoReviews")
    .withIndex("by_assignment", (q) => q.eq("assignmentId", assignmentId))
    .collect();
  for (const l of lignes) await ctx.db.delete(l._id);
}

export type TempsDeReponseEquipe = TempsDeReponse & {
  /** Sur 30 jours, par personne qui a décidé (la plus active d'abord). */
  parPersonne: (Fenetre & { userId: Id<"users"> | null; nom: string | null; viaClaude: number })[];
  /** Première décision mesurée du projet — avant, rien n'était écrit. */
  mesureDepuis: number | null;
};

/**
 * Le temps de réponse vu par la personne qui lit : une manageuse ne voit que les
 * vidéos de ses créatrices, comme la file elle-même.
 */
export async function tempsDeReponseCore(ctx: ProjectQueryCtx): Promise<TempsDeReponseEquipe> {
  const now = Date.now();
  const scope = await creatorScopeFor(ctx, ctx.userId, ctx.projectId);
  const lues = await ctx.db
    .query("videoReviews")
    .withIndex("by_project_decidedAt", (q) =>
      q.eq("projectId", ctx.projectId).gt("decidedAt", now - JOURS_LUS * 86_400_000),
    )
    .collect();
  const decisions = filterByCreatorScope(lues, (d) => d.creatorId, scope);
  const premiere = await ctx.db
    .query("videoReviews")
    .withIndex("by_project_decidedAt", (q) => q.eq("projectId", ctx.projectId))
    .first();

  const parAuteur = new Map<string, Doc<"videoReviews">[]>();
  for (const d of decisions) {
    const cle = d.by ?? "";
    const lignes = parAuteur.get(cle);
    if (lignes) lignes.push(d);
    else parAuteur.set(cle, [d]);
  }
  const parPersonne = await Promise.all(
    [...parAuteur.entries()].map(async ([cle, lignes]) => {
      const user = cle === "" ? null : await ctx.db.get(cle as Id<"users">);
      return {
        userId: user?._id ?? null,
        nom: user?.name ?? user?.email ?? null,
        viaClaude: lignes.filter((l) => l.via === "claude").length,
        ...fenetre(lignes),
      };
    }),
  );
  parPersonne.sort((a, b) => b.videos - a.videos);

  return {
    ...tempsDeReponse(decisions, now),
    parPersonne,
    mesureDepuis: premiere?.decidedAt ?? null,
  };
}

/** Le bandeau « Temps de réponse » de l'écran Validation — même bloc que la file. */
export const getReviewDelay = permissionQuery("review.manage")({
  args: {},
  handler: (ctx) => tempsDeReponseCore(ctx),
});
