import {
  adminMutation,
  adminQuery,
  creatorQuery,
  e2eMutation,
} from "./functions";
import {
  computeLivePricingBreakdown,
  syncBonusUnlocks,
  type PricingBreakdown,
} from "./pricing";
import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
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
  // Optionnel : un palier bonus cumulé (bonus_tier) n'a pas d'assignment.
  assignmentId?: Id<"assignments">;
  label: string;
  amount: number;
  // base/bonus = LEGACY ; fixed/cpm + bonus_tier = pricing GELÉ au paiement.
  kind: "base" | "bonus" | "fixed" | "cpm" | "bonus_tier";
  // Chantier C — plateforme du post pour les lineItems "base" (paiement PAR
  // POST : N bases/assignment, 1 par cible). Absent sur les bonus (1/assignment)
  // et les bases legacy (mono-compte).
  platform?: "TikTok" | "Instagram" | "YouTube";
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
export async function getOrCreatePayment(
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
    // Chantier C — PAR POST : 1 base par (assignment, plateforme). Omis = base
    // unique legacy (idempotence par assignment seul).
    platform?: "TikTok" | "Instagram" | "YouTube";
  },
): Promise<void> {
  // Guard C — un assignment à pricingSnapshot relève du NOUVEAU modèle (paie
  // calculée à la lecture + gelée au paiement) : JAMAIS de lineItem legacy, même
  // si un futur appelant nous invoque par erreur (anti double paiement).
  const a = await ctx.db.get(args.assignmentId);
  if (a?.pricingSnapshot !== undefined) return;
  const period = periodOf(args.now);
  const payment = await getOrCreatePayment(ctx, {
    projectId: args.projectId,
    creatorId: args.creatorId,
    period,
    now: args.now,
  });
  // Idempotence PAR POST : une base déjà présente pour ce (assignment, plateforme)
  // → no-op. Plateformes distinctes → N bases distinctes (N × base).
  const alreadyBilled = payment.lineItems.some(
    (li) =>
      li.assignmentId === args.assignmentId &&
      li.kind === "base" &&
      li.platform === args.platform,
  );
  if (alreadyBilled) return;
  const lineItems: LineItem[] = [
    ...payment.lineItems,
    {
      assignmentId: args.assignmentId,
      label: args.label,
      amount: round2(args.amount),
      kind: "base",
      platform: args.platform,
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
  // Guard C (cf accrueBaseLineItem) — pricingSnapshot ⇒ bonus dérivé du moteur.
  const a = await ctx.db.get(args.assignmentId);
  if (a?.pricingSnapshot !== undefined) return;
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

// ─── Modèle PRICING — gel au paiement + enrichissement à la lecture ──────────

/** assignmentIds déjà couverts par des lineItems LEGACY (Guard B — disjonction). */
function legacyAssignmentIds(p: Doc<"payments">): Set<string> {
  return new Set(
    p.lineItems
      .filter(
        (li) =>
          (li.kind === "base" || li.kind === "bonus") &&
          li.assignmentId !== undefined,
      )
      .map((li) => li.assignmentId as string),
  );
}

/**
 * Construit les lineItems PRICING GELÉES (fixed/cpm + bonus_tier cash) à partir
 * de la paie live de la période. Utilisé au paiement (markPaid) → fige le
 * montant pricing dans la row (lecture verbatim ensuite, jamais recalculée).
 * Le bonus de PALIER (cumul) est gelé en `bonus_tier` (DISJOINT du `bonus`
 * legacy par vidéo).
 */
async function frozenPricingLineItems(
  ctx: MutationCtx,
  p: Doc<"payments">,
): Promise<LineItem[]> {
  const breakdown = await computeLivePricingBreakdown(
    ctx,
    p.projectId,
    p.creatorId,
    p.period,
    legacyAssignmentIds(p),
  );
  const out: LineItem[] = [];
  for (const g of breakdown.perPricing) {
    if (g.fixed <= 0) continue;
    const rep = breakdown.perAssignment.find((a) => a.pricingId === g.pricingId);
    out.push({
      assignmentId: rep?.assignmentId as Id<"assignments"> | undefined,
      label: `Fixe — ${g.videoCount} vidéo${g.videoCount > 1 ? "s" : ""} publiée${g.videoCount > 1 ? "s" : ""}`,
      amount: g.fixed,
      kind: "fixed",
    });
  }
  for (const a of breakdown.perAssignment) {
    if (a.cpm > 0) {
      out.push({
        assignmentId: a.assignmentId as Id<"assignments">,
        label: `CPM — ${a.totalViews} vues`,
        amount: a.cpm,
        kind: "cpm",
      });
    }
  }
  // Bonus de paliers CASH attribués à cette période (1 lineItem agrégée).
  if (breakdown.bonusTierCashTotal > 0) {
    out.push({
      label: "Bonus paliers (cumul de vues)",
      amount: breakdown.bonusTierCashTotal,
      kind: "bonus_tier",
    });
  }
  return out;
}

/** Breakdown pricing dérivé de lineItems GELÉES (période payée). */
function frozenBreakdownOf(p: Doc<"payments">): PricingBreakdown {
  const sumKind = (k: LineItem["kind"]) =>
    round2(
      p.lineItems.filter((li) => li.kind === k).reduce((s, li) => s + li.amount, 0),
    );
  const fixedTotal = sumKind("fixed");
  const cpmTotal = sumKind("cpm");
  // bonus_tier = bonus de PALIER cash (v2), DISJOINT du "bonus" legacy par vidéo.
  const bonusTierCashTotal = sumKind("bonus_tier");
  return {
    fixedTotal,
    cpmTotal,
    bonusTierCashTotal,
    total: round2(fixedTotal + cpmTotal + bonusTierCashTotal),
    perPricing: [],
    perAssignment: [],
  };
}

/**
 * Enrichit une row de paiement pour la LECTURE : ajoute `pricingBreakdown`
 * (fixe/CPM + bonus paliers cash de la période) — LIVE si non payée, FIGÉ si
 * payée. `totalDue` reflète legacy + pricing (la lecture ne mute pas).
 */
async function enrichPaymentForRead(
  ctx: QueryCtx | MutationCtx,
  p: Doc<"payments">,
): Promise<Doc<"payments"> & { pricingBreakdown: PricingBreakdown }> {
  if (p.status === "paid") {
    return { ...p, pricingBreakdown: frozenBreakdownOf(p) };
  }
  const breakdown = await computeLivePricingBreakdown(
    ctx,
    p.projectId,
    p.creatorId,
    p.period,
    legacyAssignmentIds(p),
  );
  const legacyTotal = recomputeTotal(p.lineItems);
  return {
    ...p,
    totalDue: round2(legacyTotal + breakdown.total),
    pricingBreakdown: breakdown,
  };
}

// ─── Queries (P9) ────────────────────────────────────────────────────────────

/**
 * Paiements du projet, enrichis des infos créateur (nom + email + méthode +
 * coordonnées de paiement, pour l'export CSV). Triés période desc.
 */
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
    const byId = new Map(creators.map((c) => [c._id, c]));
    const enriched = await Promise.all(
      payments.map(async (p) => {
        const e = await enrichPaymentForRead(ctx, p);
        const c = byId.get(p.creatorId);
        return {
          ...e,
          creatorName: c?.name ?? "—",
          creatorEmail: c?.email ?? "",
          creatorPaymentMethod: c?.paymentMethod ?? null,
          creatorPaymentDetails: c?.paymentDetails ?? null,
        };
      }),
    );
    return enriched.sort((a, b) => b.period.localeCompare(a.period));
  },
});

/**
 * Paiements du créateur courant UNIQUEMENT (filtré serveur par ctx.creatorId).
 * Un créateur ne voit jamais les paiements d'un autre. Triés période desc.
 */
export const getMyPayments = creatorQuery({
  args: {},
  handler: async (ctx) => {
    const payments = (
      await ctx.db
        .query("payments")
        .withIndex("by_creator", (q) => q.eq("creatorId", ctx.creatorId))
        .collect()
    ).filter((p) => p.projectId === ctx.projectId);
    const enriched = await Promise.all(
      payments.map((p) => enrichPaymentForRead(ctx, p)),
    );
    return enriched.sort((a, b) => b.period.localeCompare(a.period));
  },
});

// ─── Mutations admin — marquer payé (idempotent) ─────────────────────────────

/** Marque UN paiement comme payé. Idempotent : re-marquer ne change pas paidAt. */
export const markPaymentPaid = adminMutation({
  args: { id: v.id("payments") },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id);
    if (!p || p.projectId !== ctx.projectId) {
      throw new ConvexError("Paiement introuvable.");
    }
    if (p.status === "paid") return { ok: true, alreadyPaid: true };
    // Matérialise les paliers franchis AVANT le gel (Guard A intra-période :
    // un palier juste franchi de cette période est attribué puis gelé).
    await syncBonusUnlocks(ctx, p.projectId, p.creatorId);
    // GEL au paiement : fige le montant PRICING (fixe/CPM + bonus paliers cash)
    // dans la row → lecture verbatim ensuite, jamais recalculée.
    const frozen = await frozenPricingLineItems(ctx, p);
    const lineItems = [...p.lineItems, ...frozen];
    await ctx.db.patch(id, {
      status: "paid",
      paidAt: Date.now(),
      lineItems,
      totalDue: recomputeTotal(lineItems),
    });
    return { ok: true, alreadyPaid: false };
  },
});

/**
 * Marque TOUTE une période comme payée (masse). Idempotent : saute les
 * paiements déjà payés (leur paidAt est préservé). Retourne le nb basculé.
 */
export const markPeriodPaid = adminMutation({
  args: { period: v.string() },
  handler: async (ctx, { period }) => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_project_period", (q) =>
        q.eq("projectId", ctx.projectId).eq("period", period),
      )
      .collect();
    const now = Date.now();
    let marked = 0;
    for (const p of payments) {
      if (p.status === "paid") continue;
      await syncBonusUnlocks(ctx, p.projectId, p.creatorId);
      const frozen = await frozenPricingLineItems(ctx, p);
      const lineItems = [...p.lineItems, ...frozen];
      await ctx.db.patch(p._id, {
        status: "paid",
        paidAt: now,
        lineItems,
        totalDue: recomputeTotal(lineItems),
      });
      marked++;
    }
    return { marked };
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
