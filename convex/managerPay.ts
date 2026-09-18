/**
 * RELEVÉ DE RÉMUNÉRATION D'UN MANAGER — vues des créatrices qu'il gère × CPM.
 *
 * La règle et l'assiette vivent dans `convex/managerCpm.ts` (module pur) ; ici,
 * seulement la LECTURE : quelles vidéos, combien de vues, et qui a le droit de
 * voir quoi.
 *
 * ── DEUX PORTES, UN SEUL CALCUL ──────────────────────────────────────────────
 *   - `getMyManagerPay`  : le manager, sur SA paie. Pas un bloc du catalogue :
 *     ce n'est pas un droit qu'on accorde, c'est sa propre rémunération. Un
 *     membre qui n'est pas manager reçoit `null` (l'écran le dit) ;
 *   - `getManagerPay`    : le superadmin, sur la paie de n'importe quel manager,
 *     depuis « Rôles et droits ».
 * Les deux passent par `managerPayFor` : un chiffre vu par le manager et un
 * chiffre vu par celui qui le paie ne peuvent pas diverger.
 *
 * ── CE QUE LE MANAGER VOIT, ET PAS PLUS ──────────────────────────────────────
 * Le nom des créatrices qui le rémunèrent, leurs vues, SON taux et SON montant.
 * Jamais ce que la créatrice touche — la frontière argent du rôle tient.
 *
 * ── COÛT ─────────────────────────────────────────────────────────────────────
 * Lecture bornée aux créatrices du manager (index `by_creator`), et les
 * publications lues une par une : un manager de trois créatrices ne doit pas
 * relire les ~450 publications du projet, ni être réveillé par chacune d'elles.
 */
import { v } from "convex/values";
import { authedQuery, requireProjectAccess, superadminQuery } from "./functions";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { hasRole } from "./roles";
import {
  assignmentPublishedAt,
  assignmentViewsAndMetrics,
  newViewsCache,
} from "./pricing";
import { buildManagerPayRows, type ManagerPayRow } from "./managerCpm";

export type ManagerPayPayload = {
  /** Devise de paie du projet (`projects.payCurrency`), `null` si non réglée. */
  currency: string | null;
  /** Les créatrices qui rapportent au manager, avec leur taux. */
  creators: { creatorId: Id<"creators">; name: string; cpm: number }[];
  /** Une ligne par (créatrice, mois de publication). */
  rows: ManagerPayRow[];
};

async function managerPayFor(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  membership: Doc<"memberships">,
): Promise<ManagerPayPayload> {
  const project = await ctx.db.get(projectId);
  const cpms = membership.managerCpms ?? [];
  const cache = newViewsCache();
  const now = Date.now();
  const creators: ManagerPayPayload["creators"] = [];
  const videos: {
    creatorId: string;
    publishedAt: number;
    payableViews: number;
    totalViews: number;
  }[] = [];
  for (const { creatorId, cpm } of cpms) {
    const creator = await ctx.db.get(creatorId);
    const assignments = (
      await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).filter(
      (a) =>
        a.projectId === projectId &&
        (a.status === "published" || a.status === "paid"),
    );
    // Une créatrice supprimée garde ses vidéos conservées (Approche C) : on la
    // relit par le nom figé sur l'une d'elles.
    const name =
      creator?.name ??
      assignments.find((a) => a.creatorNameSnapshot)?.creatorNameSnapshot ??
      "—";
    creators.push({ creatorId, name, cpm });
    for (const a of assignments) {
      const views = await assignmentViewsAndMetrics(ctx, a, now, cache);
      videos.push({
        creatorId,
        publishedAt: assignmentPublishedAt(a),
        payableViews: views.payableViews,
        totalViews: views.totalViews,
      });
    }
  }
  return {
    currency: project?.payCurrency ?? null,
    creators: creators.sort((a, b) => a.name.localeCompare(b.name, "fr")),
    rows: buildManagerPayRows(videos, cpms),
  };
}

/**
 * MA rémunération — pour le manager connecté. `null` si la personne n'est pas
 * manager de ce projet (admin, superadmin, rôle de portail) : il n'y a alors
 * rien à relever, et ce n'est pas une erreur.
 */
export const getMyManagerPay = authedQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }): Promise<ManagerPayPayload | null> => {
    await requireProjectAccess(ctx, ctx.userId, projectId);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", ctx.userId).eq("projectId", projectId),
      )
      .first();
    if (membership === null || !hasRole(membership, "manager")) return null;
    return managerPayFor(ctx, projectId, membership);
  },
});

/** La rémunération d'un manager, vue par le superadmin (écran des rôles). */
export const getManagerPay = superadminQuery({
  args: { projectId: v.id("projects"), membershipId: v.id("memberships") },
  handler: async (ctx, { projectId, membershipId }): Promise<ManagerPayPayload | null> => {
    const membership = await ctx.db.get(membershipId);
    if (membership === null || membership.projectId !== projectId) return null;
    if (!hasRole(membership, "manager")) return null;
    return managerPayFor(ctx, projectId, membership);
  },
});
