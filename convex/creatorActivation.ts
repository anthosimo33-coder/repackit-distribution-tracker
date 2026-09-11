import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { resolveCreatorKind } from "./roles";

/**
 * ACTIVATION D'UNE FICHE CRÉATEUR — le geste unique, partagé par la main de
 * l'admin (`updateCreator`) et par l'automatisme (« un compte vient d'être
 * validé »). Un seul endroit écrit `status: "active"`, sinon l'ancre de paie
 * d'un talent serait posée sur un chemin et pas sur l'autre.
 *
 * ⚠️ `payStartAt` N'EST PAS UN DÉTAIL : elle est posée à la PREMIÈRE activation
 * d'un TALENT et jamais réécrite (cf schema + payCycle.payAnchorOf). Une
 * activation qui l'oublie sort le talent de tous les cycles et fait jeter
 * `markCyclePaid` ; une activation qui la réécrit décale des cycles DÉJÀ PAYÉS.
 * Le gate sur la population est tout aussi impératif : un PARTENAIRE qui la
 * recevrait verrait ses cycles recalés sur une date antérieure à son 1er post.
 */
export function creatorActivationPatch(
  creator: { kind?: Doc<"creators">["kind"]; payStartAt?: number },
  now: number,
): { status: "active"; payStartAt?: number } {
  const poseAncre =
    resolveCreatorKind(creator.kind) === "talent" &&
    creator.payStartAt === undefined;
  return { status: "active", ...(poseAncre ? { payStartAt: now } : {}) };
}

/**
 * L'activation automatique s'applique-t-elle à cette fiche ?
 *
 * "onboarding" UNIQUEMENT, et c'est une décision, pas un oubli :
 *  - "invited" — la personne n'a jamais accepté son invitation. L'admin peut
 *    pourtant lui déclarer un compte géré (`declareManagedCompte`) et le
 *    valider : la passer « active » effacerait le seul endroit où se lit
 *    « elle ne s'est jamais connectée ».
 *  - "paused" / "churned" — des décisions HUMAINES. Valider un compte oublié
 *    (ou en désarchiver un) ne doit pas rappeler quelqu'un qui est parti.
 *  - "active" — déjà fait, rien à écrire.
 */
export function shouldAutoActivateCreator(creator: {
  status: Doc<"creators">["status"];
}): boolean {
  return creator.status === "onboarding";
}

/**
 * À APPELER SUR LA TRANSITION, jamais en boucle de vérification : le seul appelant
 * légitime est un chemin qui vient de faire passer un compte de CE créateur en
 * "actif" (validation depuis la file, ou désarchivage). D'où l'absence de
 * relecture des comptes ici — « il en a au moins un d'actif » est déjà établi par
 * l'appelant, et une seconde lecture ne ferait que pouvoir le contredire.
 *
 * Rend `true` si la fiche a effectivement changé de statut (les appelants s'en
 * servent pour compter, cf backfill).
 */
export async function activateCreatorOnAccountValidated(
  ctx: MutationCtx,
  creatorId: Id<"creators">,
  now: number = Date.now(),
): Promise<boolean> {
  const creator = await ctx.db.get(creatorId);
  if (!creator || !shouldAutoActivateCreator(creator)) return false;
  await ctx.db.patch(creator._id, creatorActivationPatch(creator, now));
  return true;
}
