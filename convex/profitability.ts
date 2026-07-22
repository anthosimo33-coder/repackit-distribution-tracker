import { adminQuery } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { computeLivePricingBreakdown, assignmentPublishedAt } from "./pricing";
import { periodOf } from "./payments";
import { summarizeWhopRevenue } from "./whopRevenue";

/**
 * Rentabilité par PROJET (rentabilité P3) — met en face le REVENU Whop net
 * (prompt 2) et le COÛT créateurs (moteur de paie, prompt 1 : posts warmup déjà
 * exclus du coût) → MARGE, + les vues ventilées (monétisées / warmup) pour le RPM.
 *
 * Périmètre = CALENDAIRE (mois UTC, aligné sur periodOf) pour un face-à-face
 * cohérent avec le revenu Whop (mensuel). Le COÛT réutilise le MÊME moteur que
 * les Paiements (computeLivePricingBreakdown → computeMonthlyPayout) — mêmes
 * montants par vidéo, seule la fenêtre est le mois calendaire (≠ cycle J+30 de la
 * page Paiements). AUCUN recalcul divergent. Le calcul marge/RPM + le TOGGLE
 * warmup vivent côté client (lib/profitability) : ici on ne renvoie que des
 * nombres bruts (revenu/coût constants + vues ventilées).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Coût créateurs d'UN créateur, ventilé par mois de publication (UTC). Réutilise
 * computeLivePricingBreakdown (fixe + CPM + bonus paliers cash), appelé UNIQUEMENT
 * sur les mois où le créateur a de l'activité (mois de publi d'un assignment
 * pricing OU mois d'attribution d'un bonus cash) → borne les lectures.
 * `legacyAssignmentIds` vide : les projets Whop sont en pricing v2 (aucune
 * lineItem legacy base/bonus à exclure — le coût = fixe/CPM/bonus, cf brief).
 */
async function creatorCostByMonth(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creator: Doc<"creators">,
): Promise<Map<string, number>> {
  const assignments = (
    await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect()
  ).filter(
    (a) =>
      a.projectId === projectId &&
      a.pricingSnapshot !== undefined &&
      (a.status === "published" || a.status === "paid"),
  );
  const activeMonths = new Set<string>();
  for (const a of assignments) {
    activeMonths.add(periodOf(assignmentPublishedAt(a)));
  }
  // Un bonus cash peut être attribué à un mois SANS nouvelle publication (rollover).
  const unlocks = (
    await ctx.db
      .query("bonusUnlocks")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect()
  ).filter((u) => u.projectId === projectId && u.rewardType === "cash");
  for (const u of unlocks) activeMonths.add(u.attributionPeriod);

  const out = new Map<string, number>();
  for (const month of activeMonths) {
    const bd = await computeLivePricingBreakdown(
      ctx,
      projectId,
      creator._id,
      month,
      new Set(),
    );
    if (bd.total > 0) out.set(month, bd.total);
  }
  return out;
}

/**
 * Rentabilité du projet : revenu net + coût créateurs par mois (+ total), et vues
 * ventilées monétisées/warmup (total). Le client dérive marge = revenu − coût
 * (INVARIANT) et RPM = revenu / (vues / 1000) où les vues dépendent du toggle
 * warmup (lib/profitability). `configured` = false → pas de mapping Whop (l'UI
 * masque la rentabilité). Ne lit QUE le projet courant.
 */
export const getProjectProfitability = adminQuery({
  args: {},
  handler: async (ctx) => {
    const project = await ctx.db.get(ctx.projectId);
    // Rentabilité = Whop-gated : sans mapping, on court-circuite AVANT tout calcul
    // coûteux (le coût créateurs itère créateurs × mois). L'UI masque la carte.
    if (project?.whop === undefined) {
      return {
        configured: false as const,
        currency: null as string | null,
        currentPeriod: periodOf(Date.now()),
        total: {
          revenueNet: 0,
          creatorCost: 0,
          monetizedViews: 0,
          warmupViews: 0,
        },
        months: [] as Array<{
          period: string;
          revenueNet: number;
          creatorCost: number;
          monetizedViews: number;
          warmupViews: number;
        }>,
      };
    }

    // ─── Revenu Whop net par mois (paidAt) — CONSTANT vis-à-vis du toggle ──────
    const whopRows = await ctx.db
      .query("whopPayments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const revByMonth = new Map<string, Doc<"whopPayments">[]>();
    for (const r of whopRows) {
      const m = periodOf(r.paidAt);
      const arr = revByMonth.get(m);
      if (arr) arr.push(r);
      else revByMonth.set(m, [r]);
    }
    const revenueNetByMonth = new Map<string, number>();
    for (const [m, list] of revByMonth) {
      revenueNetByMonth.set(m, summarizeWhopRevenue(list).net);
    }
    const totalRevenue = summarizeWhopRevenue(whopRows);

    // ─── Coût créateurs par mois (MÊME moteur que les Paiements) ───────────────
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const costByMonth = new Map<string, number>();
    for (const c of creators) {
      const cm = await creatorCostByMonth(ctx, ctx.projectId, c);
      for (const [m, amt] of cm) {
        costByMonth.set(m, round2((costByMonth.get(m) ?? 0) + amt));
      }
    }
    const totalCost = round2(
      [...costByMonth.values()].reduce((s, a) => s + a, 0),
    );

    // ─── Vues ventilées monétisées (non-warmup) / warmup — DÉNOMINATEUR du RPM ─
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const viewsByMonth = new Map<
      string,
      { monetizedViews: number; warmupViews: number }
    >();
    let totMonetized = 0;
    let totWarmup = 0;
    for (const p of pubs) {
      const v = p.vuesLatest ?? 0;
      const m = periodOf(p.datePubli);
      const bucket = viewsByMonth.get(m) ?? {
        monetizedViews: 0,
        warmupViews: 0,
      };
      if (p.isWarmup === true) {
        bucket.warmupViews += v;
        totWarmup += v;
      } else {
        bucket.monetizedViews += v;
        totMonetized += v;
      }
      viewsByMonth.set(m, bucket);
    }

    // ─── Assemblage (mois présents dans revenu, coût OU vues), plus récent d'abord ─
    const allPeriods = new Set<string>([
      ...revenueNetByMonth.keys(),
      ...costByMonth.keys(),
      ...viewsByMonth.keys(),
    ]);
    const months = [...allPeriods]
      .sort((a, b) => (a < b ? 1 : -1))
      .map((period) => ({
        period,
        revenueNet: revenueNetByMonth.get(period) ?? 0,
        creatorCost: costByMonth.get(period) ?? 0,
        monetizedViews: viewsByMonth.get(period)?.monetizedViews ?? 0,
        warmupViews: viewsByMonth.get(period)?.warmupViews ?? 0,
      }));

    return {
      configured: project?.whop !== undefined,
      currency: totalRevenue.currency,
      currentPeriod: periodOf(Date.now()),
      total: {
        revenueNet: totalRevenue.net,
        creatorCost: totalCost,
        monetizedViews: totMonetized,
        warmupViews: totWarmup,
      },
      months,
    };
  },
});
