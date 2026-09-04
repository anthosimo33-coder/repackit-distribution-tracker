import {
  permissionQuery,
} from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { computeLivePricingBreakdown, assignmentPublishedAt } from "./pricing";
import { monthKeyParis } from "./dateFr";
import { summarizeWhopRevenue } from "./whopRevenue";
import { collectProjectWhopPayments } from "./whopPaymentsAccess";
import { viewsSplitOf } from "./viewCounters";

/**
 * Rentabilité par PROJET (rentabilité P3) — met en face le REVENU Whop net
 * (prompt 2) et le COÛT créateurs (moteur de paie, prompt 1 : posts warmup déjà
 * exclus du coût) → MARGE, + les vues ventilées (monétisées / warmup) pour le RPM.
 *
 * Périmètre = CALENDAIRE (mois EUROPE/PARIS, `monthKeyParis`) pour un face-à-face
 * cohérent avec le revenu Whop (mensuel), que Whop découpe en heure locale.
 * Les TROIS colonnes (revenu, coût, vues) partagent cette clé : sans ça, une
 * vidéo publiée le 1er à 00:03 Paris met ses vues dans un mois et son coût dans
 * l'autre. Le coût passe toujours par le MÊME moteur que les Paiements ; c'est la
 * clé de mois qui lui est injectée, pas son calcul.
 *
 * Le COÛT réutilise le MÊME moteur que les Paiements (computeLivePricingBreakdown
 * → computeMonthlyPayout) — mêmes montants par vidéo, seule la fenêtre est le mois
 * calendaire (≠ cycle J+30 de la page Paiements). AUCUN recalcul divergent.
 *
 * Le calcul marge/RPM + le TOGGLE warmup vivent côté client (lib/profitability) : ici on ne renvoie que des
 * nombres bruts (revenu/coût constants + vues ventilées).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Coût créateurs d'UN créateur, ventilé par mois de publication (EUROPE/PARIS,
 * cf en-tête de fichier — `monthKeyParis` est injecté dans le moteur). Réutilise
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
    activeMonths.add(monthKeyParis(assignmentPublishedAt(a)));
  }
  // Un bonus cash peut être attribué à un mois SANS nouvelle publication (rollover).
  // ⚠️ `attributionPeriod` est une chaîne PERSISTÉE, dérivée en UTC à l'accrual, et
  // aucun timestamp ne l'accompagne : elle ne peut pas être re-clée en Paris. Un
  // bonus attribué dans les 2 h qui précèdent minuit UTC reste donc rangé sous son
  // mois UTC. Résidu assumé — le corriger voudrait dire réécrire des périodes de
  // paie déjà émises, ce qu'on ne fait pas pour un libellé d'écran.
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
      monthKeyParis,
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
export const getProjectProfitability = permissionQuery("business.read")({
  args: {},
  handler: async (ctx) => {
    const project = await ctx.db.get(ctx.projectId);
    // Rentabilité = Whop-gated : sans mapping, on court-circuite AVANT tout calcul
    // coûteux (le coût créateurs itère créateurs × mois). L'UI masque la carte.
    if (project?.whop === undefined) {
      return {
        configured: false as const,
        currency: null as string | null,
        mixedCurrency: false,
        mixedCurrencyPresent: false,
        currenciesPresent: [] as string[],
        payCurrency: (project?.payCurrency ?? null) as string | null,
        fxRateToRevenue: (project?.fxRateToRevenue ?? null) as number | null,
        currentPeriod: monthKeyParis(Date.now()),
        total: {
          revenueNet: 0,
          creatorCost: 0,
          paidViews: 0,
          unpaidViews: 0,
        },
        months: [] as Array<{
          period: string;
          revenueNet: number;
          mixedCurrency: boolean;
          creatorCost: number;
          paidViews: number;
          unpaidViews: number;
        }>,
      };
    }

    // ─── Revenu Whop net par mois (paidAt) — CONSTANT vis-à-vis du toggle ──────
    // A4 — abonnements internes exclus via le point de passage unique. Ce site
    // ne filtrait pas : la MARGE affichée intégrait le revenu du compte de test.
    const { payments: whopRows } = await collectProjectWhopPayments(
      ctx,
      ctx.projectId,
      project?.slug ?? "",
    );
    const revByMonth = new Map<string, Doc<"whopPayments">[]>();
    for (const r of whopRows) {
      const m = monthKeyParis(r.paidAt);
      const arr = revByMonth.get(m);
      if (arr) arr.push(r);
      else revByMonth.set(m, [r]);
    }
    const revenueNetByMonth = new Map<string, number>();
    // Le drapeau A5 est conservé PAR MOIS : la marge et le RPM sont recalculés
    // mois par mois côté client, un mois bi-devise doit donc pouvoir s'abstenir
    // seul, sans effacer les mois voisins qui sont parfaitement calculables.
    const mixedByMonth = new Map<string, boolean>();
    for (const [m, list] of revByMonth) {
      const s = summarizeWhopRevenue(list);
      revenueNetByMonth.set(m, s.net);
      mixedByMonth.set(m, s.mixedCurrency);
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

    // ─── Vues ventilées RÉMUNÉRÉES / non rémunérées — DÉNOMINATEUR du RPM ─────
    // La coupure est le fait FINANCIER (viewsSplitOf → isRemunerated), pas le fait
    // éditorial. Ce site testait `p.isWarmup === true` en dur, ce que l'en-tête de
    // convex/viewCounters interdit précisément.
    //
    // Le défaut jouait dans les DEUX sens, mesuré sur la prod du 2026-09-02 :
    //   - un post retiré de la paie à la main (remunere=false) restait au
    //     dénominateur — 277 857 vues en août, 23 % du mois ;
    //   - un post warmup explicitement PAYÉ (cas Kelly, remunere=true) en était
    //     absent — 694 000 vues sur juillet à lui seul.
    // Le RPM n'était donc ni sur- ni sous-estimé de façon systématique : il était
    // calculé sur un ensemble qui n'était celui d'aucune des deux questions.
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const pubsByMonth = new Map<string, typeof pubs>();
    for (const p of pubs) {
      const m = monthKeyParis(p.datePubli);
      const arr = pubsByMonth.get(m);
      if (arr) arr.push(p);
      else pubsByMonth.set(m, [p]);
    }
    const asItems = (list: typeof pubs) =>
      list.map((p) => ({
        isWarmup: p.isWarmup === true,
        remunere: p.remunere,
        views: p.vuesLatest ?? 0,
      }));
    const viewsByMonth = new Map<
      string,
      { paidViews: number; unpaidViews: number }
    >();
    for (const [m, list] of pubsByMonth) {
      viewsByMonth.set(m, viewsSplitOf(asItems(list)));
    }
    // Total recalculé sur TOUT le lot, jamais sommé depuis les mois : une
    // publication hors des mois retenus resterait comptée dans le total.
    const { paidViews: totPaid, unpaidViews: totUnpaid } =
      viewsSplitOf(asItems(pubs));

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
        mixedCurrency: mixedByMonth.get(period) ?? false,
        creatorCost: costByMonth.get(period) ?? 0,
        paidViews: viewsByMonth.get(period)?.paidViews ?? 0,
        unpaidViews: viewsByMonth.get(period)?.unpaidViews ?? 0,
      }));

    return {
      configured: project?.whop !== undefined,
      // Devise du REVENU (Whop) ; la paie créatrices a la sienne (payCurrency).
      currency: totalRevenue.currency,
      payCurrency: project?.payCurrency ?? null,
      // Taux paie→revenu pour la marge (revenu € − coût $ converti). null → marge
      // non calculée (jamais soustraire deux devises sans conversion).
      fxRateToRevenue: project?.fxRateToRevenue ?? null,
      currentPeriod: monthKeyParis(Date.now()),
      // A5 — le drapeau était calculé puis jeté : la carte affichait un revenu
      // zéroïsé (donc une marge très négative) comme s'il s'agissait d'un vrai
      // montant. Un chiffre faux est pire qu'un chiffre absent.
      mixedCurrency: totalRevenue.mixedCurrency,
      mixedCurrencyPresent: totalRevenue.mixedCurrencyPresent,
      currenciesPresent: totalRevenue.currenciesPresent,
      total: {
        revenueNet: totalRevenue.net,
        creatorCost: totalCost,
        paidViews: totPaid,
        unpaidViews: totUnpaid,
      },
      months,
    };
  },
});
