import { adminQuery } from "./functions";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assignmentPublishedAt,
  assignmentViewsAndMetrics,
  computeLivePricingBreakdown,
  creatorCumulViews,
  effectiveBonusPricing,
  natureRewardsDue,
  promoVideoCost,
  type PricingBreakdown,
} from "./pricing";
import { cyclePaymentsForCreator, periodOf } from "./payments";
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
  type AbPersonArmsPayload,
  type AbArmsPayload,
  type SubsByMembershipPayload,
} from "./posthogSync";
// `internalAccountsFor` n'est plus appelé ici : la config A4 arrive désormais
// par collectProjectWhopPayments (point de passage unique).
import { isInternalWhopMembership } from "./internalAccounts";
import { collectProjectWhopPayments } from "./whopPaymentsAccess";
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

/**
 * LUNDI (Europe/Paris) de la semaine d'un ts → "YYYY-MM-DD". Clé des cohortes
 * d'acquisition : même fuseau que le reste du hub, sinon une cohorte changerait
 * de semaine selon l'heure de la journée.
 */
function parisWeek(ms: number): string {
  const day = parisDay(ms); // "YYYY-MM-DD" en Europe/Paris
  const d = new Date(`${day}T00:00:00Z`);
  // getUTCDay : 0 = dimanche → on ramène au lundi précédent.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
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
  /**
   * Part de ce coût engagée pour les posts PROMO : fixe entier + la seule part du
   * CPM gagnée sur des vues promo. Égal à `cost` sauf sur une vidéo MIXTE (post
   * promo + post warmup rémunéré) — voir promoVideoCost. Base des indicateurs
   * divisés par des vues promo, pour que numérateur et dénominateur portent sur
   * le même périmètre. null aux mêmes conditions que `cost`.
   */
  promoCost: number | null;
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
   *  - `total` = coût COMPLET du moteur (fixe + CPM + 100 % du bonus cash + les
   *    récompenses en NATURE déjà DUES), tous posts payables, warmup rémunéré
   *    INCLUS (sans warmup aucun compte ne publie de promo). Les récompenses en
   *    nature NON franchies n'y sont PAS : un palier pas atteint est un
   *    engagement, pas une dépense (elles vivent dans `getNatureRewards`) ;
   *  - `promo` = fixe + CPM des publications PROMO (non-warmup), sommés depuis la
   *    paie RÉELLE de ces vidéos, jamais un ratio de vues ;
   *  - `promoBonus` = le bonus paliers EN ENTIER (100 %), plus aucun prorata.
   *    Depuis le 2026-08-07 (commit 2b7a1e6) un palier ne se gagne QUE sur des vues
   *    rémunérées ET promo (`bonusTierViews`, cf pricing.creatorCumulViews) : chaque
   *    vue qui a servi à débloquer un palier est une vue promo, donc la totalité du
   *    bonus est un coût promo. Ce n'est plus une estimation mais une mesure.
   *    Le coût d'acquisition = promo + promoBonus.
   * `promo`/`promoBonus` sont `null` seulement si un coût PAR VIDÉO manque (legacy
   * sans pricingSnapshot) → tiret, jamais une paie inventée.
   */
  costs: {
    total: number;
    promo: number | null;
    promoBonus: number | null;
    /**
     * Part des vues PAYABLES qui sont promo (0–1) — DIAGNOSTIC seulement. Ce fut la
     * clé de répartition du bonus jusqu'au 2026-08-07 ; elle ne l'est PLUS (voir
     * `promoBonus`). Reste exposée parce qu'elle chiffre le poids du warmup
     * rémunéré dans le CPM payé (≈ 0,25 en prod : les trois quarts du CPM portent
     * sur des vues hors promo).
     */
    promoViewShare: number;
    /** Bonus paliers cash TOTAL (niveau créatrice) — 100 % dans `total`. */
    bonusTotal: number;
    /**
     * Récompenses en NATURE déjà DUES (paliers franchis), valorisées à leur coût
     * réel figé. Incluses dans `total`, JAMAIS dans `promo`/`promoBonus` : un
     * iPhone ou une voiture n'est pas un coût par client, c'est un engagement
     * pris sur le volume.
     */
    natureDue: number;
    /**
     * Nb de récompenses en nature DUES dont le coût réel n'est pas renseigné —
     * elles sont donc ABSENTES de `natureDue` et de `total`. > 0 ⇒ l'UI doit dire
     * que le coût complet est sous-estimé, plutôt que de le présenter comme entier.
     */
    natureDueMissingCost: number;
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
    // `subs` ne compte QUE les nouveaux abonnés (renouvellements filtrés par
    // `is_renewal`, cf QUERIES.overview) : un réabonnement n'est pas attribuable à
    // la vidéo publiée ce jour-là, il ne doit donc pas entrer dans un jour solo.
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
      let promoCost: number | null = null;
      if (a.pricingSnapshot) {
        const b = await breakdownFor(a.creatorId, period);
        const perAssignment = b.perAssignment.find(
          (x) => x.assignmentId === (a._id as string),
        );
        const perPricing = b.perPricing.find(
          (p) => p.pricingId === (a.pricingSnapshot!.pricingId as string),
        );
        if (perAssignment || perPricing) {
          const fixed = perPricing?.fixePerVideo ?? 0;
          const cpm = perAssignment?.cpm ?? 0;
          cost = round2(fixed + cpm);
          promoCost = promoVideoCost(
            fixed,
            cpm,
            views.payableViews,
            views.bonusTierViews,
          );
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
        promoCost,
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
    const promoNullCost = promoRows.some((r) => r.promoCost === null);
    // `promoCost` et non `cost` : sur une vidéo MIXTE (post promo + post warmup
    // RÉMUNÉRÉ), le CPM payé sur les vues de warmup ne doit pas entrer dans un
    // coût que l'on divise ensuite par les seules vues promo. Aucune vidéo mixte
    // en prod au 07/08/2026 (les 10 posts warmup rémunérés sont sur des vidéos
    // 100 % warmup, déjà hors promoRows) : le total est donc inchangé aujourd'hui,
    // et le reste si le cas apparaît.
    const promoFixeCpm = round2(promoRows.reduce((s, r) => s + (r.promoCost ?? 0), 0));
    // Part des vues PAYABLES qui sont PROMO (bornée [0,1]) — DIAGNOSTIC seulement,
    // ce n'est PLUS la clé de répartition du bonus (voir juste en dessous).
    const totalPayableViews = rows.reduce((s, r) => s + r.payableViews, 0);
    const totalPromoViews = rows.reduce((s, r) => s + r.promoViews, 0);
    const promoViewShare =
      totalPayableViews > 0
        ? Math.min(1, totalPromoViews / totalPayableViews)
        : 0;
    // Bonus promo = 100 % du bonus, plus aucun prorata. Depuis le 2026-08-07
    // (commit 2b7a1e6) le cumul qui débloque un palier ne compte QUE les vues
    // rémunérées ET promo (`bonusTierViews`) : une vue de warmup ne fait plus
    // avancer un palier, donc tout bonus débloqué l'a été par du promo et sa
    // totalité est un coût promo. Le prorata précédent (× promoViewShare ≈ 0,25 en
    // prod) sous-comptait le bonus d'environ 75 % dans le coût d'acquisition.
    //
    // AUCUN régime transitoire n'est nécessaire : vérifié sur l'export prod du
    // 2026-08-07, la table `bonusUnlocks` est VIDE (le resync rétroactif du même
    // jour a révoqué le seul palier existant) et les 10 paiements sont tous
    // `accruing`, lineItems vides — aucun bonus n'a donc jamais été débloqué, a
    // fortiori aucun sur des vues warmup. Rien à conserver sous l'ancienne clé.
    const promoBonus = bonusTotal;

    // Récompenses en NATURE déjà dues (iPhone, MacBook, voiture…) : une dépense
    // réelle, invisible jusqu'ici parce que `bonusTierCashTotal` ne somme que le
    // cash. Elles entrent dans le coût COMPLET du moteur et nulle part ailleurs —
    // ce n'est pas un coût par client. Sans coût réel renseigné, une récompense
    // est comptée comme MANQUANTE plutôt qu'à 0 (un 0 se lirait « gratuit »).
    const natureEntries = await natureRewardsDue(ctx, ctx.projectId);
    const natureDue = round2(
      natureEntries.reduce((s, n) => s + (n.coutReel ?? 0), 0),
    );
    const natureDueMissingCost = natureEntries.filter(
      (n) => n.coutReel === null,
    ).length;

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
        total: round2(payableCost + bonusTotal + natureDue),
        promo: promoNullCost ? null : promoFixeCpm,
        promoBonus: promoNullCost ? null : promoBonus,
        promoViewShare: Math.round(promoViewShare * 1000) / 1000,
        bonusTotal,
        natureDue,
        natureDueMissingCost,
      },
    };
  },
});

// ─── Récompenses en nature (dû vs engagé) ────────────────────────────────────

/** Une ligne de la carte : un palier NATURE d'une grille, avec son état réel. */
export interface NatureRewardRow {
  seuilVues: number;
  libelle: string | null;
  /** Coût réel unitaire. null = non renseigné → tiret, jamais 0. */
  coutReel: number | null;
  /** Créatrices ayant DÉJÀ franchi ce palier (récompense due). */
  dueCount: number;
  /** Créatrices concernées par la grille et ne l'ayant PAS encore franchi. */
  engagedCount: number;
  /** Cumul de paliers de la créatrice la PLUS PROCHE, parmi les engagées. */
  closestCumul: number | null;
  closestCreatorName: string | null;
}

export interface NatureRewardsResult {
  /** Devise de la PAIE ($) — les coûts réels sont exprimés dedans. */
  payCurrency: string | null;
  rows: NatureRewardRow[];
  /** DÉPENSE : Σ des coûts réels des récompenses déjà dues. */
  dueTotal: number;
  /** Récompenses dues dont le coût réel manque (donc hors de `dueTotal`). */
  dueMissingCost: number;
  /** ENGAGEMENT, PAS une dépense : Σ des coûts réels des paliers pas encore franchis. */
  engagedTotal: number;
  /** Engagements dont le coût réel manque (donc hors de `engagedTotal`). */
  engagedMissingCost: number;
  /** Aucun palier nature dans aucune grille ⇒ la carte ne s'affiche pas. */
  hasNatureTiers: boolean;
  /** Aucun `coutReel` renseigné nulle part ⇒ l'UI explique quoi remplir et où. */
  anyCostConfigured: boolean;
}

/**
 * Récompenses en NATURE du projet, en séparant les deux natures de chiffre :
 *  - DÛ = palier franchi, l'objet est à livrer → c'est une DÉPENSE, et elle entre
 *    dans le coût complet du moteur (cf getAttribution.costs.natureDue) ;
 *  - ENGAGÉ = palier pas encore franchi → ce n'est PAS une dépense mais un
 *    engagement pris sur le volume. Il n'entre dans AUCUN coût, et la carte le
 *    dit : promettre une voiture à 100 M de vues doit être visible sans être
 *    compté comme dépensé.
 *
 * Les deux se lisent sur la grille EFFECTIVE de chaque créatrice (perso, sinon
 * défaut projet) — la même que celle qui pilote les déblocages, donc jamais un
 * palier affiché ici et non débloqué là-bas. Un engagement est compté PAR
 * CRÉATRICE : deux créatrices sur la même grille, c'est deux objets à prévoir.
 */
export const getNatureRewards = adminQuery({
  args: {},
  handler: async (ctx): Promise<NatureRewardsResult> => {
    const project = await ctx.db.get(ctx.projectId);
    const payCurrency = project?.payCurrency ?? null;
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();

    const due = await natureRewardsDue(ctx, ctx.projectId);
    const dueKey = (creatorId: string, seuil: number) => `${creatorId}:${seuil}`;
    const dueSet = new Set(due.map((d) => dueKey(d.creatorId as string, d.seuilVues)));

    // Regroupement par PALIER (seuil + libellé) : trois créatrices sur « iPhone 17
    // à 10 M » forment une ligne à trois engagements, pas trois lignes.
    const byTier = new Map<string, NatureRewardRow>();
    for (const creator of creators) {
      const eff = await effectiveBonusPricing(ctx, creator);
      if (!eff) continue;
      const natureTiers = eff.tiers.filter((t) => t.rewardType === "nature");
      if (natureTiers.length === 0) continue;
      const cumul = await creatorCumulViews(ctx, ctx.projectId, creator._id);
      for (const t of natureTiers) {
        const key = `${t.seuilVues}|${t.libelle ?? ""}`;
        const row: NatureRewardRow = byTier.get(key) ?? {
          seuilVues: t.seuilVues,
          libelle: t.libelle ?? null,
          coutReel: typeof t.coutReel === "number" ? t.coutReel : null,
          dueCount: 0,
          engagedCount: 0,
          closestCumul: null,
          closestCreatorName: null,
        };
        if (dueSet.has(dueKey(creator._id as string, t.seuilVues))) {
          row.dueCount += 1;
        } else {
          row.engagedCount += 1;
          // Créatrice la plus proche du seuil : la seule progression qui rende
          // l'engagement lisible (« la voiture est-elle une hypothèse lointaine ? »).
          if (row.closestCumul === null || cumul > row.closestCumul) {
            row.closestCumul = cumul;
            row.closestCreatorName = creator.name;
          }
        }
        byTier.set(key, row);
      }
    }

    const rows = [...byTier.values()].sort((a, b) => a.seuilVues - b.seuilVues);
    // Le DÛ se somme sur les unlocks RÉELS (coût FIGÉ au déblocage), pas sur la
    // grille courante : renégocier le prix ne réécrit pas ce qui est déjà dû.
    const dueTotal = round2(due.reduce((s, d) => s + (d.coutReel ?? 0), 0));
    const dueMissingCost = due.filter((d) => d.coutReel === null).length;
    const engagedTotal = round2(
      rows.reduce((s, r) => s + (r.coutReel ?? 0) * r.engagedCount, 0),
    );
    const engagedMissingCost = rows
      .filter((r) => r.coutReel === null)
      .reduce((s, r) => s + r.engagedCount, 0);

    return {
      payCurrency,
      rows,
      dueTotal,
      dueMissingCost,
      engagedTotal,
      engagedMissingCost,
      hasNatureTiers: rows.length > 0,
      anyCostConfigured:
        rows.some((r) => r.coutReel !== null) ||
        due.some((d) => d.coutReel !== null),
    };
  },
});

// ─── Quatre compteurs de vues (A2) ───────────────────────────────────────────

export interface ViewCountersResult {
  /** Σ toutes vues (warmup incl.) — usage : affichage et suivi. */
  totales: number;
  /** Σ vues des posts rémunérés — usage : fixe + CPM. */
  payables: number;
  /** Σ vues des posts non-warmup (promo) — usage : taux de conversion. */
  promo: number;
  /** Σ vues rémunérées ET en promo — usage : cumul des paliers de bonus. */
  paliers: number;
  /** Libellé d'usage de chaque compteur (la carte DÉCLARE lequel elle lit). */
  usage: {
    totales: string;
    payables: string;
    promo: string;
    paliers: string;
  };
  /** Nb de publications comptées (transparence). */
  publications: number;
}

/**
 * Les QUATRE compteurs de vues du projet (règle A2) — chacun sa base, JAMAIS
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
      paliers: counters.paliers,
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
  /** Devises PRÉSENTES (tout statut) — cf whopRevenue.currenciesPresent. */
  currenciesPresent: string[];
  /** Plusieurs devises en base, même si une seule encaissée. Ne zéroïse rien. */
  mixedCurrencyPresent: boolean;
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
  /**
   * REVENU PAR BRAS du test A/B. Voie PRIMAIRE : `metadata.abVariant` du
   * membership Whop. Voie de REPLI : `distinctId` → personne PostHog. Restreint
   * à la FENÊTRE DU TEST — les abonnements antérieurs n'ont pas de bras parce
   * que le test n'existait pas, les ranger en « inconnu » serait faux.
   */
  abRevenue: {
    /** Début de la fenêtre = 1er abonnement portant un bras (ms). null = pas de test. */
    startMs: number | null;
    rows: {
      variant: string;
      /** Net SÉCURISÉ rattaché à ce bras. */
      net: number;
      /** Abonnements rattachés à ce bras dans la fenêtre. */
      memberships: number;
      /** Dont rattachés par REPLI (distinctId), faute de metadata. */
      viaFallback: number;
      /**
       * Abonnements dont TOUT l'argent est en litige : ils expliquent un net à
       * 0,00 € qui, sans ça, se lirait comme une absence de conversion.
       */
      atRiskMemberships: number;
      /** Montant à risque correspondant (exclu du net). */
      atRiskAmount: number;
    }[];
    /** Abonnements où metadata et PostHog ne disent PAS le même bras. */
    divergences: { membershipId: string; metadata: string; posthog: string }[];
    /** Abonnements de la fenêtre sans bras par aucune des deux voies. */
    unattached: number;
  };
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
        currenciesPresent: [],
        mixedCurrencyPresent: false,
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
        abRevenue: { startMs: null, rows: [], divergences: [], unattached: 0 },
      };
    }

    // A4 — écarte les abonnements internes (par membershipId, cf internalAccounts)
    // AVANT toute agrégation ; on en tient le compte pour l'afficher. Le filtre
    // passe par le point de passage unique (convex/whopPaymentsAccess).
    const {
      payments,
      internalMemberIds: internalMembers,
      cfg: internalCfg,
    } = await collectProjectWhopPayments(ctx, ctx.projectId, project.slug);

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

    // ─── REVENU PAR BRAS (test A/B) ───────────────────────────────────────────
    // Voie PRIMAIRE : metadata.abVariant du membership Whop (posée au checkout,
    // insensible au dénouement du paiement). Voie de REPLI : distinctId →
    // personne PostHog. Une DIVERGENCE entre les deux est SIGNALÉE plutôt que
    // tranchée en silence : un rattachement faux est pire qu'un rattachement absent.
    // Fenêtre restreinte au TEST : les abonnements antérieurs n'ont pas de bras
    // parce que le test n'existait pas — les ranger en « inconnu » serait faux.
    const abMemberships = await ctx.db
      .query("whopMemberships")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    // Repli : table distinct_id → bras, lue dans le cache PostHog.
    const armsRow = await ctx.db
      .query("posthogCache")
      .withIndex("by_project_key", (q) =>
        q.eq("projectId", ctx.projectId).eq("key", POSTHOG_CACHE_KEYS.abPersonArms),
      )
      .first();
    let armsPayload: AbPersonArmsPayload = { rows: [] };
    if (armsRow && armsRow.json !== "") {
      try {
        armsPayload = JSON.parse(armsRow.json) as AbPersonArmsPayload;
      } catch {
        armsPayload = { rows: [] };
      }
    }
    const personArms = new Map(
      armsPayload.rows.map((r) => [r.distinctId, r.variant] as const),
    );
    // Début du test = celui du CACHE POSTHOG (1re émission d'experiment_variant),
    // la même borne que le tableau par bras. Le déduire du 1er membership portant
    // un abVariant datait le test de sa 1re VENTE : tout abonnement conclu entre
    // le lancement et cette vente tombait « hors fenêtre » et perdait son revenu.
    // Repli sur les memberships tant que le cache PostHog n'a pas tourné.
    const abArmsRow = await ctx.db
      .query("posthogCache")
      .withIndex("by_project_key", (q) =>
        q.eq("projectId", ctx.projectId).eq("key", POSTHOG_CACHE_KEYS.abArms),
      )
      .first();
    let abArmsStartMs: number | null = null;
    if (abArmsRow && abArmsRow.json !== "") {
      try {
        abArmsStartMs = (JSON.parse(abArmsRow.json) as AbArmsPayload).startMs;
      } catch {
        abArmsStartMs = null;
      }
    }
    const abStartMs =
      abArmsStartMs ??
      abMemberships.reduce<number | null>(
        (min, m) =>
          m.abVariant ? (min === null || m.createdAt < min ? m.createdAt : min) : min,
        null,
      );
    const netByMembership = new Map<string, { net: number; atRisk: number }>();
    for (const p of payments) {
      if (!p.membershipId) continue;
      if (isInternalWhopMembership(p.membershipId, internalCfg)) continue;
      const a = netByMembership.get(p.membershipId) ?? { net: 0, atRisk: 0 };
      a.net = round2(a.net + whopNetContribution(p));
      if (p.status === "disputed") {
        a.atRisk = round2(a.atRisk + Math.max(0, p.netAmount - p.refundedAmount));
      }
      netByMembership.set(p.membershipId, a);
    }
    const armAcc = new Map<
      string,
      { net: number; memberships: number; viaFallback: number; atRiskMemberships: number; atRiskAmount: number }
    >();
    const abDivergences: { membershipId: string; metadata: string; posthog: string }[] = [];
    let abUnattached = 0;
    for (const m of abMemberships) {
      if (isInternalWhopMembership(m.whopMembershipId, internalCfg)) continue;
      if (abStartMs === null || m.createdAt < abStartMs) continue; // hors fenêtre du test
      if (m.abForced === true) continue; // session de QA : hors revenu comme hors events
      const fromPosthog = m.distinctId ? personArms.get(m.distinctId) : undefined;
      const variant = m.abVariant ?? fromPosthog;
      if (!variant) {
        abUnattached += 1;
        continue;
      }
      if (m.abVariant && fromPosthog && m.abVariant !== fromPosthog) {
        abDivergences.push({
          membershipId: m.whopMembershipId,
          metadata: m.abVariant,
          posthog: fromPosthog,
        });
      }
      const money = netByMembership.get(m.whopMembershipId) ?? { net: 0, atRisk: 0 };
      const a =
        armAcc.get(variant) ??
        { net: 0, memberships: 0, viaFallback: 0, atRiskMemberships: 0, atRiskAmount: 0 };
      a.net = round2(a.net + money.net);
      a.memberships += 1;
      if (!m.abVariant) a.viaFallback += 1;
      if (money.atRisk > 0) {
        a.atRiskMemberships += 1;
        a.atRiskAmount = round2(a.atRiskAmount + money.atRisk);
      }
      armAcc.set(variant, a);
    }
    const abRevenue = {
      startMs: abStartMs,
      rows: [...armAcc.entries()]
        .map(([variant, a]) => ({ variant, ...a }))
        .sort((x, y) => x.variant.localeCompare(y.variant)),
      divergences: abDivergences,
      unattached: abUnattached,
    };

    return {
      configured: true,
      currency: summary.currency,
      mixedCurrency: summary.mixedCurrency,
      currenciesPresent: summary.currenciesPresent,
      mixedCurrencyPresent: summary.mixedCurrencyPresent,
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
      abRevenue,
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
   * `billing_reason`. Ni acquisition ni rétention — affiché pour éviter de lire
   * une part de rétention faussement basse.
   */
  unknownPayments: number;
  /** Renouvellements par offre (libellé joint côté client via planLabels). */
  byPlan: { planId: string; renewalCount: number; renewalNet: number; members: number }[];
  /** Issues des échéances : renouvelée / échouée / EN ATTENTE / pas encore due. */
  due: { renewed: number; failed: number; pending: number; notYetDue: number };
  renewalRateResolved: number | null;
  renewalRateWorstCase: number | null;
  resolvedDueCount: number;
  averageCycles: number | null;
  cycleDistribution: { cycles: number; members: number }[];
  netPerPayment: number | null;
  netTotal: number;
  revenueToDatePerClient: number | null;
  /** Dénominateur RÉEL du ratio : clients au net sécurisé (litiges exclus). */
  securedMembers: number;
  /** Clients dont tout l'argent est en litige — hors ratio, affichés à part. */
  atRiskOnlyMembers: number;
  /** Devises des paiements sécurisés : >1 ⇒ aucun ratio n'est calculable (A5). */
  securedCurrencies: string[];
  projectedPerClientResolved: number | null;
  projectedPerClientWorstCase: number | null;
  cohorts: {
    week: string;
    clients: number;
    cycles: number;
    net: number;
    netPerClient: number;
    /** Cycles comptés mais à 0 au net (litige en cours / remboursement). */
    cyclesWithoutNet: number;
  }[];
  matureShare: number | null;
  payingMembers: number;
  pendingRenewalAmount: number;
  /** Issues de renouvellement PAR OFFRE — révèle un problème de pricing. */
  byPlanOutcome: {
    planId: string;
    renewed: number;
    pending: number;
    failed: number;
    rateResolved: number | null;
    rateWorstCase: number | null;
    topFailureCause: string | null;
    pendingAmount: number;
  }[];
  /** Causes d'échec de renouvellement telles que Whop les formule. */
  failureCauses: { cause: string; count: number }[];
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
    const [members, collected, plans] = await Promise.all([
      ctx.db
        .query("whopMemberships")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      collectProjectWhopPayments(ctx, ctx.projectId, project.slug),
      ctx.db
        .query("whopPlans")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);
    // A4 via le point de passage unique : `payments` est déjà purgé des internes.
    const { payments, cfg: internalCfg } = collected;

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
      { now: Date.now(), weekKeyOf: parisWeek },
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
      ...stats,
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
   * COUVERTURE DU CALENDRIER — assignations avec / sans date de post.
   *
   * Une assignation sans `postDate` est hors calendrier : elle ne compte NI au
   * numérateur NI au dénominateur du taux à l'heure. Sans ce contrôle, un quart
   * des livrables peut être hors mesure sans que rien ne le dise.
   * Ne dépend PAS de PostHog.
   */
  publicationCoverage: {
    total: number;
    planned: number;
    unplanned: number;
  };
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
    /**
     * Paiements COMPOSANT le revenu net, par jour Paris (paid|disputed). Sert au
     * contrôle de ligne : « nouveaux clients + renouvellements » doit égaler ce
     * nombre. Un écart = un paiement compté deux fois (typiquement un
     * renouvellement qui est AUSSI le premier encaissement de son abonnement,
     * quand le paiement initial a été remboursé).
     */
    dailyPaymentCount: { day: string; payments: number }[];
    /**
     * Clients dont AU MOINS un paiement contribue au net SÉCURISÉ. Dénominateur
     * du revenu par client : le numérateur exclut les litiges, le dénominateur
     * doit les exclure aussi (sinon la moyenne est tirée vers le bas en silence).
     * `whopMembersTotal` reste le compte de clients ACQUIS (litiges inclus).
     */
    whopSecuredMembers: number | null;
    /** Tentatives de paiement ÉCHOUÉES Whop PAR JOUR Paris (statut "failed",
     *  internes exclus) — colonne « Échecs » du Détail par jour. Une tentative
     *  échouée n'est PAS un client (0 au net) mais doit être visible. */
    dailyFailedPayments: { day: string; count: number }[];
    /** subs PostHog par jour Paris — SEULEMENT pour le contrôle croisé PostHog↔Whop
     *  (le funnel garde PostHog ; l'affichage « Clients payants » passe sur Whop). */
    dailySubs: { day: string; subs: number }[];
    /** subs PostHog par (jour Paris, membership_id) — réconciliation fine du
     *  contrôle croisé (cf lib/analytics-hub.reconcileDailyClients). */
    subsByMembership: { day: string; membershipId: string; persons: number }[];
    /** Jour Paris du 1er paiement encaissé PAR membership Whop (internes exclus)
     *  — l'autre moitié de la réconciliation. */
    whopFirstPaidDay: { membershipId: string; day: string }[];
    /** Jour Paris courant — exclu du contrôle croisé (partiel des deux côtés). */
    todayParis: string;
    /**
     * MONTANT DÛ — le total affiché doit égaler la somme de ses PARTS.
     *
     * `totalDue` d'un cycle est calculé une fois (lignes legacy + fixe + CPM +
     * bonus paliers) puis affiché tel quel ; rien ne vérifiait qu'il concordait
     * encore avec le détail présenté juste à côté. Un écart signale un moteur qui
     * a dérivé de son propre détail — c'est ce contrôle qui aurait cadré la
     * divergence du barème édité en place.
     */
    payDue: {
      /** Σ des `totalDue` des cycles NON payés (ce que le dashboard affiche). */
      displayedTotal: number;
      /** Σ des PARTS de ces mêmes cycles, recomposée depuis le détail. */
      recomputedTotal: number;
      cycles: number;
      creators: number;
    };
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
    // Borne devenue LÂCHE côté clients : la série quotidienne exclut les
    // renouvellements alors que le total d'atteinte les inclut, donc Σ < total est
    // désormais l'état normal — le contrôle n'attrape plus qu'un dépassement franc.
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
    // Subs par (jour, membership_id) — la CLÉ qui rend l'écart explicable
    // (retry rejoué un autre jour, sub sans paiement encaissé, paiement sans
    // event). Cache vide avant le 1er cron post-deploy → le contrôle retombe
    // sur la comparaison brute, jamais sur une explication inventée.
    const subsByMembership = read<SubsByMembershipPayload>(
      POSTHOG_CACHE_KEYS.subsByMembership,
      { rows: [] },
    ).rows;

    // ─── Montant dû : total affiché vs somme de ses parts ───────────────────
    // On repasse par la MÊME source que l'écran Paiements (cyclePaymentsForCreator)
    // et on recompose le total depuis son détail. Les deux doivent coïncider.
    let dueDisplayed = 0;
    let dueRecomputed = 0;
    let dueCycles = 0;
    let dueCreators = 0;
    const allCreators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    for (const cre of allCreators) {
      const cycles = await cyclePaymentsForCreator(
        ctx,
        ctx.projectId,
        cre._id,
        Date.now(),
      );
      let touched = false;
      for (const cy of cycles) {
        if (cy.status === "paid") continue;
        const parts =
          cy.lineItems.reduce((s, li) => s + li.amount, 0) +
          cy.pricingBreakdown.fixedTotal +
          cy.pricingBreakdown.cpmTotal +
          cy.pricingBreakdown.bonusTierCashTotal;
        dueDisplayed += cy.totalDue;
        dueRecomputed += parts;
        dueCycles += 1;
        touched = true;
      }
      if (touched) dueCreators += 1;
    }
    const payDue = {
      displayedTotal: Math.round(dueDisplayed * 100) / 100,
      recomputedTotal: Math.round(dueRecomputed * 100) / 100,
      cycles: dueCycles,
      creators: dueCreators,
    };

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
    let whopFirstPaidDay: { membershipId: string; day: string }[] = [];
    let dailyRenewals: { day: string; renewals: number }[] = [];
    let dailyPaymentCount: { day: string; payments: number }[] = [];
    let whopSecuredMembers: number | null = null;
    let dailyFailedPayments: { day: string; count: number }[] = [];
    let whopInternalExcluded = 0;
    let whopSyncMs: number | null = null;
    let membershipDuplicates: ReliabilityResult["membershipDuplicates"] = {
      memberships: 0,
      users: 0,
      duplicates: [],
    };
    if (project?.whop) {
      // A4 — comptes internes exclus DES DEUX CÔTÉS : ici aussi (pas seulement du
      // revenu), sinon « Clients payants » comptait le compte de test de l'admin.
      const {
        payments,
        all: allPayments,
        internalMemberIds: internalMembers,
        cfg: internalCfg,
      } = await collectProjectWhopPayments(ctx, ctx.projectId, project.slug);
      // Contrôle « Aucune addition inter-devises » : il comptait jusqu'ici les
      // devises ENCAISSÉES (summarizeWhopRevenue.currencies), donc il était
      // aveugle à une devise n'apparaissant qu'en échec, remboursement ou litige
      // — exactement les lignes qui traversent les sommes non gardées. On compte
      // désormais les devises PRÉSENTES, et sur le lot COMPLET : une devise qui
      // n'existe que sur un compte interne reste une devise présente en base.
      currencyCount = summarizeWhopRevenue(allPayments).currenciesPresent.length;
      // Fraîcheur de synchro : sur TOUT le lot, le cron ingère aussi les internes.
      for (const p of allPayments) {
        whopSyncMs = Math.max(whopSyncMs ?? 0, p.updatedAt);
      }
      // Premier paiement encaissé par membership (date de « début » du client).
      const firstPaid = new Map<string, number>();
      for (const p of payments) {
        // COMPTE clients : un litige EN COURS reste un client qui a payé →
        // whopCollectedAmount (inclut "disputed"), PAS whopNetContribution (qui
        // exclut le litige du net). Garde « Clients payants » stable et aligné
        // avec PostHog (subscription_completed a bien été émis pour ce client).
        if (!p.membershipId || whopCollectedAmount(p) <= 0) continue;
        const prev = firstPaid.get(p.membershipId);
        if (prev === undefined || p.paidAt < prev) firstPaid.set(p.membershipId, p.paidAt);
      }
      // Compté sur TOUS les paiements internes, pas seulement ceux ayant
      // encaissé : l'ancien test était placé APRÈS la garde
      // `whopCollectedAmount <= 0`, donc un compte interne n'ayant jamais payé
      // n'était jamais compté comme exclu — le KPI sous-estimait l'exclusion.
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
      whopFirstPaidDay = [...firstPaid.entries()].map(([membershipId, ms]) => ({
        membershipId,
        day: parisDay(ms),
      }));

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

      // Paiements composant le net, par jour + clients au net SÉCURISÉ.
      const payCountByDay = new Map<string, number>();
      const secured = new Set<string>();
      for (const p of payments) {
        if (!p.membershipId || whopCollectedAmount(p) <= 0) continue;
        if (isInternalWhopMembership(p.membershipId, internalCfg)) continue;
        const day = parisDay(p.paidAt);
        payCountByDay.set(day, (payCountByDay.get(day) ?? 0) + 1);
        if (whopNetContribution(p) > 0) secured.add(p.membershipId);
      }
      dailyPaymentCount = [...payCountByDay.entries()]
        .map(([day, count]) => ({ day, payments: count }))
        .sort((a, b) => (a.day < b.day ? -1 : 1));
      whopSecuredMembers = secured.size;

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

      // Contrôle « N abonnements pour M personnes ». Il ANNOTE « Clients payants »
      // et DOIT donc porter sur la MÊME population : les memberships ayant au
      // moins un paiement encaissé (`firstPaid`), pas tous les memberships non
      // brouillons. Sinon l'écran affiche deux effectifs différents côte à côte
      // pour ce qui se lit comme la même notion — vérifié en prod : 37 contre 35,
      // l'écart étant deux abonnements annulés dont l'unique paiement a été
      // intégralement remboursé (donc pas des clients payants).
      // `whopUserId` n'est peuplé qu'à partir de la re-synchro : les memberships
      // sans user sont ignorés (le contrôle s'allume quand la synchro l'a rempli).
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
        if (!firstPaid.has(m.whopMembershipId)) continue;
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

    // COUVERTURE DU CALENDRIER — combien d'assignations n'ont PAS de date de
    // post. Elles sortent du taux à l'heure DES DEUX CÔTÉS de la fraction : ni
    // numérateur, ni dénominateur. Au relevé du 2026-08-14, 51 sur 202 — un quart
    // des livrables hors mesure, ce qui ne se lisait nulle part.
    //
    // ⚠️ INDÉPENDANT de PostHog : ce contrôle porte sur des données du projet, il
    // doit s'afficher même sur un projet sans PostHog configuré.
    const tousAssignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const planifies = tousAssignments.filter(
      (a) => a.postDate !== undefined,
    ).length;

    return {
      configured,
      computedAt: posthogSyncMs,
      instrumentation,
      internalExcluded,
      whopInternalExcluded,
      publicationCoverage: {
        total: tousAssignments.length,
        planned: planifies,
        unplanned: tousAssignments.length - planifies,
      },
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
        dailyPaymentCount,
        whopSecuredMembers,
        dailyFailedPayments,
        dailySubs,
        subsByMembership,
        whopFirstPaidDay,
        todayParis,
        payDue,
      },
      freshness: [
        { source: "posthog", lastSyncMs: posthogSyncMs },
        { source: "whop", lastSyncMs: whopSyncMs },
        { source: "scraping", lastSyncMs: scrapingSyncMs },
      ],
    };
  },
});
