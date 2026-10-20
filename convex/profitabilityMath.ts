/**
 * Rentabilité par projet — logique PURE (testée Vitest, aucune dép Convex/React).
 *
 * Vit dans convex/ pour servir l'écran (via lib/profitability, qui ré-exporte) ET
 * l'outil MCP `rentabilite` : A6 interdit `convex/ → lib/`, pas l'inverse. Une
 * seule implémentation, donc Claude et la carte Rentabilité annoncent les mêmes
 * chiffres.
 *
 * Met en face le REVENU Whop net (prompt 2) et le COÛT créateurs (moteur de paie,
 * posts non rémunérés déjà exclus) → MARGE = revenu net − coût. Plus un
 * RPM BUSINESS = revenu net / (vues / 1000).
 *
 * TOGGLE : il change UNIQUEMENT le DÉNOMINATEUR (les vues), JAMAIS le revenu ni
 * le coût.
 *   - sans les non rémunérées : vues = posts RÉMUNÉRÉS → vrai RPM business ;
 *   - avec : vues = toutes les vues → RPM dilué.
 * Le revenu Whop ne dépend pas des posts → identique dans les deux cas.
 *
 * ⚠️ « rémunéré » n'est PAS « non-warmup » : cf `ViewsSplit`. Le dénominateur
 * suit la paie, sinon le RPM raconte une histoire que le grand livre contredit.
 */

import { effectiveFxRate } from "./currencyRate";
import { payCutoffAt } from "./payWindow";
import { isRemunerated } from "./remunerate";
import type { Id } from "./_generated/dataModel";
import type { PostFacturable, VideoFacturable } from "./viewsDaily";
import type { WhopRevenueSummary } from "./whopRevenue";

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

/**
 * Marge, DANS LA DEVISE DU REVENU = revenu net − coût créateurs converti. Le revenu
 * est en euros, le coût en dollars : `fxRateToRevenue` exprime 1 unité de paie dans
 * la devise du revenu (1 si même devise). SANS taux (`null`), la marge n'est PAS
 * calculée — on ne soustrait jamais deux devises sans conversion. Peut être négative.
 */
export function computeMargin(
  revenueNet: number,
  creatorCost: number,
  fxRateToRevenue: number | null,
): number | null {
  if (fxRateToRevenue === null || !(fxRateToRevenue > 0)) return null;
  return round2(finite(revenueNet) - finite(creatorCost) * fxRateToRevenue);
}

/**
 * RPM business = revenu net pour 1000 vues = revenu net / (vues / 1000). null si
 * vues ≤ 0 (RPM indéfini). Basé sur le REVENU (jamais le coût), cf décision.
 */
export function computeRpm(revenueNet: number, views: number): number | null {
  const v = finite(views);
  if (!(v > 0)) return null;
  return round2(finite(revenueNet) / (v / 1000));
}

/**
 * Ventilation des vues d'un projet : RÉMUNÉRÉES vs non rémunérées.
 *
 * ⚠️ La coupure est FINANCIÈRE, pas éditoriale (cf convex/viewCounters
 * `viewsSplitOf`, qui la calcule) : `unpaidViews` contient le warmup ET les posts
 * retirés de la paie à la main, et n'exclut PAS un post warmup explicitement payé.
 * Le champ s'appelait `warmupViews` — un nom qui décrivait mal son contenu, et un
 * calcul qui, lui, s'y conformait à tort.
 */
export interface ViewsSplit {
  /** Vues des posts RÉMUNÉRÉS — dénominateur du VRAI RPM business. */
  paidViews: number;
  /** Vues des posts NON rémunérés (warmup, ou explicitement retirés de la paie). */
  unpaidViews: number;
}

/**
 * Vues retenues selon le toggle : sans les non rémunérées = monétisées seules ;
 * avec = toutes. SEUL levier du toggle sur les métriques de vues.
 */
export function viewsForToggle(split: ViewsSplit, includeUnpaid: boolean): number {
  const monetized = Math.max(0, finite(split.paidViews));
  const unpaid = Math.max(0, finite(split.unpaidViews));
  return includeUnpaid ? monetized + unpaid : monetized;
}

export interface ProfitabilityInput extends ViewsSplit {
  /** Revenu Whop NET (après frais), en devise du revenu (€) — CONSTANT vis-à-vis du toggle. */
  revenueNet: number;
  /** Coût créateurs (fixe + CPM + bonus, non rémunérés déjà exclus), en devise de paie ($) — CONSTANT. */
  creatorCost: number;
  /** Taux paie→revenu EFFECTIF (1 si même devise, null si non reliées). Voir lib/currency. */
  fxRateToRevenue: number | null;
}

export interface ProfitabilityMetrics {
  /** Constant (ne bouge PAS avec le toggle). Devise du revenu. */
  revenueNet: number;
  /** Constant. Devise de la paie. */
  creatorCost: number;
  /** Constant : revenu net − coût converti (devise du revenu). null si devises non reliées. */
  margin: number | null;
  /** Dépend du toggle (monétisées vs toutes). */
  views: number;
  /** Dépend du toggle : revenu net / (vues / 1000) ; null si 0 vue. Devise du revenu. */
  rpm: number | null;
  includeUnpaid: boolean;
}

/**
 * Métriques de rentabilité pour un état de toggle donné. `revenueNet`,
 * `creatorCost` et `margin` sont INVARIANTS ; seuls `views` et `rpm` changent
 * avec `includeUnpaid` (dilution du RPM quand on inclut les vues non rémunérées).
 */
export function computeProfitability(
  input: ProfitabilityInput,
  includeUnpaid: boolean,
): ProfitabilityMetrics {
  const views = viewsForToggle(input, includeUnpaid);
  return {
    revenueNet: round2(finite(input.revenueNet)),
    creatorCost: round2(finite(input.creatorCost)),
    margin: computeMargin(input.revenueNet, input.creatorCost, input.fxRateToRevenue),
    views,
    rpm: computeRpm(input.revenueNet, views),
    includeUnpaid,
  };
}

/** Revenu, coût et vues d'une période — ce que sert `getProjectProfitability`. */
export interface ProfitabilityTotals extends ViewsSplit {
  revenueNet: number;
  creatorCost: number;
}

/** La réponse de `getProjectProfitability` (projet configuré), réduite à ce qu'on calcule. */
export interface ProfitabilitySource<M extends ProfitabilityTotals = ProfitabilityTotals> {
  /** Devise du REVENU (Whop). */
  currency: string | null;
  /** Devise de la PAIE créatrices. */
  payCurrency: string | null;
  fxRateToRevenue: number | null;
  total: ProfitabilityTotals;
  months: readonly M[];
}

export interface ProfitabilityReport<M extends ProfitabilityTotals = ProfitabilityTotals> {
  /** Taux paie → revenu RETENU (1 si même devise, null si non reliées). */
  fxRate: number | null;
  total: ProfitabilityMetrics;
  /** Chaque mois tel que servi, avec ses métriques calculées. */
  months: Array<M & { metrics: ProfitabilityMetrics }>;
}

/**
 * LE calcul de rentabilité d'un projet — cumul et mois par mois, pour un état du
 * toggle. La carte Rentabilité (écran Paiements) et l'outil MCP `rentabilite`
 * l'appellent tous les deux : ce que Claude annonce est ce que l'écran affiche,
 * au centime près, parce que c'est la même fonction.
 */
export function profitabilityReport<M extends ProfitabilityTotals>(
  source: ProfitabilitySource<M>,
  includeUnpaid: boolean,
): ProfitabilityReport<M> {
  const fxRate = effectiveFxRate(
    source.payCurrency,
    source.currency,
    source.fxRateToRevenue,
  );
  const metriques = (x: ProfitabilityTotals) =>
    computeProfitability({ ...x, fxRateToRevenue: fxRate }, includeUnpaid);
  return {
    fxRate,
    total: metriques(source.total),
    months: source.months.map((m) => ({ ...m, metrics: metriques(m) })),
  };
}

/**
 * LES VIDÉOS FACTURÉES, prêtes à dater leurs vues (cf convex/viewsDaily
 * `computeDailyBilledViews`) — le RPM de l'outil `rentabilite` sur une période.
 *
 * Le plafond de chaque vidéo est `billedViews` du moteur de paie, pris tel quel :
 * plafond 150 $/vidéo, fenêtre J+30 et assiette d'un cycle réglé y sont déjà.
 * Ses posts sont ceux que le moteur lit (`assignmentViewsAndMetrics`) : cibles +
 * publication legacy, sans doublon, RÉMUNÉRÉS seulement — la coupure financière
 * `isRemunerated`, jamais `isWarmup` (un warmup payé à la main compte, un post
 * retiré de la paie non). Leur coupure est celle du moteur (`payCutoffAt`).
 *
 * Une vidéo qui ne facture rien est écartée : ses vues ne sont pas achetées.
 */
export function videosFacturables(
  /** assignmentId → vues facturées du moteur (dû, ou engagé pour le mois en cours). */
  billedByAssignment: ReadonlyMap<string, number>,
  assignments: ReadonlyMap<
    string,
    {
      targets?: readonly { publicationId?: string }[];
      publicationId?: string;
    }
  >,
  publications: ReadonlyMap<
    string,
    {
      datePubli: number;
      isWarmup?: boolean;
      remunere?: boolean;
      sparkAdLaunchedAt?: number;
    }
  >,
): VideoFacturable[] {
  const videos: VideoFacturable[] = [];
  for (const [assignmentId, plafond] of billedByAssignment) {
    if (!(plafond > 0)) continue;
    const a = assignments.get(assignmentId);
    if (a === undefined) continue;
    const ids = new Set(
      [...(a.targets ?? []).map((t) => t.publicationId), a.publicationId].filter(
        (x): x is string => x !== undefined,
      ),
    );
    const posts: PostFacturable[] = [];
    for (const publicationId of ids) {
      const pub = publications.get(publicationId);
      if (pub === undefined) continue;
      if (!isRemunerated({ isWarmup: pub.isWarmup === true, remunere: pub.remunere })) {
        continue;
      }
      posts.push({
        publicationId,
        publishedAt: pub.datePubli,
        coupure: payCutoffAt(pub.datePubli, pub.sparkAdLaunchedAt ?? null),
      });
    }
    videos.push({ plafond, posts });
  }
  return videos;
}

/** Ce que la rentabilité lit SANS parcourir les créatrices. Sérialisable : il traverse `runQuery`. */
export type ProfitabilityBase = {
  configured: true;
  payCurrency: string | null;
  fxRateToRevenue: number | null;
  currentPeriod: string;
  revenueByMonth: { period: string; revenueNet: number; mixedCurrency: boolean }[];
  totalRevenue: Pick<
    WhopRevenueSummary,
    "net" | "currency" | "mixedCurrency" | "conversions" | "mixedCurrencyPresent" | "currenciesPresent"
  >;
  /** Créatrices qui COÛTENT (vidéos, paliers), dans l'ordre de première rencontre. */
  creatorIds: Id<"creators">[];
  /** Vues SUIVIES brutes par mois de publication (Paris), et leur total. */
  trackedViewsByMonth: { period: string; views: number }[];
  trackedViewsTotal: number;
  periode?: {
    du: string;
    au: string;
    revenueNet: number;
    revenueByDay: { jour: string; revenueNet: number }[];
  };
};

/** Le coût d'un lot de créatrices — la part lourde, découpable en plusieurs queries. */
export type ProfitabilityCreatorsPart = {
  /** Une entrée par créatrice du lot, dans l'ordre du lot. */
  creators: {
    months: { period: string; cost: number; billedViews: number; settled: boolean }[];
  }[];
  /** Vidéos facturées du lot, avec leurs posts rémunérés (période libre seulement). */
  videos: VideoFacturable[];
};

/** La moitié REVENU de la carte (query `getProfitabilityRevenue`) : Whop seul. */
export type ProfitabilityRevenue = Omit<
  ProfitabilityBase,
  "configured" | "creatorIds" | "trackedViewsByMonth" | "trackedViewsTotal"
>;

/**
 * La moitié COÛT de la carte (query `getProfitabilityCosts`) : un lot de
 * créatrices, et les vues suivies du projet — les mêmes dans chaque lot, lus
 * au même instant (Convex sert à un client des queries cohérentes entre elles).
 */
export type ProfitabilityCosts = Pick<
  ProfitabilityBase,
  "creatorIds" | "trackedViewsByMonth" | "trackedViewsTotal"
> & { part: ProfitabilityCreatorsPart };

/**
 * Le lot `lot` (0, 1…) sur `lots` : tranches CONTIGUËS, dans l'ordre. Mis bout à
 * bout, les lots redonnent la liste telle quelle — donc les mêmes sommes,
 * arrondies dans le même ordre (cf `assembleProfitability`).
 */
export function lotSlice<T>(items: readonly T[], lot: number, lots: number): T[] {
  if (!Number.isInteger(lots) || lots < 1 || !Number.isInteger(lot) || lot < 0 || lot >= lots) {
    throw new Error(`Lot ${lot} sur ${lots} : hors bornes`); // i18n-exempt: erreur interne de programmation
  }
  return items.slice(
    Math.floor((items.length * lot) / lots),
    Math.floor((items.length * (lot + 1)) / lots),
  );
}

/**
 * La carte recolle ses queries ICI, côté client comme côté serveur
 * (`getProjectProfitability`, un seul lot) : un seul assemblage, donc la même
 * réponse que la query unique d'avant. Les lots arrivent dans l'ordre.
 */
export function assembleRevenueAndCosts(
  revenue: ProfitabilityRevenue,
  lots: readonly ProfitabilityCosts[],
) {
  const [premier] = lots;
  if (premier === undefined) throw new Error("Aucun lot de coût à assembler"); // i18n-exempt: erreur interne de programmation
  return assembleProfitability(
    {
      configured: true,
      ...revenue,
      creatorIds: lots.flatMap((l) => l.creatorIds),
      trackedViewsByMonth: premier.trackedViewsByMonth,
      trackedViewsTotal: premier.trackedViewsTotal,
    },
    lots.map((l) => l.part),
  );
}

/**
 * L'assemblage — PUR. Les lots se recollent dans l'ordre de `base.creatorIds` :
 * c'est l'ordre de l'ancienne boucle unique, donc les mêmes sommes, arrondies
 * dans le même ordre.
 */
export function assembleProfitability(
  base: ProfitabilityBase,
  parts: readonly ProfitabilityCreatorsPart[],
) {
  const costByMonth = new Map<string, number>();
  const billedByMonth = new Map<string, number>();
  // Un mois n'est FIGÉ que si TOUTES les créatrices qui y coûtent le sont : il
  // suffit d'une vidéo encore vivante (cycle ouvert ET fenêtre ouverte) pour
  // que le mois bouge encore.
  // Un ET, donc, jamais un OU — annoncer « réglé » sur un mois qui va encore
  // grossir serait pire que de ne rien annoncer.
  const settledByMonth = new Map<string, boolean>();
  for (const part of parts) {
    for (const c of part.creators) {
      for (const { period: m, cost, billedViews, settled } of c.months) {
        costByMonth.set(m, round2((costByMonth.get(m) ?? 0) + cost));
        billedByMonth.set(m, (billedByMonth.get(m) ?? 0) + billedViews);
        settledByMonth.set(m, (settledByMonth.get(m) ?? true) && settled);
      }
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
  //
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
  for (const { period: m, views } of base.trackedViewsByMonth) {
    const paid = billedByMonth.get(m) ?? 0;
    viewsByMonth.set(m, {
      paidViews: paid,
      unpaidViews: Math.max(0, views - paid),
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
  const totUnpaid = Math.max(0, base.trackedViewsTotal - totPaid);

  // ─── Assemblage (mois présents dans revenu, coût OU vues), plus récent d'abord ─
  const revenueByMonth = new Map(base.revenueByMonth.map((r) => [r.period, r]));
  const allPeriods = new Set<string>([
    ...revenueByMonth.keys(),
    ...costByMonth.keys(),
    ...viewsByMonth.keys(),
  ]);
  const months = [...allPeriods]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((period) => ({
      period,
      revenueNet: revenueByMonth.get(period)?.revenueNet ?? 0,
      mixedCurrency: revenueByMonth.get(period)?.mixedCurrency ?? false,
      creatorCost: costByMonth.get(period) ?? 0,
      paidViews: viewsByMonth.get(period)?.paidViews ?? 0,
      unpaidViews: viewsByMonth.get(period)?.unpaidViews ?? 0,
      // Coût et vues FACTURÉES définitivement arrêtés (cycles réglés ou
      // fenêtres closes). Un mois sans aucune vidéo retenue n'est pas figé :
      // `settledByMonth` ne porte que les mois qui coûtent quelque chose.
      settled: settledByMonth.get(period) === true,
    }));

  // ─── Période LIBRE (outil MCP `rentabilite` avec du/au) ─────────────────────
  // Le revenu des jours demandés, et de quoi DATER les vues facturées de chaque
  // vidéo (cf convex/viewsDaily `computeDailyBilledViews`).
  const periode:
    | {
        du: string;
        au: string;
        revenueNet: number;
        revenueByDay: { jour: string; revenueNet: number }[];
        videos: VideoFacturable[];
      }
    | undefined =
    base.periode === undefined
      ? undefined
      : { ...base.periode, videos: parts.flatMap((p) => p.videos) };

  const totalRevenue = base.totalRevenue;
  return {
    configured: true as const,
    // Devise du REVENU (Whop) ; la paie créatrices a la sienne (payCurrency).
    currency: totalRevenue.currency,
    payCurrency: base.payCurrency,
    // Taux paie→revenu pour la marge (revenu € − coût $ converti). null → marge
    // non calculée (jamais soustraire deux devises sans conversion).
    fxRateToRevenue: base.fxRateToRevenue,
    currentPeriod: base.currentPeriod,
    // A5 — le drapeau était calculé puis jeté : la carte affichait un revenu
    // zéroïsé (donc une marge très négative) comme s'il s'agissait d'un vrai
    // montant. Un chiffre faux est pire qu'un chiffre absent.
    mixedCurrency: totalRevenue.mixedCurrency,
    conversions: totalRevenue.conversions,
    mixedCurrencyPresent: totalRevenue.mixedCurrencyPresent,
    currenciesPresent: totalRevenue.currenciesPresent,
    total: {
      revenueNet: totalRevenue.net,
      creatorCost: totalCost,
      paidViews: totPaid,
      unpaidViews: totUnpaid,
    },
    months,
    ...(periode !== undefined ? { periode } : {}),
  };
}
