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
  type OverviewPayload,
  type FunnelPayload,
  type InstrumentationPayload,
  type InternalExcludedPayload,
} from "./posthogSync";
import {
  internalAccountsFor,
  isInternalWhopMembership,
} from "./internalAccounts";
import {
  computeViewCounters,
  VIEW_COUNTER_USAGE,
} from "./viewCounters";
import {
  computeSoloDays,
  computeCreatorEfficiency,
  type PromoVideo,
  type DailyBehavior,
  type SoloDay,
  type CreatorEfficiency,
} from "./soloDays";

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
 * ⚠️ ATTRIBUTION — la fenêtre 24 h est SUPPRIMÉE (règle A3) : sans lien tracké,
 * elle dupliquait chaque inscription sur TOUTES les créatrices publiant le même
 * jour (coût par client faussé ×~13). On ne garde que les JOURS SOLO (une seule
 * créatrice a publié en promo) — attribution CERTAINE ce jour-là, « non
 * attribuable » sinon (jamais un chiffre inventé). Cf convex/soloDays. Le jour
 * de référence est le jour EUROPE/PARIS (postDate à minuit UTC+1 ⇄ série PostHog
 * bucketisée Paris), pour que publication et inscriptions tombent le même jour.
 */

/** Jour « métier » Europe/Paris d'un timestamp (ms) → "YYYY-MM-DD". */
function parisDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
  }).format(new Date(ms));
}

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
  /** Jour de publication Europe/Paris "YYYY-MM-DD" (clé des jours solo). */
  day: string;
  period: string;
  /** Vues de TOUS les posts de la vidéo (warmup inclus) — affichage. */
  totalViews: number;
  /** Vues payables (posts rémunérés) — base du CPM. */
  payableViews: number;
  /** Vues promo (posts non-warmup) — base des taux de conversion (jamais additionnée). */
  promoViews: number;
  /** Vidéo entièrement warmup (exclue de la paie). */
  isWarmupOnly: boolean;
  /** Au moins un post en phase promo (compte pour la détection des jours solo). */
  hasPromoPost: boolean;
  /** Coût réel de la vidéo (fixe/vidéo + CPM). null = hors moteur v2 (legacy). */
  cost: number | null;
}

export interface AttributionResult {
  /** Une ligne par VIDÉO (coût & vues) — SANS attribution inventée par vidéo. */
  rows: AttributionRow[];
  /** Attribution CERTAINE des jours où une seule créatrice a publié en promo (A3). */
  soloDays: SoloDay[];
  /** Efficacité promo par créatrice (médiane, hits, vues promo). */
  creators: CreatorEfficiency[];
  /** true si la série quotidienne PostHog (overview) est exploitable. */
  attributionAvailable: boolean;
  posthogConfigured: boolean;
  computedAt: number | null;
}

/**
 * Table d'attribution — une ligne par VIDÉO (coût & vues, toujours dispo via
 * Jarvia) + les JOURS SOLO (attribution certaine, A3) + l'efficacité par
 * créatrice. Plus AUCUNE attribution par fenêtre 24 h (supprimée) : le seul
 * rapprochement honnête sans lien tracké est le jour solo.
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

    // Série QUOTIDIENNE PostHog (overview, internes exclus, bucket Europe/Paris)
    // — support des jours solo. Absente ⇒ jours solo sans compteurs (null).
    const cacheRow = await ctx.db
      .query("posthogCache")
      .withIndex("by_project_key", (q) =>
        q.eq("projectId", ctx.projectId).eq("key", POSTHOG_CACHE_KEYS.overview),
      )
      .first();
    const daily: DailyBehavior[] = [];
    if (cacheRow && cacheRow.json !== "") {
      try {
        const payload = JSON.parse(cacheRow.json) as OverviewPayload;
        for (const d of payload.daily ?? []) {
          daily.push({
            day: parisDay(d.ts),
            visitors: d.visitors,
            signups: d.signups,
            clients: d.subs,
          });
        }
      } catch {
        // cache illisible → aucune attribution (jours solo à compteurs null).
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
        day: parisDay(publishedAt),
        period,
        totalViews: views.totalViews,
        payableViews: views.payableViews,
        promoViews: views.promoViews,
        isWarmupOnly: !views.hasPayablePost,
        hasPromoPost: views.hasPromoPost,
        cost,
      });
    }

    // Tri par vues PROMO décroissantes (performance promo) — l'attribution n'est
    // plus par ligne mais au jour solo.
    rows.sort((x, y) => y.promoViews - x.promoViews || y.publishedAt - x.publishedAt);

    // Jours solo + efficacité créatrice, sur les vidéos ayant AU MOINS un post
    // promo (même à 0 vue : la présence compte pour le « solo »).
    const promoVideos: PromoVideo[] = rows
      .filter((r) => r.hasPromoPost)
      .map((r) => ({
        day: r.day,
        creatorId: r.creatorId,
        creatorName: r.creatorName,
        promoViews: r.promoViews,
      }));
    const soloDays = computeSoloDays(promoVideos, daily);
    const creatorEfficiency = computeCreatorEfficiency(promoVideos);

    return {
      rows,
      soloDays,
      creators: creatorEfficiency,
      attributionAvailable: daily.length > 0,
      posthogConfigured: project?.posthog !== undefined,
      computedAt: cacheRow?.computedAt ?? null,
    };
  },
});

// ─── Trois compteurs de vues (A2) ────────────────────────────────────────────

export interface ViewCountersResult {
  /** Σ toutes vues (warmup incl.) — usage : paliers. */
  totales: number;
  /** Σ vues des posts rémunérés — usage : moteur de paie. */
  payables: number;
  /** Σ vues des posts non-warmup (promo) — usage : taux de conversion. */
  promo: number;
  /** Libellé d'usage de chaque compteur (la carte DÉCLARE lequel elle lit). */
  usage: { totales: string; payables: string; promo: string };
  /** Nb de publications comptées (transparence). */
  publications: number;
}

/**
 * Les TROIS compteurs de vues du projet (règle A2) — chacun sa base, JAMAIS
 * additionnés entre eux. La définition de la promo a une source UNIQUE
 * (convex/viewCounters.isPromoPost) : le jour où `datePromoStart` remplace
 * « non-warmup », seule cette fonction change.
 */
export const getViewCounters = adminQuery({
  args: {},
  handler: async (ctx): Promise<ViewCountersResult> => {
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const counters = computeViewCounters(
      pubs.map((p) => ({
        views: p.vuesLatest ?? 0,
        isWarmup: p.isWarmup === true,
        remunere: p.remunere,
      })),
    );
    return {
      totales: counters.totales,
      payables: counters.payables,
      promo: counters.promo,
      usage: { ...VIEW_COUNTER_USAGE },
      publications: pubs.length,
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
  /** B3 — Net moyen par paiement. null si aucun paiement encaissé. */
  netPerPayment: number | null;
  /** B3 — taux de frais du plan (brut − net)/brut, fraction 0–1. null si mixte/nul. */
  feeRate: number | null;
  /** B3 — Net par mois-membre actif (« net/mois/client »). null si aucun. */
  netPerMemberMonth: number | null;
}

export interface RevenueBreakdown {
  configured: boolean;
  currency: string | null;
  /** A5 — true = revenu multi-devise : les totaux ne sont PAS additionnés. */
  mixedCurrency: boolean;
  /** A5 — taux de frais effectif (brut − net) / brut, fraction 0–1. null si mixte. */
  feeRate: number | null;
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
  /** A4 — memberships internes exclus du revenu (compteur visible). */
  internalExcludedMembers: number;
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
        mixedCurrency: false,
        feeRate: null,
        periods: [],
        plans: [],
        monthlyArpu: null,
        ltv: null,
        churnAvailable: false,
        internalExcludedMembers: 0,
      };
    }

    // A4 — écarte les abonnements internes (par membershipId, cf internalAccounts)
    // AVANT toute agrégation ; on en tient le compte pour l'afficher.
    const internalCfg = internalAccountsFor(project.slug);
    const internalMembers = new Set<string>();
    const payments = (
      await ctx.db
        .query("whopPayments")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    ).filter((p) => {
      if (isInternalWhopMembership(p.membershipId, internalCfg)) {
        if (p.membershipId) internalMembers.add(p.membershipId);
        return false;
      }
      return true;
    });

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

    const byPlan = new Map<
      string,
      { members: number; netTotal: number; memberMonths: number }
    >();
    for (const m of perMembership.values()) {
      const cur = byPlan.get(m.planId) ?? {
        members: 0,
        netTotal: 0,
        memberMonths: 0,
      };
      cur.members += 1;
      cur.netTotal += m.net;
      cur.memberMonths += m.months.size;
      byPlan.set(m.planId, cur);
    }
    // Éco par offre : frais (brut − net) et net/paiement par plan, via le même
    // moteur devise-sûr (C6) sur le sous-ensemble de paiements du plan.
    const paymentsByPlan = new Map<string, typeof payments>();
    for (const p of payments) {
      const k = p.planId ?? "(sans plan)";
      const list = paymentsByPlan.get(k) ?? [];
      list.push(p);
      paymentsByPlan.set(k, list);
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const plans: PlanEconomics[] = [...byPlan.entries()]
      .map(([planId, x]) => {
        const s = summarizeWhopRevenue(paymentsByPlan.get(planId) ?? []);
        return {
          planId,
          members: x.members,
          netTotal: round2(x.netTotal),
          ltv: x.members > 0 ? round2(x.netTotal / x.members) : null,
          netPerPayment: s.paymentCount > 0 ? round2(s.net / s.paymentCount) : null,
          feeRate: s.feeRate,
          netPerMemberMonth:
            x.memberMonths > 0 ? round2(x.netTotal / x.memberMonths) : null,
        };
      })
      .sort((a, b) => b.netTotal - a.netTotal);

    const totalNet = [...perMembership.values()].reduce((s, m) => s + m.net, 0);
    const totalMembers = perMembership.size;
    const totalMemberMonths = [...perMembership.values()].reduce(
      (s, m) => s + m.months.size,
      0,
    );

    const summary = summarizeWhopRevenue(payments);
    return {
      configured: true,
      currency: summary.currency,
      mixedCurrency: summary.mixedCurrency,
      feeRate: summary.feeRate,
      periods,
      plans,
      monthlyArpu:
        totalMemberMonths > 0 ? round2(totalNet / totalMemberMonths) : null,
      ltv: totalMembers > 0 ? round2(totalNet / totalMembers) : null,
      churnAvailable: false,
      internalExcludedMembers: internalMembers.size,
    };
  },
});

// ─── Colonne vertébrale FIABILITÉ (spine phase C) ────────────────────────────

const EMPTY_INSTRUMENTATION: InstrumentationPayload = { events: [], props: [] };

/** Une étape de funnel réduite à ce dont le contrôle de cohérence a besoin. */
interface StepCount {
  key: string;
  count: number;
}

export interface ReliabilityResult {
  /** PostHog configuré (sinon instrumentation vide). */
  configured: boolean;
  /** Dernier passage de sync PostHog (max computedAt du cache). */
  computedAt: number | null;
  /** État de CHAQUE event du contrat (carte instrumentation). */
  instrumentation: InstrumentationPayload;
  /** Personnes internes exclues (compteur A4). */
  internalExcluded: InternalExcludedPayload;
  /**
   * ENTRÉES des contrôles de cohérence — le CLIENT appelle
   * `lib/analytics-hub.buildCoherenceChecks` (ce module pur vit côté client, pas
   * de réplique convex). On ne fait ici que réunir les chiffres bruts.
   */
  coherence: {
    sequentialSteps: StepCount[];
    reachSteps: StepCount[];
    currencyCount: number;
    /** Clients selon le dashboard (atteinte subscription_completed). */
    dashboardClients: number | null;
    /**
     * Membres payants Whop COMPARABLES au dashboard : 1er paiement DANS la même
     * fenêtre que le cache PostHog (≤ dernière synchro) ET après le début de
     * l'instrumentation → base du calcul d'écart (ni latence de cron, ni artefact).
     */
    whopMembers: number | null;
    /** Total des membres payants Whop (affichage « Clients payants »). */
    whopMembersTotal: number | null;
    /** Exclus car antérieurs à l'instrumentation (cause explicable de l'écart). */
    whopExcludedPre: number;
    /** Exclus car postérieurs au dernier cron (latence, pas incohérence). */
    whopExcludedAfter: number;
  };
  /** Fraîcheur par source : dernière synchro (ms). Le CLIENT juge le « périmé ». */
  freshness: { source: "posthog" | "whop" | "scraping"; lastSyncMs: number | null }[];
}

/**
 * Réunit tout ce dont l'onglet Fiabilité a besoin, en UNE query : état
 * d'instrumentation, entrées des contrôles de cohérence, compteur d'internes,
 * fraîcheur des sources. La phase C n'a plus qu'à afficher (et composer les
 * checks via le module pur côté client).
 */
export const getReliability = adminQuery({
  args: {},
  handler: async (ctx): Promise<ReliabilityResult> => {
    const project = await ctx.db.get(ctx.projectId);
    const configured = project?.posthog !== undefined;

    const cacheRows = await ctx.db
      .query("posthogCache")
      .withIndex("by_project_key", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const byKey = new Map(cacheRows.map((r) => [r.key, r]));
    const read = <T,>(key: string, fallback: T): T => {
      const row = byKey.get(key);
      if (!row || row.json === "") return fallback;
      try {
        return JSON.parse(row.json) as T;
      } catch {
        return fallback;
      }
    };
    const stepsOf = (payload: FunnelPayload): StepCount[] => {
      const seg = payload.segments[0];
      return seg ? seg.steps.map((s) => ({ key: s.key, count: s.count })) : [];
    };

    const instrumentation = read<InstrumentationPayload>(
      POSTHOG_CACHE_KEYS.instrumentation,
      EMPTY_INSTRUMENTATION,
    );
    const internalExcluded = read<InternalExcludedPayload>(
      POSTHOG_CACHE_KEYS.internalExcluded,
      { persons: 0, totalPersons: 0 },
    );
    const sequentialSteps = stepsOf(
      read<FunnelPayload>(POSTHOG_CACHE_KEYS.funnelSequential, { segments: [] }),
    );
    const reachSteps = stepsOf(
      read<FunnelPayload>(POSTHOG_CACHE_KEYS.funnelGlobal, { segments: [] }),
    );
    const dashboardClients =
      reachSteps.find((s) => s.key === "subscription_completed")?.count ?? null;
    const posthogSyncMs =
      cacheRows.length > 0
        ? Math.max(...cacheRows.map((r) => r.computedAt))
        : null;

    // Début d'instrumentation = 1re émission la PLUS ANCIENNE d'un event émis.
    // Sert de borne basse d'ancrage (les memberships antérieurs sont hors compa).
    const emittedFirsts = instrumentation.events
      .filter((e) => e.persons > 0 && e.firstSeenMs !== null)
      .map((e) => e.firstSeenMs as number);
    const instrumentationStart =
      emittedFirsts.length > 0 ? Math.min(...emittedFirsts) : null;

    // Whop : devises + membres payants ANCRÉS sur la fenêtre du cache PostHog.
    let currencyCount = 0;
    let whopMembers: number | null = null;
    let whopMembersTotal: number | null = null;
    let whopExcludedPre = 0;
    let whopExcludedAfter = 0;
    let whopSyncMs: number | null = null;
    if (project?.whop) {
      const payments = await ctx.db
        .query("whopPayments")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect();
      currencyCount = summarizeWhopRevenue(payments).currencies.length;
      // Premier paiement encaissé par membership (date de « début » du client).
      const firstPaid = new Map<string, number>();
      for (const p of payments) {
        whopSyncMs = Math.max(whopSyncMs ?? 0, p.updatedAt);
        if (!p.membershipId || whopNetContribution(p) <= 0) continue;
        const prev = firstPaid.get(p.membershipId);
        if (prev === undefined || p.paidAt < prev) firstPaid.set(p.membershipId, p.paidAt);
      }
      let comparable = 0;
      for (const first of firstPaid.values()) {
        if (instrumentationStart !== null && first < instrumentationStart) {
          whopExcludedPre += 1; // antérieur à l'instrumentation (pas de distinctId)
        } else if (posthogSyncMs !== null && first > posthogSyncMs) {
          whopExcludedAfter += 1; // après le dernier cron → latence, pas un écart
        } else {
          comparable += 1;
        }
      }
      whopMembersTotal = firstPaid.size;
      whopMembers = comparable;
    }

    // Scraping (vues Jarvia) : dernier snapshot relevé sur une publication.
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    let scrapingSyncMs: number | null = null;
    for (const p of publications) {
      if (p.latestSnapshotAt !== undefined) {
        scrapingSyncMs = Math.max(scrapingSyncMs ?? 0, p.latestSnapshotAt);
      }
    }

    return {
      configured,
      computedAt: posthogSyncMs,
      instrumentation,
      internalExcluded,
      coherence: {
        sequentialSteps,
        reachSteps,
        currencyCount,
        dashboardClients,
        whopMembers,
        whopMembersTotal,
        whopExcludedPre,
        whopExcludedAfter,
      },
      freshness: [
        { source: "posthog", lastSyncMs: posthogSyncMs },
        { source: "whop", lastSyncMs: whopSyncMs },
        { source: "scraping", lastSyncMs: scrapingSyncMs },
      ],
    };
  },
});
