import { adminMutation, adminQuery, e2eMutation } from "./functions";
import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { periodOf } from "./payments";

/**
 * Pricing — barèmes de rémunération + MOTEUR de paie (réplique serveur).
 *
 * ⚠️ ARGENT. computeMonthlyPayout / assignmentCpm / assignmentBonus DOIVENT
 * rester IDENTIQUES à lib/pricing-engine.ts (testé Vitest ; règle A6 — un module
 * convex/ ne peut pas importer lib/). Toute évolution = des DEUX côtés.
 *
 * ⚠️ TS7022 — computeLivePricingBreakdown est annoté (consommé par payments.ts).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PricingSnapshot = {
  pricingId: Id<"pricings">;
  montantFixe: number;
  nbVideosCible: number;
  tauxCPM: number;
  seuilBonusVues: number;
  montantBonus: number;
};

type PayoutItem = {
  assignmentId: string;
  snapshot: PricingSnapshot;
  totalViews: number;
};

export type PerPricing = {
  pricingId: string;
  videoCount: number;
  nbVideosCible: number;
  montantFixe: number;
  fixePerVideo: number;
  fixed: number;
  cpm: number;
  bonus: number;
};

export interface MonthlyPayout {
  fixedTotal: number;
  cpmTotal: number;
  bonusTotal: number;
  total: number;
  perPricing: PerPricing[];
  perAssignment: {
    assignmentId: string;
    pricingId: string;
    totalViews: number;
    cpm: number;
    bonus: number;
  }[];
}

export function assignmentCpm(snapshot: PricingSnapshot, totalViews: number): number {
  const v = Math.max(0, totalViews);
  return round2((v / 1000) * snapshot.tauxCPM);
}

export function assignmentBonus(snapshot: PricingSnapshot, totalViews: number): number {
  const v = Math.max(0, totalViews);
  return v >= snapshot.seuilBonusVues ? round2(snapshot.montantBonus) : 0;
}

function fixePerVideo(snapshot: PricingSnapshot): number {
  if (!(snapshot.nbVideosCible > 0)) return 0;
  return snapshot.montantFixe / snapshot.nbVideosCible;
}

/** RÉPLIQUE de lib/pricing-engine.computeMonthlyPayout (DOIT rester identique). */
export function computeMonthlyPayout(items: PayoutItem[]): MonthlyPayout {
  const groups = new Map<string, PayoutItem[]>();
  for (const it of items) {
    const arr = groups.get(it.snapshot.pricingId);
    if (arr) arr.push(it);
    else groups.set(it.snapshot.pricingId, [it]);
  }
  const perPricing: MonthlyPayout["perPricing"] = [];
  const perAssignment: MonthlyPayout["perAssignment"] = [];
  let fixedTotal = 0;
  let cpmTotal = 0;
  let bonusTotal = 0;
  for (const [pricingId, groupItems] of groups) {
    const snapshot = groupItems[0].snapshot;
    const perVideo = fixePerVideo(snapshot);
    const videoCount = groupItems.length;
    const fixed = round2(Math.min(videoCount * perVideo, snapshot.montantFixe));
    let groupCpm = 0;
    let groupBonus = 0;
    for (const it of groupItems) {
      const cpm = assignmentCpm(it.snapshot, it.totalViews);
      const bonus = assignmentBonus(it.snapshot, it.totalViews);
      groupCpm = round2(groupCpm + cpm);
      groupBonus = round2(groupBonus + bonus);
      perAssignment.push({
        assignmentId: it.assignmentId,
        pricingId: it.snapshot.pricingId,
        totalViews: Math.max(0, it.totalViews),
        cpm,
        bonus,
      });
    }
    perPricing.push({
      pricingId,
      videoCount,
      nbVideosCible: snapshot.nbVideosCible,
      montantFixe: snapshot.montantFixe,
      fixePerVideo: round2(perVideo),
      fixed,
      cpm: groupCpm,
      bonus: groupBonus,
    });
    fixedTotal = round2(fixedTotal + fixed);
    cpmTotal = round2(cpmTotal + groupCpm);
    bonusTotal = round2(bonusTotal + groupBonus);
  }
  return {
    fixedTotal,
    cpmTotal,
    bonusTotal,
    total: round2(fixedTotal + cpmTotal + bonusTotal),
    perPricing,
    perAssignment,
  };
}

// ─── Vues + période d'un assignment ──────────────────────────────────────────

/** Date de publication d'un assignment = la PLUS PRÉCOCE de ses cibles (toutes
 *  publiées le même jour par confirmPublication), fallback legacy/createdAt. */
function assignmentPublishedAt(a: Doc<"assignments">): number {
  const ts = (a.targets ?? [])
    .map((t) => t.publishedAt)
    .filter((x): x is number => typeof x === "number");
  if (ts.length > 0) return Math.min(...ts);
  return a.publishedAt ?? a.createdAt;
}

/** Vues TOTALES d'un assignment = somme des vuesLatest de ses publications. */
async function assignmentTotalViews(
  ctx: QueryCtx | MutationCtx,
  a: Doc<"assignments">,
): Promise<number> {
  const pubIds = [
    ...(a.targets ?? []).map((t) => t.publicationId),
    a.publicationId,
  ].filter((p): p is Id<"publications"> => p !== undefined);
  let total = 0;
  const seen = new Set<string>();
  for (const pid of pubIds) {
    if (seen.has(pid)) continue;
    seen.add(pid);
    const pub = await ctx.db.get(pid);
    total += pub?.vuesLatest ?? 0;
  }
  return total;
}

/**
 * Paie PRICING (live) d'un (créateur, projet, mois) — SOURCE UNIQUE consommée
 * par la lecture (getMyPayments/listPayments) ET le gel au paiement. Collecte
 * les assignments PUBLIÉS/PAYÉS portant un pricingSnapshot dont le mois de
 * publication = `period`, somme leurs vues, et applique le moteur. Guard B :
 * exclut tout assignment qui porterait déjà une lineItem legacy (base/bonus) de
 * la période → les deux modèles restent disjoints (0 double paiement).
 */
export async function computeLivePricingBreakdown(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  period: string,
  legacyAssignmentIds: Set<string>,
): Promise<MonthlyPayout> {
  const assignments = (
    await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter(
    (a) =>
      a.projectId === projectId &&
      a.pricingSnapshot !== undefined &&
      (a.status === "published" || a.status === "paid") &&
      periodOf(assignmentPublishedAt(a)) === period &&
      !legacyAssignmentIds.has(a._id),
  );
  const items: PayoutItem[] = [];
  for (const a of assignments) {
    items.push({
      assignmentId: a._id,
      snapshot: a.pricingSnapshot!,
      totalViews: await assignmentTotalViews(ctx, a),
    });
  }
  return computeMonthlyPayout(items);
}

/**
 * Charge un pricing ACTIF du projet et FIGE son snapshot (Guard A — posé une
 * seule fois à l'attribution, immuable ensuite). Utilisé par assignFormat /
 * assignScriptCampaign.
 */
export async function buildPricingSnapshot(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  pricingId: Id<"pricings">,
): Promise<PricingSnapshot> {
  const pricing = await ctx.db.get(pricingId);
  if (!pricing || pricing.projectId !== projectId) {
    throw new ConvexError("Pricing introuvable dans le projet.");
  }
  if (pricing.status !== "active") {
    throw new ConvexError("Pricing archivé : réactive-le pour l'attribuer.");
  }
  return {
    pricingId: pricing._id,
    montantFixe: pricing.montantFixe,
    nbVideosCible: pricing.nbVideosCible,
    tauxCPM: pricing.tauxCPM,
    seuilBonusVues: pricing.seuilBonusVues,
    montantBonus: pricing.montantBonus,
  };
}

// ─── CRUD admin (scopé projet) ───────────────────────────────────────────────

function validatePricingFields(args: {
  name: string;
  montantFixe: number;
  nbVideosCible: number;
  tauxCPM: number;
  seuilBonusVues: number;
  montantBonus: number;
}): {
  name: string;
  montantFixe: number;
  nbVideosCible: number;
  tauxCPM: number;
  seuilBonusVues: number;
  montantBonus: number;
} {
  const name = args.name.trim();
  if (name.length === 0) throw new ConvexError("Le nom du pricing est requis.");
  if (!Number.isInteger(args.nbVideosCible) || args.nbVideosCible < 1) {
    throw new ConvexError("nbVideosCible doit être un entier ≥ 1.");
  }
  for (const [label, val] of [
    ["montantFixe", args.montantFixe],
    ["tauxCPM", args.tauxCPM],
    ["seuilBonusVues", args.seuilBonusVues],
    ["montantBonus", args.montantBonus],
  ] as const) {
    if (!Number.isFinite(val) || val < 0) {
      throw new ConvexError(`${label} doit être un nombre ≥ 0.`);
    }
  }
  return { ...args, name };
}

/** Le pricing est-il attribué à au moins un assignment du projet ? */
async function pricingInUse(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  pricingId: Id<"pricings">,
): Promise<boolean> {
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return assignments.some((a) => a.pricingSnapshot?.pricingId === pricingId);
}

const PRICING_ARGS = {
  name: v.string(),
  montantFixe: v.number(),
  nbVideosCible: v.number(),
  tauxCPM: v.number(),
  seuilBonusVues: v.number(),
  montantBonus: v.number(),
};

export const createPricing = adminMutation({
  args: PRICING_ARGS,
  handler: async (ctx, args) => {
    const fields = validatePricingFields(args);
    const pricingId = await ctx.db.insert("pricings", {
      projectId: ctx.projectId,
      ...fields,
      status: "active",
      createdAt: Date.now(),
    });
    return { pricingId };
  },
});

export const updatePricing = adminMutation({
  args: { id: v.id("pricings"), ...PRICING_ARGS },
  handler: async (ctx, { id, ...args }) => {
    const pricing = await ctx.db.get(id);
    if (!pricing || pricing.projectId !== ctx.projectId) {
      throw new ConvexError("Pricing introuvable.");
    }
    const fields = validatePricingFields(args);
    // Snapshot figé sur les assignments → modifier n'affecte QUE les futures
    // attributions (jamais les vidéos déjà attribuées).
    await ctx.db.patch(id, fields);
    return { ok: true };
  },
});

export const archivePricing = adminMutation({
  args: { id: v.id("pricings"), archived: v.boolean() },
  handler: async (ctx, { id, archived }) => {
    const pricing = await ctx.db.get(id);
    if (!pricing || pricing.projectId !== ctx.projectId) {
      throw new ConvexError("Pricing introuvable.");
    }
    await ctx.db.patch(id, { status: archived ? "archived" : "active" });
    return { ok: true };
  },
});

export const deletePricing = adminMutation({
  args: { id: v.id("pricings") },
  handler: async (ctx, { id }) => {
    const pricing = await ctx.db.get(id);
    if (!pricing || pricing.projectId !== ctx.projectId) {
      throw new ConvexError("Pricing introuvable.");
    }
    if (await pricingInUse(ctx, ctx.projectId, id)) {
      throw new ConvexError(
        "Ce pricing est attribué à des vidéos — archive-le plutôt que de le supprimer.",
      );
    }
    await ctx.db.delete(id);
    return { ok: true };
  },
});

/** Pricings du projet (admin). includeArchived=false → actifs seuls. */
export const listPricings = adminQuery({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, { includeArchived }) => {
    const all = await ctx.db
      .query("pricings")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const rows = includeArchived
      ? all
      : all.filter((p) => p.status === "active");
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Supprime les pricings de test ([E2E_TEST]). Gated E2E. */
export const cleanupTestPricings = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("pricings").collect();
    let deleted = 0;
    for (const p of all) {
      if (!p.name.startsWith("[E2E_TEST]")) continue;
      await ctx.db.delete(p._id);
      deleted++;
    }
    return { deleted };
  },
});
