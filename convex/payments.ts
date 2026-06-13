import { adminQuery, e2eMutation } from "./functions";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * P8 — Paiements (accrual). LOGIQUE D'ARGENT : chaque montant crédité est
 * calculé SERVEUR (jamais un montant fourni par le client) et l'accrual est
 * IDEMPOTENT (revalider / recalculer ne crédite jamais deux fois).
 *
 * Ce module porte : le calcul de période, la réplique serveur de
 * computeEarnings (règle A6 — un module convex/ ne peut pas importer lib/, cf
 * isFormatAllowedOnPlatform / normalizeSourceId / warmup), et les helpers
 * d'upsert de lineItems (base + bonus) appelés par assignments.validate /
 * assignments.computeViewBonus.
 */

type LineItem = {
  assignmentId: Id<"assignments">;
  label: string;
  amount: number;
  kind: "base" | "bonus";
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Période d'accrual "YYYY-MM" (UTC, déterministe — aligné sur todayKey/warmup). */
export function periodOf(now: number): string {
  const d = new Date(now);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}`;
}

// ─── Réplique serveur de lib/earnings.computeEarnings (règle A6) ──────────────
// DOIT rester identique à lib/earnings.ts (testé Vitest là-bas). Modèle :
//   base = basePerPost ; viewBonus = (viewBonusPer1k ?? 0) × vues / 1000 ;
//   bounty = somme des primes dont le seuil est atteint ; total = base+viewBonus+bounty.
export type RateSnapshot = {
  basePerPost: number;
  viewBonusPer1k?: number;
  bounties?: Array<{ thresholdViews: number; amount: number }>;
};

export interface Earnings {
  base: number;
  viewBonus: number;
  bounty: number;
  total: number;
}

export function computeEarnings(rate: RateSnapshot, views: number): Earnings {
  const v = Math.max(0, views);
  const base = round2(rate.basePerPost);
  const viewBonus = round2(((rate.viewBonusPer1k ?? 0) * v) / 1000);
  const bounty = round2(
    (rate.bounties ?? [])
      .filter((b) => v >= b.thresholdViews)
      .reduce((sum, b) => sum + b.amount, 0),
  );
  return { base, viewBonus, bounty, total: round2(base + viewBonus + bounty) };
}

const recomputeTotal = (lineItems: LineItem[]): number =>
  round2(lineItems.reduce((s, li) => s + li.amount, 0));

/** Le paiement (projectId, creatorId, period) — créé s'il n'existe pas. */
async function getOrCreatePayment(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    creatorId: Id<"creators">;
    period: string;
    now: number;
  },
): Promise<Doc<"payments">> {
  const existing = (
    await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect()
  ).find((p) => p.projectId === args.projectId && p.period === args.period);
  if (existing) return existing;
  const id = await ctx.db.insert("payments", {
    projectId: args.projectId,
    creatorId: args.creatorId,
    period: args.period,
    lineItems: [],
    totalDue: 0,
    status: "accruing",
    createdAt: args.now,
  });
  return (await ctx.db.get(id))!;
}

/**
 * Crédite la lineItem de BASE d'un assignment validé sur le paiement de la
 * période courante. IDEMPOTENT : si une lineItem "base" existe déjà pour cet
 * assignmentId, no-op (revalider ne crédite jamais deux fois).
 */
export async function accrueBaseLineItem(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    creatorId: Id<"creators">;
    assignmentId: Id<"assignments">;
    label: string;
    amount: number;
    now: number;
  },
): Promise<void> {
  const period = periodOf(args.now);
  const payment = await getOrCreatePayment(ctx, {
    projectId: args.projectId,
    creatorId: args.creatorId,
    period,
    now: args.now,
  });
  const alreadyBilled = payment.lineItems.some(
    (li) => li.assignmentId === args.assignmentId && li.kind === "base",
  );
  if (alreadyBilled) return;
  const lineItems: LineItem[] = [
    ...payment.lineItems,
    {
      assignmentId: args.assignmentId,
      label: args.label,
      amount: round2(args.amount),
      kind: "base",
    },
  ];
  await ctx.db.patch(payment._id, {
    lineItems,
    totalDue: recomputeTotal(lineItems),
  });
}

/**
 * Crédite/MET À JOUR la lineItem de BONUS d'un assignment. UN seul bonus par
 * assignment : recalcul = REMPLACEMENT de la ligne (jamais d'ajout). Attaché au
 * paiement portant déjà la base de cet assignment (base + bonus regroupés même
 * si le bonus est calculé un mois plus tard), sinon à la période courante.
 */
export async function upsertBonusLineItem(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    creatorId: Id<"creators">;
    assignmentId: Id<"assignments">;
    label: string;
    amount: number;
    now: number;
  },
): Promise<void> {
  const creatorPayments = (
    await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect()
  ).filter((p) => p.projectId === args.projectId);
  const payment =
    creatorPayments.find((p) =>
      p.lineItems.some(
        (li) => li.assignmentId === args.assignmentId && li.kind === "base",
      ),
    ) ??
    (await getOrCreatePayment(ctx, {
      projectId: args.projectId,
      creatorId: args.creatorId,
      period: periodOf(args.now),
      now: args.now,
    }));
  // Remplacement : on retire l'éventuel bonus existant de cet assignment.
  const others = payment.lineItems.filter(
    (li) => !(li.assignmentId === args.assignmentId && li.kind === "bonus"),
  );
  const lineItems: LineItem[] = [
    ...others,
    {
      assignmentId: args.assignmentId,
      label: args.label,
      amount: round2(args.amount),
      kind: "bonus",
    },
  ];
  await ctx.db.patch(payment._id, {
    lineItems,
    totalDue: recomputeTotal(lineItems),
  });
}

// ─── Query (lecture minimale — la vue paiements complète est P9) ─────────────

/** Paiements du projet, enrichis du nom créateur. Triés période desc. */
export const listPayments = adminQuery({
  args: {},
  handler: async (ctx) => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_project_period", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const nameById = new Map(creators.map((c) => [c._id, c.name]));
    return payments
      .sort((a, b) => b.period.localeCompare(a.period))
      .map((p) => ({ ...p, creatorName: nameById.get(p.creatorId) ?? "—" }));
  },
});

// ─── Cleanup e2e (gated E2E_SECRET) ──────────────────────────────────────────

/** Supprime les paiements liés à un créateur de test ([E2E_TEST] / e2e-creator). */
export const cleanupTestPayments = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("payments").collect();
    let deleted = 0;
    for (const p of all) {
      const creator = await ctx.db.get(p.creatorId);
      const isTest =
        creator !== null &&
        (creator.name.startsWith("[E2E_TEST]") ||
          creator.email.includes("e2e-creator"));
      if (creator === null || isTest) {
        await ctx.db.delete(p._id);
        deleted++;
      }
    }
    return { deleted };
  },
});
