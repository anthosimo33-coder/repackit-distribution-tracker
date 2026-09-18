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
import { ConvexError, v } from "convex/values";
import {
  authedQuery,
  requireProjectAccess,
  superadminMutation,
  superadminQuery,
} from "./functions";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { hasRole } from "./roles";
import {
  assignmentPublishedAt,
  assignmentViewsAndMetrics,
  newViewsCache,
} from "./pricing";
import {
  buildManagerPayRows,
  currentCpmEntries,
  managerPeriodStatus,
  roundCents,
  type ManagerPayRow,
} from "./managerCpm";

export type ManagerPayPayload = {
  /** Devise de paie du projet (`projects.payCurrency`), `null` si non réglée. */
  currency: string | null;
  /** Les créatrices qui rapportent au manager, avec leur taux. */
  creators: {
    creatorId: Id<"creators">;
    name: string;
    /** Taux en vigueur AUJOURD'HUI (0 = arrêtée). */
    cpm: number;
    /** Historique des taux, du plus ancien au plus récent (`from` null = depuis toujours). */
    history: { cpm: number; from: number | null }[];
  }[];
  /** Une ligne par (créatrice, mois de publication). */
  rows: ManagerPayRow[];
  /** Versements faits à ce manager, annulés compris (l'écran les distingue). */
  payouts: {
    _id: Id<"managerPayouts">;
    period: string;
    amount: number;
    paidAt: number;
    cancelled: boolean;
  }[];
};

async function managerPayFor(
  ctx: QueryCtx | MutationCtx,
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
  // Une créatrice apparaît autant de fois qu'elle a eu de taux : on la lit UNE fois.
  const current = currentCpmEntries(cpms);
  for (const [creatorKey, entry] of current) {
    const creatorId = entry.creatorId as Id<"creators">;
    const history = cpms
      .filter((e) => e.creatorId === creatorKey)
      .map((e) => ({ cpm: e.cpm, from: e.from ?? null }))
      .sort((a, b) => (a.from ?? -Infinity) - (b.from ?? -Infinity));
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
    creators.push({ creatorId, name, cpm: entry.cpm, history });
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
  const payouts = await ctx.db
    .query("managerPayouts")
    .withIndex("by_project_manager", (q) =>
      q.eq("projectId", projectId).eq("managerUserId", membership.userId),
    )
    .collect();
  return {
    currency: project?.payCurrency ?? null,
    creators: creators.sort((a, b) => a.name.localeCompare(b.name, "fr")),
    rows: buildManagerPayRows(videos, cpms),
    payouts: payouts
      .map((p) => ({
        _id: p._id,
        period: p.period,
        amount: p.amount,
        paidAt: p.paidAt,
        cancelled: p.cancelledAt !== undefined,
      }))
      .sort((a, b) => b.paidAt - a.paidAt),
  };
}

/** Le membership manager d'un projet, ou rejette. */
async function managerMembership(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  membershipId: Id<"memberships">,
) {
  const m = await ctx.db.get(membershipId);
  if (m === null || m.projectId !== projectId || !hasRole(m, "manager")) {
    throw new ConvexError("Manager introuvable dans ce projet.");
  }
  return m;
}

/**
 * MARQUER PAYÉ UN MOIS — enregistre un versement du RESTE à payer, recalculé ici.
 *
 * `expectedAmount` = le montant que l'écran affichait. S'il ne correspond plus
 * au reste recalculé (des vues sont tombées entre-temps, un taux a changé), on
 * refuse : on ne verse pas un autre montant que celui qu'on a lu et confirmé.
 *
 * Un mois encore ouvert peut être payé : ses vues continueront de monter, et
 * le complément réapparaîtra en « reste à payer » — il se paie de la même façon.
 */
export const markManagerPeriodPaid = superadminMutation({
  args: {
    projectId: v.id("projects"),
    membershipId: v.id("memberships"),
    period: v.string(),
    expectedAmount: v.number(),
  },
  handler: async (ctx, { projectId, membershipId, period, expectedAmount }) => {
    const m = await managerMembership(ctx, projectId, membershipId);
    const pay = await managerPayFor(ctx, projectId, m);
    const status = managerPeriodStatus(pay.rows, pay.payouts, period);
    if (status.remaining <= 0) {
      throw new ConvexError("Rien à payer sur ce mois.");
    }
    if (roundCents(expectedAmount) !== status.remaining) {
      throw new ConvexError(
        `Le montant a changé depuis l'affichage (reste dû : ${status.remaining}). ` +
          "Vérifie le nouveau montant et recommence.",
      );
    }
    const id = await ctx.db.insert("managerPayouts", {
      projectId,
      managerUserId: m.userId,
      period,
      amount: status.remaining,
      currency: pay.currency ?? undefined,
      lines: pay.rows
        .filter((r) => r.period === period)
        .map((r) => ({
          creatorId: r.creatorId as Id<"creators">,
          payableViews: r.payableViews,
          due: roundCents(r.amount),
        })),
      paidAt: Date.now(),
      actorUserId: ctx.userId,
    });
    return { payoutId: id, amount: status.remaining };
  },
});

/**
 * ANNULER UN VERSEMENT — une erreur de clic ou un virement qui n'est pas parti.
 * Le versement sort des sommes (le mois redevient dû), la ligne reste en base.
 */
export const cancelManagerPayout = superadminMutation({
  args: { projectId: v.id("projects"), payoutId: v.id("managerPayouts") },
  handler: async (ctx, { projectId, payoutId }) => {
    const p = await ctx.db.get(payoutId);
    if (p === null || p.projectId !== projectId) {
      throw new ConvexError("Versement introuvable.");
    }
    if (p.cancelledAt !== undefined) return { cancelled: true };
    await ctx.db.patch(payoutId, { cancelledAt: Date.now(), cancelledBy: ctx.userId });
    return { cancelled: true };
  },
});

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
