import {
  adminMutation,
  adminQuery,
  adminViewAsQuery,
  creatorQuery,
  e2eMutation,
} from "./functions";
import {
  computeLivePricingBreakdown,
  computeCyclePricingBreakdown,
  assignmentPublishedAt,
  syncBonusUnlocks,
  MAX_PAY_PER_VIDEO_EUR,
  type PricingBreakdown,
} from "./pricing";
import {
  calcCycle,
  cycleWindow,
  cyclePeriodKey,
  cycleIndexOf,
} from "./payCycle";
import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
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
  const rawTotal = round2(base + viewBonus + bounty);
  // Plafond 150 €/vidéo (RÉPLIQUE lib/earnings, A6) : cape le bonus (viewBonus
  // puis primes) → l'accrual (assignments.computeViewBonus = viewBonus+bounty)
  // est capé À LA SOURCE, base + bonus ≤ 150.
  if (rawTotal <= MAX_PAY_PER_VIDEO_EUR) {
    return { base, viewBonus, bounty, total: rawTotal };
  }
  const room = Math.max(0, round2(MAX_PAY_PER_VIDEO_EUR - base));
  const cappedViewBonus = Math.min(viewBonus, room);
  const cappedBounty = Math.min(bounty, round2(room - cappedViewBonus));
  return {
    base,
    viewBonus: cappedViewBonus,
    bounty: cappedBounty,
    total: round2(base + cappedViewBonus + cappedBounty),
  };
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

// ─── Cycle J+30 GLISSANT — lecture re-fenêtrée par créateur ───────────────────

/**
 * Un CYCLE de paie d'un créateur (fenêtre de 30 j perso). Shape compatible avec
 * l'ancienne row (period/status/lineItems/totalDue/pricingBreakdown) + champs de
 * cycle. `key` = clé React (un cycle NON payé n'a pas de row Convex → pas de _id).
 */
export type CyclePayment = {
  key: string;
  cycleIndex: number;
  cycleStart: number;
  cycleEnd: number;
  /** Clé stable = date de début ISO "YYYY-MM-DD" (cf cyclePeriodKey). */
  period: string;
  status: "accruing" | "paid";
  paidAt: number | null;
  lineItems: LineItem[];
  totalDue: number;
  pricingBreakdown: PricingBreakdown;
};

/** LineItems GELÉES (fixed/cpm + bonus_tier cash) construites depuis un breakdown. */
function frozenLineItemsFromBreakdown(b: PricingBreakdown): LineItem[] {
  const out: LineItem[] = [];
  for (const g of b.perPricing) {
    if (g.fixed <= 0) continue;
    const rep = b.perAssignment.find((a) => a.pricingId === g.pricingId);
    out.push({
      assignmentId: rep?.assignmentId as Id<"assignments"> | undefined,
      label: `Fixe — ${g.videoCount} vidéo${g.videoCount > 1 ? "s" : ""} publiée${g.videoCount > 1 ? "s" : ""}`,
      amount: g.fixed,
      kind: "fixed",
    });
  }
  for (const a of b.perAssignment) {
    if (a.cpm > 0) {
      out.push({
        assignmentId: a.assignmentId as Id<"assignments">,
        label: `CPM — ${a.totalViews} vues`,
        amount: a.cpm,
        kind: "cpm",
      });
    }
  }
  if (b.bonusTierCashTotal > 0) {
    out.push({
      label: "Bonus paliers (cumul de vues)",
      amount: b.bonusTierCashTotal,
      kind: "bonus_tier",
    });
  }
  return out;
}

/**
 * Paiements d'un créateur RE-FENÊTRÉS par ses cycles J+30 (ancre firstPostAt).
 * TOUS ses gains (existants accumulés + futurs) sont regroupés par sa fenêtre de
 * 30 j perso — MÊME moteur de montant (computeMonthlyPayout, cap 150€/vidéo) : seul
 * le REGROUPEMENT change → le TOTAL dû est INVARIANT. Cycles du plus récent au plus
 * ancien ; on garde ceux avec gains + TOUJOURS le cycle courant (« prochaine paie »
 * = son cycleEnd). firstPostAt absent (aucun post) → aucun cycle (liste vide).
 */
async function cyclePaymentsForCreator(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  now: number,
): Promise<CyclePayment[]> {
  const creator = await ctx.db.get(creatorId);
  const firstPostAt = creator?.firstPostAt;
  if (!creator || firstPostAt === undefined) return [];
  const currentCycle = calcCycle(firstPostAt, now).cycleIndex;

  const rows = (
    await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter((p) => p.projectId === projectId);
  // Rows GELÉES (payées) indexées par clé de cycle (date de début ISO).
  const paidByPeriod = new Map(
    rows.filter((p) => p.status === "paid").map((p) => [p.period, p]),
  );

  // lineItems LEGACY (modèle RepackIt, base/bonus) des rows NON payées, re-fenêtrés
  // par le cycle de PUBLI de leur assignment (assignmentPublishedAt → cycle).
  const assignments = (
    await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter((a) => a.projectId === projectId);
  const cycleOfAssignment = new Map(
    assignments.map((a) => [
      a._id,
      cycleIndexOf(firstPostAt, assignmentPublishedAt(a)),
    ]),
  );
  const legacyByCycle = new Map<number, LineItem[]>();
  for (const p of rows) {
    if (p.status === "paid") continue;
    for (const li of p.lineItems) {
      const cyc = li.assignmentId
        ? cycleOfAssignment.get(li.assignmentId)
        : undefined;
      const k = cyc ?? currentCycle; // 0 est valide (nullish uniquement)
      const arr = legacyByCycle.get(k);
      if (arr) arr.push(li);
      else legacyByCycle.set(k, [li]);
    }
  }

  const out: CyclePayment[] = [];
  for (let k = currentCycle; k >= 0; k--) {
    const w = cycleWindow(firstPostAt, k);
    const period = cyclePeriodKey(w.cycleStart);
    const paid = paidByPeriod.get(period);
    if (paid) {
      out.push({
        key: `paid:${paid._id}`,
        cycleIndex: k,
        cycleStart: w.cycleStart,
        cycleEnd: w.cycleEnd,
        period,
        status: "paid",
        paidAt: paid.paidAt ?? null,
        lineItems: paid.lineItems,
        totalDue: paid.totalDue,
        pricingBreakdown: frozenBreakdownOf(paid),
      });
      continue;
    }
    const legacyItems = legacyByCycle.get(k) ?? [];
    const legacyIds = new Set(
      legacyItems
        .filter((li) => li.assignmentId !== undefined)
        .map((li) => li.assignmentId as string),
    );
    const breakdown = await computeCyclePricingBreakdown(
      ctx,
      projectId,
      creatorId,
      firstPostAt,
      k,
      legacyIds,
    );
    const legacyTotal = recomputeTotal(legacyItems);
    out.push({
      key: `${creatorId}:${k}`,
      cycleIndex: k,
      cycleStart: w.cycleStart,
      cycleEnd: w.cycleEnd,
      period,
      status: "accruing",
      paidAt: null,
      lineItems: legacyItems,
      totalDue: round2(legacyTotal + breakdown.total),
      pricingBreakdown: breakdown,
    });
  }
  return out.filter(
    (c) =>
      c.cycleIndex === currentCycle || c.totalDue > 0 || c.lineItems.length > 0,
  );
}

// ─── Queries (P9) ────────────────────────────────────────────────────────────

/**
 * Paiements du projet (tous créateurs), re-fenêtrés par cycle J+30 perso + infos
 * créateur (nom/email/méthode, export CSV). Triés cycle (date de début) desc.
 * NB : n'itère que les créateurs VIVANTS (une fiche supprimée avec des cycles
 * payés — inexistant tant que rien n'est versé — ne remonterait pas ici).
 */
export const listPayments = adminQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const now = Date.now();
    const out = [];
    for (const c of creators) {
      const cycles = await cyclePaymentsForCreator(
        ctx,
        ctx.projectId,
        c._id,
        now,
      );
      for (const cy of cycles) {
        out.push({
          ...cy,
          creatorId: c._id,
          creatorName: c.name,
          creatorEmail: c.email,
          creatorPaymentMethod: c.paymentMethod ?? null,
          creatorPaymentDetails: c.paymentDetails ?? null,
        });
      }
    }
    return out.sort(
      (a, b) =>
        b.cycleStart - a.cycleStart ||
        a.creatorName.localeCompare(b.creatorName, "fr"),
    );
  },
});

export const getMyPayments = creatorQuery({
  args: {},
  handler: async (ctx) =>
    cyclePaymentsForCreator(ctx, ctx.projectId, ctx.creatorId, Date.now()),
});

/** ADMIN view-as — cycles/gains du créateur ciblé (lecture seule, scopé projet). */
export const getPaymentsAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) =>
    cyclePaymentsForCreator(ctx, ctx.projectId, ctx.creatorId, Date.now()),
});

// ─── Mutations admin — marquer payé (idempotent) ─────────────────────────────

/**
 * Marque UN CYCLE J+30 d'un créateur comme payé (modèle glissant). GÈLE le
 * breakdown du cycle (fixe/CPM + bonus paliers cash) dans une row keyée par
 * (créateur, cyclePeriodKey) → lecture verbatim ensuite. On passe `cycleIndex`
 * (pas la clé date, lossy si firstPostAt n'est pas à minuit) → la fenêtre + la
 * clé sont recalculées serveur. Idempotent : un cycle déjà payé → no-op.
 */
export const markCyclePaid = adminMutation({
  args: { creatorId: v.id("creators"), cycleIndex: v.number() },
  handler: async (ctx, { creatorId, cycleIndex }) => {
    const creator = await ctx.db.get(creatorId);
    if (!creator || creator.projectId !== ctx.projectId) {
      throw new ConvexError("Créateur introuvable.");
    }
    if (creator.firstPostAt === undefined) {
      throw new ConvexError("Aucun cycle : le créateur n'a pas encore publié.");
    }
    if (!Number.isInteger(cycleIndex) || cycleIndex < 0) {
      throw new ConvexError("Cycle invalide.");
    }
    const w = cycleWindow(creator.firstPostAt, cycleIndex);
    const period = cyclePeriodKey(w.cycleStart);
    const rows = (
      await ctx.db
        .query("payments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).filter((p) => p.projectId === ctx.projectId);
    const existingRows = rows.filter((p) => p.period === period);
    if (existingRows.some((p) => p.status === "paid")) {
      return { ok: true, alreadyPaid: true };
    }
    // Matérialise les paliers franchis AVANT le gel (Guard A intra-cycle).
    await syncBonusUnlocks(ctx, ctx.projectId, creatorId);
    const breakdown = await computeCyclePricingBreakdown(
      ctx,
      ctx.projectId,
      creatorId,
      creator.firstPostAt,
      cycleIndex,
      new Set(),
    );
    // lineItems LEGACY (modèle RepackIt) appartenant à CE cycle (via le cycle de
    // publi de leur assignment) : CAPTURÉES dans la row gelée + RETIRÉES de leur
    // row source (accruing) → pas de double compte, le total du cycle est exact.
    const assignments = (
      await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).filter((a) => a.projectId === ctx.projectId);
    const cycleOfAssignment = new Map(
      assignments.map((a) => [
        a._id,
        cycleIndexOf(creator.firstPostAt!, assignmentPublishedAt(a)),
      ]),
    );
    const legacyOfCycle: LineItem[] = [];
    for (const r of rows) {
      if (r.status === "paid" || r.period === period) continue;
      const keep: LineItem[] = [];
      let moved = false;
      for (const li of r.lineItems) {
        const cyc =
          li.assignmentId !== undefined
            ? cycleOfAssignment.get(li.assignmentId)
            : undefined;
        if (li.assignmentId !== undefined && cyc === cycleIndex) {
          legacyOfCycle.push(li);
          moved = true;
        } else {
          keep.push(li);
        }
      }
      if (moved) {
        await ctx.db.patch(r._id, {
          lineItems: keep,
          totalDue: recomputeTotal(keep),
        });
      }
    }
    const frozen = [...legacyOfCycle, ...frozenLineItemsFromBreakdown(breakdown)];
    const now = Date.now();
    const target = existingRows[0];
    if (target) {
      const lineItems = [...target.lineItems, ...frozen];
      await ctx.db.patch(target._id, {
        status: "paid",
        paidAt: now,
        lineItems,
        totalDue: recomputeTotal(lineItems),
      });
    } else {
      await ctx.db.insert("payments", {
        projectId: ctx.projectId,
        creatorId,
        period,
        lineItems: frozen,
        totalDue: recomputeTotal(frozen),
        status: "paid",
        paidAt: now,
        createdAt: now,
      });
    }
    return { ok: true, alreadyPaid: false };
  },
});

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

// ─── Backfill one-shot — ancre firstPostAt (cycle J+30) ───────────────────────

/**
 * BACKFILL idempotent de creators.firstPostAt : pour chaque créateur ayant ≥1
 * publication published/paid mais PAS encore de firstPostAt, pose firstPostAt =
 * date de sa 1re publication (min assignmentPublishedAt). FIGÉ ensuite (jamais
 * réécrit — un créateur avec firstPostAt est SKIPPÉ). Ne touche AUCUNE paie (rien
 * n'est versé) : ne fait que poser l'ancre du cycle. Créateur sans post publié →
 * skippé (pas de cycle, pas de date fantôme).
 *
 * Runnable post-merge : `npx convex run payments:backfillFirstPostAt` (dev puis --prod).
 */
export const backfillFirstPostAt = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ updated: number; skipped: number }> => {
    const creators = await ctx.db.query("creators").collect();
    let updated = 0;
    let skipped = 0;
    for (const creator of creators) {
      if (creator.firstPostAt !== undefined) {
        skipped++; // ancre déjà posée → figée, jamais réécrite
        continue;
      }
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
        .collect();
      const published = assignments.filter(
        (a) => a.status === "published" || a.status === "paid",
      );
      if (published.length === 0) {
        skipped++; // aucun post publié → pas d'ancre (pas de cycle)
        continue;
      }
      const firstPostAt = Math.min(
        ...published.map((a) => assignmentPublishedAt(a)),
      );
      await ctx.db.patch(creator._id, { firstPostAt });
      updated++;
    }
    return { updated, skipped };
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
