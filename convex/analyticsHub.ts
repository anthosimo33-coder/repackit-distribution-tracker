import { adminQuery } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assignmentPublishedAt,
  assignmentViewsAndMetrics,
  computeLivePricingBreakdown,
  type PricingBreakdown,
} from "./pricing";
import { periodOf } from "./payments";
import { summarizeWhopRevenue, whopNetContribution } from "./whopRevenue";
import {
  POSTHOG_CACHE_KEYS,
  type AttributionHourlyPayload,
} from "./posthogSync";

/**
 * Croisement Jarvia × PostHog × Whop du hub Analytics.
 *
 * Jarvia (posts/vues/coûts) est TOUJOURS disponible : ces queries ne sont
 * gatées ni par PostHog ni par Whop. Seules les colonnes d'attribution
 * (inscrits/abonnés) dépendent du cache PostHog, et seul le volet revenu dépend
 * de Whop — chacun tombe indépendamment sur `null` (= inconnu), jamais sur 0.
 *
 * ⚠️ COÛT — le moteur de paie ne produit PAS de coût par POST : le fixe est
 * mutualisé sur un groupe de pricing et le CPM se calcule sur les vues d'une
 * VIDÉO (un assignment = 1 à 3 posts multi-plateformes). L'unité de la table
 * d'attribution est donc la VIDÉO. Le coût d'une vidéo = fixe/vidéo de son
 * pricing + son CPM, lus tels quels dans computeLivePricingBreakdown (aucun
 * recalcul). Le bonus paliers est CRÉATEUR-niveau (pas rattachable à une vidéo)
 * → exclu de la ligne vidéo, inclus dans l'agrégat par créatrice.
 *
 * ⚠️ ATTRIBUTION — fenêtre 24 h après publication, volontairement approximative
 * (aucun lien tracké/UTM). Plusieurs vidéos publiées le même jour se partagent
 * les mêmes inscriptions : les chiffres sont des ORDRES DE GRANDEUR. L'UI doit
 * l'afficher explicitement.
 */

/** Fenêtre d'attribution après publication (heures). */
export const ATTRIBUTION_WINDOW_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

/** Statuts d'assignment porteurs de coût (même porte que le moteur de paie). */
function isCostBearing(a: Doc<"assignments">): boolean {
  return a.status === "published" || a.status === "paid";
}

export interface AttributionRow {
  assignmentId: string;
  creatorId: string;
  creatorName: string;
  formatName: string | null;
  langue: string | null;
  platforms: string[];
  postCount: number;
  publishedAt: number;
  period: string;
  /** Vues de TOUS les posts de la vidéo (warmup inclus) — affichage. */
  totalViews: number;
  /** Vues payables (posts non-warmup) — base du CPM. */
  payableViews: number;
  /** Vidéo entièrement warmup (exclue de la paie). */
  isWarmupOnly: boolean;
  /** Coût réel de la vidéo (fixe/vidéo + CPM). null = hors moteur v2 (legacy). */
  cost: number | null;
  /** Inscriptions dans les 24 h. null = fenêtre hors cache PostHog (inconnu). */
  attributedSignups: number | null;
  attributedSubs: number | null;
  /** false = les 24 h ne sont pas encore écoulées (attribution partielle). */
  windowComplete: boolean;
}

export interface AttributionResult {
  rows: AttributionRow[];
  /** true si le cache PostHog porte une série d'attribution exploitable. */
  attributionAvailable: boolean;
  posthogConfigured: boolean;
  computedAt: number | null;
  windowHours: number;
}

/**
 * Somme des seaux horaires couvrant [t, t + 24 h). Rend `null` si la fenêtre
 * sort de l'historique caché (publication plus ancienne que la série) — un 0
 * y serait un mensonge. `complete` = les 24 h sont entièrement couvertes.
 */
function windowCounts(
  hours: AttributionHourlyPayload["hours"],
  t: number,
): { signups: number; subs: number; complete: boolean } | null {
  if (hours.length === 0) return null;
  const first = hours[0].ts;
  const last = hours[hours.length - 1].ts;
  // Le seau du premier point couvre [first, first+1h) : une publication
  // antérieure n'est pas mesurable.
  if (t < first) return null;
  const from = Math.floor(t / HOUR_MS) * HOUR_MS;
  const to = t + ATTRIBUTION_WINDOW_HOURS * HOUR_MS;
  let signups = 0;
  let subs = 0;
  for (const h of hours) {
    if (h.ts < from) continue;
    if (h.ts >= to) break;
    signups += h.signups;
    subs += h.subs;
  }
  return { signups, subs, complete: last + HOUR_MS >= to };
}

/**
 * Table d'attribution : une ligne par VIDÉO publiée (cf en-tête). Les vues et le
 * coût viennent de Jarvia (toujours dispo) ; inscrits/abonnés du cache PostHog
 * (null tant que les events ne sont pas émis).
 */
export const getAttribution = adminQuery({
  args: {},
  handler: async (ctx): Promise<AttributionResult> => {
    const project = await ctx.db.get(ctx.projectId);

    const assignments = (
      await ctx.db
        .query("assignments")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    ).filter(isCostBearing);

    const [creators, formats] = await Promise.all([
      ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("formats")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);
    const creatorMap = new Map(creators.map((c) => [c._id as string, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id as string, f.name]));

    // Série horaire d'attribution (cache PostHog) — absente ⇒ colonnes à null.
    const cacheRow = await ctx.db
      .query("posthogCache")
      .withIndex("by_project_key", (q) =>
        q
          .eq("projectId", ctx.projectId)
          .eq("key", POSTHOG_CACHE_KEYS.attributionHourly),
      )
      .first();
    let hours: AttributionHourlyPayload["hours"] = [];
    if (cacheRow && cacheRow.json !== "") {
      try {
        hours = (JSON.parse(cacheRow.json) as AttributionHourlyPayload).hours ?? [];
      } catch {
        hours = [];
      }
    }

    // Coût : un breakdown par (créatrice, mois), mémoïsé — le moteur est la
    // SEULE source du chiffre (aucun recalcul ici).
    const breakdowns = new Map<string, PricingBreakdown>();
    const breakdownFor = async (
      creatorId: Id<"creators">,
      period: string,
    ): Promise<PricingBreakdown> => {
      const key = `${creatorId}:${period}`;
      const cached = breakdowns.get(key);
      if (cached) return cached;
      const b = await computeLivePricingBreakdown(
        ctx,
        ctx.projectId,
        creatorId,
        period,
        new Set(),
      );
      breakdowns.set(key, b);
      return b;
    };

    const rows: AttributionRow[] = [];
    for (const a of assignments) {
      const publishedAt = assignmentPublishedAt(a);
      const period = periodOf(publishedAt);
      const views = await assignmentViewsAndMetrics(ctx, a);

      // Métadonnées des posts de la vidéo (langue/plateformes/nombre).
      const pubIds = [
        ...(a.targets ?? []).map((t) => t.publicationId),
        a.publicationId,
      ].filter((p): p is Id<"publications"> => p !== undefined);
      const seen = new Set<string>();
      const platforms: string[] = [];
      let langue: string | null = null;
      let postCount = 0;
      for (const pid of pubIds) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        const pub = await ctx.db.get(pid);
        if (!pub) continue;
        postCount += 1;
        if (!platforms.includes(pub.plateforme)) platforms.push(pub.plateforme);
        if (langue === null) langue = pub.langue;
      }

      // Coût réel de la vidéo : fixe/vidéo de son pricing + son CPM.
      let cost: number | null = null;
      if (a.pricingSnapshot) {
        const b = await breakdownFor(a.creatorId, period);
        const perAssignment = b.perAssignment.find(
          (x) => x.assignmentId === (a._id as string),
        );
        const perPricing = b.perPricing.find(
          (p) => p.pricingId === (a.pricingSnapshot!.pricingId as string),
        );
        if (perAssignment || perPricing) {
          cost =
            Math.round(
              ((perPricing?.fixePerVideo ?? 0) + (perAssignment?.cpm ?? 0)) * 100,
            ) / 100;
        }
      }

      const w = windowCounts(hours, publishedAt);
      rows.push({
        assignmentId: a._id,
        creatorId: a.creatorId,
        creatorName:
          creatorMap.get(a.creatorId as string) ??
          a.creatorNameSnapshot ??
          "—",
        formatName: a.formatId
          ? (formatMap.get(a.formatId as string) ?? null)
          : null,
        langue,
        platforms,
        postCount,
        publishedAt,
        period,
        totalViews: views.totalViews,
        payableViews: views.payableViews,
        isWarmupOnly: !views.hasPayablePost,
        cost,
        attributedSignups: w ? w.signups : null,
        attributedSubs: w ? w.subs : null,
        windowComplete: w ? w.complete : false,
      });
    }

    // Tri par abonnés attribués décroissants (défaut du chantier), vues en
    // départage — une ligne sans attribution retombe derrière.
    rows.sort(
      (x, y) =>
        (y.attributedSubs ?? -1) - (x.attributedSubs ?? -1) ||
        y.totalViews - x.totalViews,
    );

    return {
      rows,
      attributionAvailable: hours.length > 0,
      posthogConfigured: project?.posthog !== undefined,
      computedAt: cacheRow?.computedAt ?? null,
      windowHours: ATTRIBUTION_WINDOW_HOURS,
    };
  },
});

// ─── Revenus (Whop) ──────────────────────────────────────────────────────────

export interface RevenuePeriod {
  period: string;
  net: number;
  /** Net des membres dont c'est le PREMIER paiement (nouveau revenu, approx). */
  newNet: number;
  /** Net des membres déjà vus auparavant (récurrent). */
  returningNet: number;
  /** Net non rattachable à un membre (membershipId absent) — ni nouveau ni récurrent. */
  unattributedNet: number;
  members: number;
}

export interface PlanEconomics {
  planId: string;
  members: number;
  netTotal: number;
  /** LTV RÉALISÉE = net cumulé / membres (pas de projection : sans signal de
   *  churn, une LTV prédictive serait inventée). */
  ltv: number | null;
}

export interface RevenueBreakdown {
  configured: boolean;
  currency: string | null;
  periods: RevenuePeriod[];
  plans: PlanEconomics[];
  /** Revenu net moyen par membre et par mois actif (dénominateur du payback). */
  monthlyArpu: number | null;
  /** LTV réalisée toutes offres confondues. */
  ltv: number | null;
  /**
   * false — le churn n'est PAS dérivable de whopPayments (aucun cycle de vie
   * d'abonnement, aucune annulation, aucun intervalle de plan). Les cartes de
   * churn attendent les events PostHog `subscription_cancelled`.
   */
  churnAvailable: boolean;
}

/**
 * Décomposition du revenu à partir du NET Whop DÉJÀ INGÉRÉ (aucune nouvelle
 * source). Le partage nouveau/récurrent s'appuie sur le premier paiement observé
 * par `membershipId` — approximation assumée et bornée à l'historique importé.
 */
export const getRevenueBreakdown = adminQuery({
  args: {},
  handler: async (ctx): Promise<RevenueBreakdown> => {
    const project = await ctx.db.get(ctx.projectId);
    if (!project?.whop) {
      return {
        configured: false,
        currency: null,
        periods: [],
        plans: [],
        monthlyArpu: null,
        ltv: null,
        churnAvailable: false,
      };
    }

    const payments = await ctx.db
      .query("whopPayments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();

    // Premier paiement ENCAISSÉ par membre → sépare nouveau vs récurrent.
    const firstSeen = new Map<string, number>();
    for (const p of payments) {
      if (!p.membershipId || whopNetContribution(p) <= 0) continue;
      const prev = firstSeen.get(p.membershipId);
      if (prev === undefined || p.paidAt < prev) {
        firstSeen.set(p.membershipId, p.paidAt);
      }
    }

    const byPeriod = new Map<string, Doc<"whopPayments">[]>();
    for (const p of payments) {
      const k = periodOf(p.paidAt);
      const list = byPeriod.get(k) ?? [];
      list.push(p);
      byPeriod.set(k, list);
    }

    const periods: RevenuePeriod[] = [...byPeriod.entries()]
      .map(([period, list]) => {
        let newNet = 0;
        let returningNet = 0;
        let unattributedNet = 0;
        const members = new Set<string>();
        for (const p of list) {
          const net = whopNetContribution(p);
          if (net <= 0) continue;
          if (!p.membershipId) {
            unattributedNet += net;
            continue;
          }
          members.add(p.membershipId);
          if (firstSeen.get(p.membershipId) === p.paidAt) newNet += net;
          else returningNet += net;
        }
        const round2 = (n: number) => Math.round(n * 100) / 100;
        return {
          period,
          net: summarizeWhopRevenue(list).net,
          newNet: round2(newNet),
          returningNet: round2(returningNet),
          unattributedNet: round2(unattributedNet),
          members: members.size,
        };
      })
      .sort((a, b) => (a.period < b.period ? 1 : -1));

    // LTV réalisée par plan : net cumulé rapporté au nombre de membres.
    const perMembership = new Map<
      string,
      { net: number; planId: string; months: Set<string> }
    >();
    for (const p of payments) {
      if (!p.membershipId) continue;
      const net = whopNetContribution(p);
      const cur = perMembership.get(p.membershipId) ?? {
        net: 0,
        planId: p.planId ?? "(sans plan)",
        months: new Set<string>(),
      };
      cur.net += net;
      if (net > 0) cur.months.add(periodOf(p.paidAt));
      perMembership.set(p.membershipId, cur);
    }

    const byPlan = new Map<string, { members: number; netTotal: number }>();
    for (const m of perMembership.values()) {
      const cur = byPlan.get(m.planId) ?? { members: 0, netTotal: 0 };
      cur.members += 1;
      cur.netTotal += m.net;
      byPlan.set(m.planId, cur);
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const plans: PlanEconomics[] = [...byPlan.entries()]
      .map(([planId, x]) => ({
        planId,
        members: x.members,
        netTotal: round2(x.netTotal),
        ltv: x.members > 0 ? round2(x.netTotal / x.members) : null,
      }))
      .sort((a, b) => b.netTotal - a.netTotal);

    const totalNet = [...perMembership.values()].reduce((s, m) => s + m.net, 0);
    const totalMembers = perMembership.size;
    const totalMemberMonths = [...perMembership.values()].reduce(
      (s, m) => s + m.months.size,
      0,
    );

    return {
      configured: true,
      currency: summarizeWhopRevenue(payments).currency,
      periods,
      plans,
      monthlyArpu:
        totalMemberMonths > 0 ? round2(totalNet / totalMemberMonths) : null,
      ltv: totalMembers > 0 ? round2(totalNet / totalMembers) : null,
      churnAvailable: false,
    };
  },
});
