import { adminQuery } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { computeLivePricingBreakdown, assignmentPublishedAt } from "./pricing";
import { monthKeyParis } from "./dateFr";
import { summarizeWhopRevenue } from "./whopRevenue";
import { collectProjectWhopPayments } from "./whopPaymentsAccess";
import {
  payWindowEndsAt,
  payWindowIsClosed,
  retainedViews,
} from "./payWindow";

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
 * Les VUES du dénominateur sont celles qu'on a réellement PAYÉES, au sens plein :
 * retenues à J+30 (`retainedViews`) ET bornées au plafond de 150 $/vidéo
 * (`billedViews`, produit par le moteur lui-même). Les deux colonnes d'une même
 * ligne décrivent donc le même ensemble de vues — sinon la marge et le RPM ne
 * parlent pas de la même chose, et une vidéo virale déjà plafonnée fait chuter le
 * RPM sans coûter un centime.
 *
 * Le calcul marge/RPM + le TOGGLE vivent côté client (lib/profitability) : ici on
 * ne renvoie que des nombres bruts (revenu/coût constants + vues ventilées).
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
): Promise<Map<string, { cost: number; billedViews: number }>> {
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

  const out = new Map<string, { cost: number; billedViews: number }>();
  for (const month of activeMonths) {
    const bd = await computeLivePricingBreakdown(
      ctx,
      projectId,
      creator._id,
      month,
      new Set(),
      monthKeyParis,
    );
    // Les vues FACTURÉES viennent du MÊME appel que le coût : c'est la seule
    // façon que le dénominateur du RPM et son numérateur décrivent le même
    // ensemble. Un mois à coût nul peut porter des vues (barème à taux nul) et
    // l'inverse (bonus de palier sans publication) — d'où les deux conditions.
    const billedViews = bd.perAssignment.reduce((sum, a) => sum + a.billedViews, 0);
    if (bd.total > 0 || billedViews > 0) {
      out.set(month, { cost: bd.total, billedViews });
    }
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
    const billedByMonth = new Map<string, number>();
    for (const c of creators) {
      const cm = await creatorCostByMonth(ctx, ctx.projectId, c);
      for (const [m, { cost, billedViews }] of cm) {
        costByMonth.set(m, round2((costByMonth.get(m) ?? 0) + cost));
        billedByMonth.set(m, (billedByMonth.get(m) ?? 0) + billedViews);
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
    // Vues RETENUES (plafond J+30), pas vues MESURÉES — MÊME assiette que le
    // coût, qui passe déjà par `retainedViews` (convex/pricing). Sans ça, le
    // numérateur d'un mois écoulé est figé pendant que son dénominateur continue
    // de grossir : le RPM d'août baissait tout seul, tous les jours, sans qu'une
    // seule décision ait été prise (−0,19 € en 24 h, mesuré les 02→03/09/2026,
    // +125 832 vues dont 107 400 sur une seule vidéo publiée le 31/08).
    //
    // Une fenêtre OUVERTE retient les vues mesurées : aucune lecture de snapshot
    // n'est nécessaire. On n'interroge `metricSnapshots` que pour les posts dont
    // la fenêtre est CLOSE (51 sur 343 en prod le 03/09/2026) — le coût de la
    // query reste donc proportionnel à ce qui est réellement figé, pas au stock.
    const now = Date.now();
    const retainedOf = async (p: Doc<"publications">): Promise<number> => {
      const measured = p.vuesLatest ?? 0;
      if (!payWindowIsClosed(p.datePubli, now)) return measured;
      const windowSnapshot = await ctx.db
        .query("metricSnapshots")
        .withIndex("by_publication_and_capturedAt", (q) =>
          q
            .eq("publicationId", p._id)
            .lt("capturedAt", payWindowEndsAt(p.datePubli)),
        )
        .order("desc")
        .first();
      return retainedViews({
        datePubli: p.datePubli,
        measuredViews: measured,
        windowSnapshot,
        now,
      }).views;
    };
    const retainedById = new Map<string, number>();
    for (const p of pubs) retainedById.set(p._id, await retainedOf(p));
    const allViewsOf = (list: typeof pubs) =>
      list.reduce((s, p) => s + (retainedById.get(p._id) ?? 0), 0);

    // ─── PAYÉES = vues FACTURÉES, plafond 150 $/vidéo compris ────────────────
    // Elles viennent de `billedByMonth`, c'est-à-dire du MÊME appel au moteur que
    // le coût. Au-delà du seuil où une vidéo atteint le plafond, chaque vue
    // supplémentaire est GRATUITE : la compter au dénominateur fait baisser le
    // RPM sans qu'un centime ait été dépensé. Mesuré en prod le 03/09/2026 :
    // 2 vidéos sur 128 portaient 248 489 vues gratuites en août (20 % du mois),
    // et l'une d'elles a fait tomber le RPM de 1,88 € à 1,69 € en 24 h pour 0 $.
    //
    // `viewsSplitOf` (coupure isRemunerated) n'est donc plus la source du
    // dénominateur ; il reste celle des vues TOTALES, dont on déduit les non
    // rémunérées. Le `max(0, …)` est une ceinture : les vues facturées sont
    // bornées par les vues payables, elles-mêmes bornées par les vues retenues du
    // même mois — la soustraction ne peut pas passer sous zéro sans un décalage
    // de mois entre un assignment et ses posts (aucun en prod le 03/09).
    const viewsByMonth = new Map<
      string,
      { paidViews: number; unpaidViews: number }
    >();
    for (const [m, list] of pubsByMonth) {
      const paid = billedByMonth.get(m) ?? 0;
      viewsByMonth.set(m, {
        paidViews: paid,
        unpaidViews: Math.max(0, allViewsOf(list) - paid),
      });
    }
    // Un mois peut porter des vues FACTURÉES sans aucune publication rangée sous
    // lui (bonus attribué à une période persistée en UTC) : sans cette boucle, sa
    // ligne afficherait un coût et zéro vue.
    for (const [m, paid] of billedByMonth) {
      if (!viewsByMonth.has(m)) {
        viewsByMonth.set(m, { paidViews: paid, unpaidViews: 0 });
      }
    }
    // Totaux recalculés sur TOUT le lot, jamais sommés depuis les mois.
    const totPaid = [...billedByMonth.values()].reduce((s, v) => s + v, 0);
    const totUnpaid = Math.max(0, allViewsOf(pubs) - totPaid);

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
