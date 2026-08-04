import { adminQuery } from "./functions";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assignmentPublishedAt,
  assignmentViewsAndMetrics,
  computeLivePricingBreakdown,
  type PricingBreakdown,
} from "./pricing";
import { periodOf } from "./payments";
import {
  summarizeWhopRevenue,
  whopNetContribution,
  whopCollectedAmount,
  splitRevenueByOrigin,
  renewalsByPlan,
  computeRenewalStats,
  whopBillingOrigin,
} from "./whopRevenue";
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

/** Arrondi au centime (partagé). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Statuts d'assignment porteurs de coût (même porte que le moteur de paie). */
function isCostBearing(a: Doc<"assignments">): boolean {
  return a.status === "published" || a.status === "paid";
}

/**
 * Prix affiché d'une offre = brut le PLUS FRÉQUENT de ses paiements (et sa
 * devise). L'ID Whop `plan_22OfkN5xAE13m` ne dit rien ; « 7,99 € » oui. Robuste
 * à un montant aberrant isolé. null si aucun paiement chiffré.
 */
function modalPrice(
  payments: { grossAmount: number; currency: string }[],
): { price: number | null; currency: string | null } {
  const counts = new Map<string, { n: number; price: number; currency: string }>();
  for (const p of payments) {
    if (!(p.grossAmount > 0)) continue;
    const key = `${p.grossAmount}|${p.currency}`;
    const cur = counts.get(key) ?? { n: 0, price: p.grossAmount, currency: p.currency };
    cur.n += 1;
    counts.set(key, cur);
  }
  let best: { n: number; price: number; currency: string } | null = null;
  for (const c of counts.values()) {
    if (best === null || c.n > best.n) best = c;
  }
  return best
    ? { price: best.price, currency: best.currency }
    : { price: null, currency: null };
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
  /** Devise de la PAIE créatrices (dollars) — le coût/CAC est dans cette devise. */
  payCurrency: string | null;
  /** Taux paie→revenu pour la marge (croise coût $ et revenu €). null → non calculée. */
  fxRateToRevenue: number | null;
  /**
   * Coûts créateurs (paie, en devise $), pour les deux cartes d'éco unitaire :
   *  - `total` = coût COMPLET du moteur (fixe + CPM + 100 % du bonus), tous posts
   *    payables, warmup rémunéré INCLUS (sans warmup aucun compte ne publie de promo) ;
   *  - `promo` = fixe + CPM des publications PROMO (non-warmup), sommés depuis la
   *    paie RÉELLE de ces vidéos, jamais un ratio de vues ;
   *  - `promoBonus` = part du BONUS attribuée au promo, RÉPARTIE au prorata de la
   *    part de vues payables qui sont promo (`promoViewShare`). Le bonus est attaché
   *    à la CRÉATRICE, pas à une vidéo : c'est une ESTIMATION, pas une mesure, et
   *    l'UI l'affiche comme telle. Le coût d'acquisition = promo + promoBonus.
   * `promo`/`promoBonus` sont `null` seulement si un coût PAR VIDÉO manque (legacy
   * sans pricingSnapshot) → tiret, jamais une paie inventée.
   */
  costs: {
    total: number;
    promo: number | null;
    promoBonus: number | null;
    /** Clé de répartition du bonus = part des vues payables qui sont promo (0–1). */
    promoViewShare: number;
    /** Bonus paliers cash TOTAL (niveau créatrice) — 100 % dans `total`. */
    bonusTotal: number;
  };
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

    // ── Coûts créateurs (paie $) — deux cartes d'éco unitaire ────────────────
    // Le bonus paliers est CRÉATEUR-niveau (Σ des breakdowns mémoïsés). Décision
    // produit : un bonus débloqué est une DÉPENSE réelle, il ENTRE dans le coût
    // d'acquisition — réparti au prorata de la part de vues payables qui sont promo
    // (hypothèse assumée, affichée). Le coût COMPLET, lui, prend 100 % du bonus.
    let bonusTotal = 0;
    for (const b of breakdowns.values()) {
      bonusTotal = round2(bonusTotal + b.bonusTierCashTotal);
    }
    const payableCost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
    const promoRows = rows.filter((r) => r.hasPromoPost);
    const promoNullCost = promoRows.some((r) => r.cost === null);
    const promoFixeCpm = round2(promoRows.reduce((s, r) => s + (r.cost ?? 0), 0));
    // Clé : part des vues PAYABLES qui sont PROMO (bornée [0,1] — un post promo
    // non rémunéré resterait hors payable). Bonus promo = bonusTotal × clé.
    const totalPayableViews = rows.reduce((s, r) => s + r.payableViews, 0);
    const totalPromoViews = rows.reduce((s, r) => s + r.promoViews, 0);
    const promoViewShare =
      totalPayableViews > 0
        ? Math.min(1, totalPromoViews / totalPayableViews)
        : 0;
    const promoBonus = round2(bonusTotal * promoViewShare);

    return {
      rows,
      soloDays,
      creators: creatorEfficiency,
      attributionAvailable: daily.length > 0,
      posthogConfigured: project?.posthog !== undefined,
      computedAt: cacheRow?.computedAt ?? null,
      payCurrency: project?.payCurrency ?? null,
      fxRateToRevenue: project?.fxRateToRevenue ?? null,
      costs: {
        total: round2(payableCost + bonusTotal),
        promo: promoNullCost ? null : promoFixeCpm,
        promoBonus: promoNullCost ? null : promoBonus,
        promoViewShare: Math.round(promoViewShare * 1000) / 1000,
        bonusTotal,
      },
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
  /** Libellé lisible de l'offre récupéré depuis Whop (/plans). null si non fourni → l'UI affiche le prix. */
  name: string | null;
  /** Cadence lisible (« semaine », « mois »…) si Whop la fournit. */
  interval: string | null;
  /** Prix affiché de l'offre (brut le plus fréquent) — l'ID Whop ne dit rien à personne. */
  price: number | null;
  /** Devise de l'offre (le symbole vient de la donnée, jamais du code). */
  currency: string | null;
  /** true = offre ACTIVE (au moins un paiement encaissé) ; false = offre HISTORIQUE. */
  active: boolean;
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
  /** Raison si le net n'est pas calculable (offre sans paiement encaissé). null sinon. */
  netReason: string | null;
}

/**
 * Un LITIGE (chargeback) EN COURS — argent À RISQUE, EXCLU du net (cf
 * whopNetContribution). Les frais de litige dépassent souvent l'abonnement et une
 * accumulation met en péril le compte marchand : c'est l'info la plus urgente de
 * l'écran Revenus. Le délai `dueAt` (needs_response_by côté Whop) est capital.
 */
export interface DisputeEntry {
  whopId: string;
  /** Pseudo Whop du client (si connu) pour retrouver le litige côté Whop. */
  memberName: string | null;
  /** Montant à risque (net settlé − remboursé), dans la devise du paiement. */
  amount: number;
  currency: string | null;
  /** Date du paiement contesté (ms). */
  paidAt: number;
  /** Échéance de réponse (needs_response_by, ms) — null si l'API ne l'a pas donnée. */
  dueAt: number | null;
  /** Motif du litige si fourni. */
  reason: string | null;
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
  /** Revenu net par jour Europe/Paris — colonne « Détail par jour » (Vue d'ensemble). */
  dailyNet: { day: string; net: number }[];
  /** Montant total remboursé (déjà DÉDUIT du net). */
  refunded: number;
  /** Nombre de remboursements. */
  refundCount: number;
  /** Montant total des litiges EN COURS (À RISQUE), déjà EXCLU du net. */
  disputedTotal: number;
  /** Litiges en cours, du délai le plus court au plus long (le plus urgent d'abord). */
  disputes: DisputeEntry[];
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
  /** Journal des changements d'offre (horodaté, plus récent d'abord) — cohortes comparables. */
  offerChanges: { at: number; title: string; detail: string | null }[];
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
    // Journal des changements d'offre — toujours renvoyé (Whop-indépendant).
    const offerChanges = (
      await ctx.db
        .query("offerChanges")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    )
      .sort((a, b) => b.at - a.at)
      .map((o) => ({ at: o.at, title: o.title, detail: o.detail ?? null }));
    if (!project?.whop) {
      return {
        configured: false,
        currency: null,
        mixedCurrency: false,
        feeRate: null,
        periods: [],
        plans: [],
        dailyNet: [],
        refunded: 0,
        refundCount: 0,
        disputedTotal: 0,
        disputes: [],
        monthlyArpu: null,
        ltv: null,
        churnAvailable: false,
        internalExcludedMembers: 0,
        offerChanges,
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
    // Libellés d'offres Whop (point 3) — récupérés au cron whopSync. Absents ⇒
    // l'UI retombe sur le prix (dérivé des paiements). Aucune fabrication.
    const planLabels = new Map(
      (
        await ctx.db
          .query("whopPlans")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect()
      ).map((p) => [p.planId, p]),
    );

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const plans: PlanEconomics[] = [...byPlan.entries()]
      .map(([planId, x]) => {
        const list = paymentsByPlan.get(planId) ?? [];
        const s = summarizeWhopRevenue(list);
        const { price, currency } = modalPrice(list);
        const active = s.paymentCount > 0;
        const label = planLabels.get(planId);
        return {
          planId,
          name: label?.name ?? null,
          interval: label?.interval ?? null,
          // Prix : celui des paiements (fiable) en priorité, sinon celui de /plans.
          price: price ?? label?.price ?? null,
          currency: currency ?? label?.currency ?? null,
          active,
          members: x.members,
          netTotal: round2(x.netTotal),
          ltv: x.members > 0 ? round2(x.netTotal / x.members) : null,
          netPerPayment: s.paymentCount > 0 ? round2(s.net / s.paymentCount) : null,
          feeRate: s.feeRate,
          netPerMemberMonth:
            x.memberMonths > 0 ? round2(x.netTotal / x.memberMonths) : null,
          // Un net non calculable a une CAUSE affichée (offre historique sans
          // encaissement) plutôt qu'un tiret muet.
          netReason: active
            ? null
            : "Aucun paiement encaissé sur cette offre, seulement des tentatives échouées. Le net n'est pas calculable.",
        };
      })
      // Offres actives d'abord (par net décroissant), offres historiques ensuite.
      .sort(
        (a, b) =>
          Number(b.active) - Number(a.active) || b.netTotal - a.netTotal,
      );

    // Revenu net par JOUR Europe/Paris (colonne « Détail par jour »). En multi-
    // devise on ne somme pas : série vide (la carte affiche alors un tiret).
    const netByDay = new Map<string, number>();
    if (!summarizeWhopRevenue(payments).mixedCurrency) {
      for (const p of payments) {
        const net = whopNetContribution(p);
        if (net <= 0) continue;
        const day = parisDay(p.paidAt);
        netByDay.set(day, round2((netByDay.get(day) ?? 0) + net));
      }
    }
    const dailyNet = [...netByDay.entries()]
      .map(([day, net]) => ({ day, net }))
      .sort((a, b) => (a.day < b.day ? -1 : 1));

    const totalNet = [...perMembership.values()].reduce((s, m) => s + m.net, 0);
    const totalMembers = perMembership.size;
    const totalMemberMonths = [...perMembership.values()].reduce(
      (s, m) => s + m.months.size,
      0,
    );

    const summary = summarizeWhopRevenue(payments);

    // Litiges (chargebacks) EN COURS — argent À RISQUE, déjà EXCLU du net. Le plus
    // URGENT d'abord (échéance de réponse la plus proche ; sans échéance en dernier).
    const disputes: DisputeEntry[] = payments
      .filter((p) => p.status === "disputed")
      .map((p) => ({
        whopId: p.whopId,
        memberName: p.memberName ?? null,
        amount: round2(Math.max(0, p.netAmount - Math.max(0, p.refundedAmount))),
        currency: p.currency ?? null,
        paidAt: p.paidAt,
        dueAt: p.disputeDueAt ?? null,
        reason: p.disputeReason ?? null,
      }))
      .sort((a, b) => {
        if (a.dueAt !== null && b.dueAt !== null) return a.dueAt - b.dueAt;
        if (a.dueAt !== null) return -1; // une échéance connue passe devant
        if (b.dueAt !== null) return 1;
        return b.paidAt - a.paidAt;
      });

    return {
      configured: true,
      currency: summary.currency,
      mixedCurrency: summary.mixedCurrency,
      feeRate: summary.feeRate,
      periods,
      plans,
      dailyNet,
      refunded: summary.refunded,
      refundCount: summary.refundCount,
      disputedTotal: summary.disputed,
      disputes,
      monthlyArpu:
        totalMemberMonths > 0 ? round2(totalNet / totalMemberMonths) : null,
      ltv: totalMembers > 0 ? round2(totalNet / totalMembers) : null,
      churnAvailable: false,
      internalExcludedMembers: internalMembers.size,
      offerChanges,
    };
  },
});

/**
 * Ajoute une entrée au journal des changements d'offre (interne, `convex run`).
 * Horodaté : sans lui, deux cohortes ne sont pas comparables.
 *   npx convex run analyticsHub:addOfferChange '{"slug":"snytch","at":1785...,"title":"…","detail":"…"}' --prod
 */
export const addOfferChange = internalMutation({
  args: {
    slug: v.string(),
    at: v.number(),
    title: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { slug, at, title, detail }): Promise<{ added: boolean }> => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!project) return { added: false };
    await ctx.db.insert("offerChanges", {
      projectId: project._id,
      at,
      title,
      detail,
      createdAt: Date.now(),
    });
    return { added: true };
  },
});

/**
 * Seed IDEMPOTENT des trois changements simultanés du 27/07 chez Snytch : plan
 * gratuit (16h05), nouvelle offre 4,99 € (16h45), webhook de paiement en panne.
 * Exactement l'usage prévu du journal (une bascule d'offre contamine la compa).
 *   npx convex run analyticsHub:seedSnytchOfferChanges '{}' --prod
 */
export const seedSnytchOfferChanges = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ inserted: number }> => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", "snytch"))
      .first();
    if (!project) return { inserted: 0 };
    const existing = await ctx.db
      .query("offerChanges")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const have = new Set(existing.map((o) => o.title));
    const SEED = [
      {
        at: Date.UTC(2026, 6, 27, 14, 5, 0), // 16h05 Paris
        title: "Plan gratuit lancé",
        detail: "Le plan gratuit (1 cible) devient disponible.",
      },
      {
        at: Date.UTC(2026, 6, 27, 14, 45, 0), // 16h45 Paris
        title: "Nouvelle offre 4,99 €/semaine",
        detail:
          "Bascule du bundle 7,99 € vers 4,99 €/semaine. Périodes successives, aucun recouvrement : dernier 7,99 € à 15h16, premier 4,99 € à 16h45.",
      },
      {
        at: Date.UTC(2026, 6, 27, 0, 0, 0),
        title: "Webhook de paiement en panne",
        detail:
          "Aucun paiement n'accordait l'accès automatiquement jusqu'à la réparation du 28/07 au soir.",
      },
    ];
    let inserted = 0;
    for (const s of SEED) {
      if (have.has(s.title)) continue;
      await ctx.db.insert("offerChanges", {
        projectId: project._id,
        ...s,
        createdAt: Date.now(),
      });
      inserted += 1;
    }
    return { inserted };
  },
});

// ─── Churn / rétention (état des memberships Whop = fait foi) ─────────────────

/** Entrée de churn — structurellement compatible avec lib/churn.MembershipInput. */
interface MembershipEntry {
  membershipId: string;
  planId: string | null;
  status: string;
  valid: boolean | null;
  accessEndsAt: number | null;
  canceledAt: number | null;
  firstPaidAt: number | null;
  paidCount: number;
  intervalDays: number | null;
}

/** Cadence d'une offre (libellé Whop) en JOURS. Réplique de lib/churn.intervalToDays. */
function intervalToDaysServer(interval: string | null | undefined): number | null {
  switch ((interval ?? "").trim().toLowerCase()) {
    case "jour":
      return 1;
    case "semaine":
      return 7;
    case "mois":
      return 30;
    case "trimestre":
      return 91;
    case "an":
    case "année":
      return 365;
    default:
      return null;
  }
}

/**
 * Données de CHURN par projet : assemble l'état des memberships Whop (qui fait foi)
 * avec les paiements (première date + nombre, pour le délai et le renouvellement) et
 * la cadence des offres. Le CALCUL (résilié vs expiré, taux, délais) est fait CÔTÉ
 * CLIENT par lib/churn.computeChurn (module pur, pas de réplique convex) : ici on ne
 * réunit que les entrées. Comptes internes exclus (A4).
 */
/**
 * RENOUVELLEMENTS — la métrique qui décide si le moteur est viable. Un client
 * acquis à un coût donné ne l'est que s'il rapporte plus que ça sur sa durée de
 * vie ; tant qu'aucun renouvellement n'était observé, la question restait ouverte.
 * Source : Whop SEUL (billing_reason + état des abonnements) — PostHog ne sait
 * rien des échéances.
 */
export interface RenewalsPayload {
  /** Revenu par jour Europe/Paris, séparé nouveau / renouvellement, avec cumuls. */
  days: {
    day: string;
    newNet: number;
    renewalNet: number;
    unknownNet: number;
    newCount: number;
    renewalCount: number;
    unknownCount: number;
    cumulativeNewNet: number;
    cumulativeRenewalNet: number;
  }[];
  newNet: number;
  renewalNet: number;
  unknownNet: number;
  newCount: number;
  renewalCount: number;
  /** Part du revenu venant du renouvellement (fraction 0–1). null si rien de classé. */
  renewalShare: number | null;
  /**
   * Paiements dont l'origine est INCONNUE : importés avant la capture de
   * `billing_reason`. Ils ne sont comptés ni en acquisition ni en rétention —
   * l'afficher évite de lire une part de rétention faussement basse.
   */
  unknownPayments: number;
  /** Renouvellements par offre (libellé joint côté client via planLabels). */
  byPlan: { planId: string; renewalCount: number; renewalNet: number; members: number }[];
  dueSubscriptions: number;
  renewedSubscriptions: number;
  renewalRate: number | null;
  notYetDue: number;
  averageCycles: number | null;
  cycleDistribution: { cycles: number; members: number }[];
  netPerPayment: number | null;
  lifetimeValue: number | null;
  payingMembers: number;
  failedRenewalAttempts: number;
  failedRenewalAmount: number;
}

export const getChurn = adminQuery({
  args: {},
  handler: async (ctx) => {
    const project = await ctx.db.get(ctx.projectId);
    if (!project?.whop) {
      return {
        configured: false as const,
        computedAt: null as number | null,
        currency: null as string | null,
        netPerPayment: null as number | null,
        memberships: [] as MembershipEntry[],
        planLabels: [] as { planId: string; name: string | null }[],
        renewals: null as RenewalsPayload | null,
      };
    }
    const internalCfg = internalAccountsFor(project.slug);
    const [members, payments, plans] = await Promise.all([
      ctx.db
        .query("whopMemberships")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("whopPayments")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("whopPlans")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);

    // Premier paiement encaissé + nombre, par membership (internes exclus).
    const payAgg = new Map<string, { first: number; count: number }>();
    for (const p of payments) {
      if (!p.membershipId || isInternalWhopMembership(p.membershipId, internalCfg)) {
        continue;
      }
      if (whopCollectedAmount(p) <= 0) continue; // client ayant payé (litige inclus)
      const cur = payAgg.get(p.membershipId) ?? { first: p.paidAt, count: 0 };
      cur.first = Math.min(cur.first, p.paidAt);
      cur.count += 1;
      payAgg.set(p.membershipId, cur);
    }

    const intervalByPlan = new Map(
      plans.map((pl) => [pl.planId, intervalToDaysServer(pl.interval ?? null)]),
    );

    const memberships: MembershipEntry[] = members
      .filter((m) => !isInternalWhopMembership(m.whopMembershipId, internalCfg))
      .map((m) => {
        const pa = payAgg.get(m.whopMembershipId);
        return {
          membershipId: m.whopMembershipId,
          planId: m.planId ?? null,
          status: m.status,
          valid: m.valid ?? null,
          accessEndsAt: m.accessEndsAt ?? null,
          canceledAt: m.canceledAt ?? null,
          firstPaidAt: pa?.first ?? null,
          paidCount: pa?.count ?? 0,
          intervalDays: m.planId ? (intervalByPlan.get(m.planId) ?? null) : null,
        };
      });

    const nonInternalPayments = payments.filter(
      (p) => !isInternalWhopMembership(p.membershipId, internalCfg),
    );
    const summary = summarizeWhopRevenue(nonInternalPayments);
    const netPerPayment =
      summary.paymentCount > 0 ? round2(summary.net / summary.paymentCount) : null;
    const computedAt =
      members.length > 0 ? Math.max(...members.map((m) => m.updatedAt)) : null;

    // ─── Renouvellements (Whop fait foi) ───────────────────────────────────
    // Même base que le churn : paiements et abonnements NON internes. Le jour est
    // bucketisé Europe/Paris, comme le reste du hub, pour que la courbe coïncide
    // au jour près avec « Détail par jour ».
    const origin = splitRevenueByOrigin(nonInternalPayments, parisDay);
    const stats = computeRenewalStats(
      nonInternalPayments,
      members
        .filter((m) => !isInternalWhopMembership(m.whopMembershipId, internalCfg))
        .map((m) => ({
          whopMembershipId: m.whopMembershipId,
          planId: m.planId,
          accessEndsAt: m.accessEndsAt,
        })),
      Date.now(),
    );
    const renewals: RenewalsPayload = {
      days: origin.days,
      newNet: origin.newNet,
      renewalNet: origin.renewalNet,
      unknownNet: origin.unknownNet,
      newCount: origin.newCount,
      renewalCount: origin.renewalCount,
      renewalShare: origin.renewalShare,
      unknownPayments: origin.unknownPayments,
      byPlan: renewalsByPlan(nonInternalPayments),
      dueSubscriptions: stats.dueSubscriptions,
      renewedSubscriptions: stats.renewedSubscriptions,
      renewalRate: stats.renewalRate,
      notYetDue: stats.notYetDue,
      averageCycles: stats.averageCycles,
      cycleDistribution: stats.cycleDistribution,
      netPerPayment: stats.netPerPayment,
      lifetimeValue: stats.lifetimeValue,
      payingMembers: stats.payingMembers,
      failedRenewalAttempts: stats.failedRenewalAttempts,
      failedRenewalAmount: stats.failedRenewalAmount,
    };

    return {
      configured: true as const,
      computedAt,
      currency: summary.currency,
      netPerPayment,
      memberships,
      planLabels: plans.map((pl) => ({ planId: pl.planId, name: pl.name ?? null })),
      renewals,
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
  /** Personnes internes exclues côté PostHog (compteur A4). */
  internalExcluded: InternalExcludedPayload;
  /** Memberships internes exclus côté Whop (le compte de test de l'admin). */
  whopInternalExcluded: number;
  /**
   * Contrôle « N abonnements pour M personnes » — memberships payants groupés par
   * utilisateur Whop. Une personne peut en avoir plusieurs (détail des concernés).
   */
  membershipDuplicates: {
    memberships: number;
    users: number;
    duplicates: { whopUserId: string; count: number; membershipIds: string[] }[];
  };
  /**
   * ENTRÉES des contrôles de cohérence — le CLIENT appelle
   * `lib/analytics-hub.buildCoherenceChecks` (ce module pur vit côté client, pas
   * de réplique convex). On ne fait ici que réunir les chiffres bruts.
   */
  coherence: {
    sequentialSteps: StepCount[];
    reachSteps: StepCount[];
    currencyCount: number;
    /** Clients « dashboard » du garde-fou = chaîne SÉQUENTIELLE (concorde Whop). */
    dashboardClients: number | null;
    /** Atteinte BRUTE subscription_completed (double-comptée client+serveur). */
    reachClients: number | null;
    /** Σ des clients quotidiens (uniq/jour) — doit rester ≤ au total période. */
    dailyClientsSum: number | null;
    /** Σ des inscrits quotidiens (uniq/jour). */
    dailySignupsSum: number | null;
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
    /** Nouveaux clients payants Whop PAR JOUR Paris (1er paiement d'un membership,
     *  internes exclus) — série « Clients payants », SOURCE DE VÉRITÉ affichée sur
     *  la courbe + la colonne (remplace PostHog subs, décalé). */
    dailyPaidClients: { day: string; clients: number }[];
    /** RENOUVELLEMENTS encaissés par jour Paris — colonne jumelle de « Nouveaux
     *  clients », qui ne compte QUE les premiers paiements. Source Whop. */
    dailyRenewals: { day: string; renewals: number }[];
    /** Tentatives de paiement ÉCHOUÉES Whop PAR JOUR Paris (statut "failed",
     *  internes exclus) — colonne « Échecs » du Détail par jour. Une tentative
     *  échouée n'est PAS un client (0 au net) mais doit être visible. */
    dailyFailedPayments: { day: string; count: number }[];
    /** subs PostHog par jour Paris — SEULEMENT pour le contrôle croisé PostHog↔Whop
     *  (le funnel garde PostHog ; l'affichage « Clients payants » passe sur Whop). */
    dailySubs: { day: string; subs: number }[];
    /** Jour Paris courant — exclu du contrôle croisé (partiel des deux côtés). */
    todayParis: string;
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
    const stepCount = (steps: StepCount[], key: string): number | null =>
      steps.find((s) => s.key === key)?.count ?? null;
    // Clients « dashboard » du garde-fou = le SÉQUENTIEL (chaîne complète,
    // concorde avec Whop), PAS l'atteinte brute qui double-compte
    // subscription_completed (client + serveur). L'écart brut↔séquentiel est
    // exposé à part comme défaut d'instrumentation.
    const reachClients = stepCount(reachSteps, "subscription_completed");
    const dashboardClients = stepCount(sequentialSteps, "subscription_completed");
    // Somme des valeurs quotidiennes vs total sur la même période (garde-fou :
    // une somme de jours qui dépasse le total = double comptage inter-jours).
    const overview = read<OverviewPayload>(POSTHOG_CACHE_KEYS.overview, {
      daily: [],
    });
    const dailyClientsSum = overview.daily.reduce((s, d) => s + d.subs, 0);
    const dailySignupsSum = overview.daily.reduce((s, d) => s + d.signups, 0);
    // subs PostHog par jour Paris (contrôle croisé Whop) + jour courant à exclure.
    const dailySubs = overview.daily.map((d) => ({
      day: parisDay(d.ts),
      subs: d.subs,
    }));
    const todayParis = parisDay(Date.now());
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
    let dailyPaidClients: { day: string; clients: number }[] = [];
    let dailyRenewals: { day: string; renewals: number }[] = [];
    let dailyFailedPayments: { day: string; count: number }[] = [];
    let whopInternalExcluded = 0;
    let whopSyncMs: number | null = null;
    let membershipDuplicates: ReliabilityResult["membershipDuplicates"] = {
      memberships: 0,
      users: 0,
      duplicates: [],
    };
    if (project?.whop) {
      const payments = await ctx.db
        .query("whopPayments")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect();
      currencyCount = summarizeWhopRevenue(payments).currencies.length;
      // A4 — comptes internes exclus DES DEUX CÔTÉS : ici aussi (pas seulement du
      // revenu), sinon « Clients payants » comptait le compte de test de l'admin.
      const internalCfg = internalAccountsFor(project.slug);
      const internalMembers = new Set<string>();
      // Premier paiement encaissé par membership (date de « début » du client).
      const firstPaid = new Map<string, number>();
      for (const p of payments) {
        whopSyncMs = Math.max(whopSyncMs ?? 0, p.updatedAt);
        // COMPTE clients : un litige EN COURS reste un client qui a payé →
        // whopCollectedAmount (inclut "disputed"), PAS whopNetContribution (qui
        // exclut le litige du net). Garde « Clients payants » stable et aligné
        // avec PostHog (subscription_completed a bien été émis pour ce client).
        if (!p.membershipId || whopCollectedAmount(p) <= 0) continue;
        if (isInternalWhopMembership(p.membershipId, internalCfg)) {
          internalMembers.add(p.membershipId);
          continue;
        }
        const prev = firstPaid.get(p.membershipId);
        if (prev === undefined || p.paidAt < prev) firstPaid.set(p.membershipId, p.paidAt);
      }
      whopInternalExcluded = internalMembers.size;
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
      // Nouveaux clients payants Whop PAR JOUR Paris = série « Clients payants »
      // (source de vérité). firstPaid = 1er paiement encaissé par membership,
      // internes déjà exclus → un membership compte le JOUR de son premier paiement.
      const paidClientsByDay = new Map<string, number>();
      for (const first of firstPaid.values()) {
        const day = parisDay(first);
        paidClientsByDay.set(day, (paidClientsByDay.get(day) ?? 0) + 1);
      }
      dailyPaidClients = [...paidClientsByDay.entries()]
        .map(([day, clients]) => ({ day, clients }))
        .sort((a, b) => (a.day < b.day ? -1 : 1));

      // RENOUVELLEMENTS par jour Paris — colonne jumelle de « Nouveaux clients ».
      // `dailyPaidClients` ne compte QUE le premier paiement d'un abonnement : une
      // journée entièrement faite de renouvellements y affiche 0, ce qui est juste
      // mais illisible sans cette colonne (cas du 03/08 : 0 nouveau, 5 renouvellements).
      const renewalsByDay = new Map<string, number>();
      for (const p of payments) {
        if (!p.membershipId || whopCollectedAmount(p) <= 0) continue;
        if (isInternalWhopMembership(p.membershipId, internalCfg)) continue;
        if (whopBillingOrigin(p.billingReason) !== "renewal") continue;
        const day = parisDay(p.paidAt);
        renewalsByDay.set(day, (renewalsByDay.get(day) ?? 0) + 1);
      }
      dailyRenewals = [...renewalsByDay.entries()]
        .map(([day, renewals]) => ({ day, renewals }))
        .sort((a, b) => (a.day < b.day ? -1 : 1));

      // Tentatives de paiement ÉCHOUÉES par jour Paris (colonne « Échecs »).
      // On compte les LIGNES "failed" (une par tentative), internes exclus — une
      // tentative échouée n'entre pas dans le net mais doit rester visible.
      const failedByDay = new Map<string, number>();
      for (const p of payments) {
        if (p.status !== "failed") continue;
        if (isInternalWhopMembership(p.membershipId, internalCfg)) continue;
        const day = parisDay(p.paidAt);
        failedByDay.set(day, (failedByDay.get(day) ?? 0) + 1);
      }
      dailyFailedPayments = [...failedByDay.entries()]
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => (a.day < b.day ? -1 : 1));

      // Contrôle « N abonnements pour M personnes » : memberships réels (hors
      // brouillons) groupés par utilisateur Whop. `whopUserId` n'est peuplé qu'à
      // partir de la re-synchro (nouveau champ) → les memberships sans user sont
      // ignorés (le contrôle s'allume quand la synchro l'a rempli).
      const memberships = await ctx.db
        .query("whopMemberships")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect();
      const byUser = new Map<string, string[]>();
      let counted = 0;
      for (const m of memberships) {
        if (m.status === "drafted") continue;
        if (isInternalWhopMembership(m.whopMembershipId, internalCfg)) continue;
        if (!m.whopUserId) continue;
        counted += 1;
        const arr = byUser.get(m.whopUserId) ?? [];
        arr.push(m.whopMembershipId);
        byUser.set(m.whopUserId, arr);
      }
      membershipDuplicates = {
        memberships: counted,
        users: byUser.size,
        duplicates: [...byUser.entries()]
          .filter(([, ids]) => ids.length > 1)
          .map(([whopUserId, ids]) => ({
            whopUserId,
            count: ids.length,
            membershipIds: ids,
          }))
          .sort((a, b) => b.count - a.count),
      };
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
      whopInternalExcluded,
      membershipDuplicates,
      coherence: {
        sequentialSteps,
        reachSteps,
        currencyCount,
        dashboardClients,
        reachClients,
        dailyClientsSum,
        dailySignupsSum,
        whopMembers,
        whopMembersTotal,
        whopExcludedPre,
        whopExcludedAfter,
        dailyPaidClients,
        dailyRenewals,
        dailyFailedPayments,
        dailySubs,
        todayParis,
      },
      freshness: [
        { source: "posthog", lastSyncMs: posthogSyncMs },
        { source: "whop", lastSyncMs: whopSyncMs },
        { source: "scraping", lastSyncMs: scrapingSyncMs },
      ],
    };
  },
});
