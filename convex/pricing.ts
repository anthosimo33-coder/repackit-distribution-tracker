import {
  creatorQuery,
  e2eMutation,
  permissionMutation,
  permissionQuery,
} from "./functions";
import { collectAvailability } from "./collectAvailability";
import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { periodOf } from "./payments";
import { cycleIndexOf, cyclePeriodKey, cycleWindow } from "./payCycle";
import { isRemunerated, type RemunerationFlags } from "./remunerate";
import { isBonusTierPost, isPromoPost } from "./viewCounters";
import {
  aggregatePayWindow,
  payWindowEndsAt,
  payWindowIsClosed,
  retainedViews,
  type RetainedViews,
} from "./payWindow";
import { ERR, err } from "./errorCodes";

/**
 * Pricing v2 — barèmes + MOTEUR de paie (réplique serveur).
 *
 * ⚠️ ARGENT. computeMonthlyPayout / assignmentCpm / tiersOf / evaluateBonusTiers
 * DOIVENT rester IDENTIQUES à lib/pricing-engine.ts (testé Vitest ; règle A6 —
 * un module convex/ ne peut pas importer lib/). Toute évolution = des DEUX côtés.
 *
 * v2 : le bonus PAR VIDÉO de v1 est RETIRÉ du moteur ; le bonus est désormais à
 * PALIERS sur le cumul de vues du créateur (cf bonusUnlocks + computeLive…).
 *
 * ⚠️ TS7022 — computeLivePricingBreakdown / syncBonusUnlocks sont annotés.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Plafond DUR de rémunération PAR VIDÉO — GLOBAL tous projets. RÉPLIQUE de
 * lib/pricing-engine.MAX_PAY_PER_VIDEO_EUR (A6 — convex/ ne peut pas importer
 * lib/). DOIT rester identique. Cf computeMonthlyPayout (ici) + computeEarnings
 * (convex/payments) qui l'importe.
 */
export const MAX_PAY_PER_VIDEO_EUR = 150;

export type PricingSnapshot = {
  pricingId: Id<"pricings">;
  montantFixe: number;
  nbVideosCible: number;
  tauxCPM: number;
  // legacy v1 (ignorés par le moteur v2 ; conservés sur les snapshots existants).
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
  /** Un assignment RÉEL de ce groupe (représentant de la ligne « Fixe » gelée). */
  firstAssignmentId: string;
  videoCount: number;
  nbVideosCible: number;
  montantFixe: number;
  fixePerVideo: number;
  fixed: number;
  cpm: number;
};

export interface MonthlyPayout {
  fixedTotal: number;
  cpmTotal: number;
  total: number;
  perPricing: PerPricing[];
  perAssignment: {
    assignmentId: string;
    pricingId: string;
    /** Assiette AVANT plafond (vues payables retenues). */
    totalViews: number;
    cpm: number;
    /** Vues réellement FACTURÉES — cf lib/pricing-engine.PerAssignment. */
    billedViews: number;
  }[];
}

export function assignmentCpm(snapshot: PricingSnapshot, totalViews: number): number {
  const v = Math.max(0, totalViews);
  return round2((v / 1000) * snapshot.tauxCPM);
}

function fixePerVideo(snapshot: PricingSnapshot): number {
  if (!(snapshot.nbVideosCible > 0)) return 0;
  return snapshot.montantFixe / snapshot.nbVideosCible;
}

// ─── Warmup — RÉPLIQUE de lib/pricing-engine.payableAssignmentViews (A6) ──────

type PublicationViews = RemunerationFlags & { views: number };

/**
 * Vues PAYABLES d'une vidéo = Σ des vues des posts RÉMUNÉRÉS (isRemunerated) —
 * exclus du CPM ET du cumul de paliers sinon. `hasPayablePost` pilote le FIXE
 * (false = aucune vidéo rémunérée → exclue du fixe). RÉPLIQUE EXACTE de
 * lib/pricing-engine.payableAssignmentViews (testée Vitest là-bas). Tant que
 * `remunere` est absent : isRemunerated = !isWarmup → INCHANGÉ.
 */
function payableAssignmentViews(pubs: PublicationViews[]): {
  payableViews: number;
  hasPayablePost: boolean;
} {
  let payableViews = 0;
  let remuneratedCount = 0;
  for (const p of pubs) {
    if (!isRemunerated(p)) continue;
    remuneratedCount += 1;
    payableViews += Math.max(0, p.views);
  }
  return {
    payableViews,
    hasPayablePost: pubs.length === 0 || remuneratedCount > 0,
  };
}

/**
 * Part de la paie d'UNE vidéo engagée pour ses posts PROMO : fixe entier (il est
 * par VIDÉO) + la seule part du CPM gagnée sur des vues promo. Le CPM est payé sur
 * les vues PAYABLES, qui incluent un post warmup RÉMUNÉRÉ (exception historique) :
 * sans ce prorata, une vidéo mixte ferait entrer sa paie de warmup dans un coût
 * ensuite divisé par les seules vues promo. RÉPLIQUE EXACTE de
 * lib/pricing-engine.promoVideoCost (testée Vitest là-bas).
 */
export function promoVideoCost(
  fixed: number,
  cpm: number,
  payableViews: number,
  promoPaidViews: number,
): number {
  const payable = Math.max(0, payableViews);
  const promo = Math.min(Math.max(0, promoPaidViews), payable);
  const share = payable > 0 ? promo / payable : 0;
  return round2(Math.max(0, fixed) + Math.max(0, cpm) * share);
}

/**
 * Clé de GROUPE — RÉPLIQUE de lib/pricing-engine.payoutGroupKey. Le pricingId NE
 * SUFFIT PAS : un pricing édité EN PLACE laisse deux générations de snapshot sous
 * le MÊME id, et lire les termes de groupe sur `groupItems[0]` rendait la part
 * fixe dépendante de l'ORDRE DES DOCUMENTS (constaté en prod : 69,50 $ ou
 * 37,83 $ pour le même cycle). La clé inclut donc tous les termes lus au niveau
 * du groupe. Cf lib/pricing-engine.ts pour le raisonnement complet.
 */
function payoutGroupKey(s: PricingSnapshot): string {
  return [s.pricingId, s.montantFixe, s.nbVideosCible, s.tauxCPM].join("|");
}

/** RÉPLIQUE de lib/pricing-engine.computeMonthlyPayout (DOIT rester identique). */
export function computeMonthlyPayout(items: PayoutItem[]): MonthlyPayout {
  const groups = new Map<string, PayoutItem[]>();
  for (const it of items) {
    const key = payoutGroupKey(it.snapshot);
    const arr = groups.get(key);
    if (arr) arr.push(it);
    else groups.set(key, [it]);
  }
  const perPricing: MonthlyPayout["perPricing"] = [];
  const perAssignment: MonthlyPayout["perAssignment"] = [];
  let fixedTotal = 0;
  let cpmTotal = 0;
  for (const groupItems of groups.values()) {
    // Seul le BUDGET fixe reste lu au niveau du groupe, et il est identique pour
    // tous ses membres par construction (cf payoutGroupKey) → indépendant de
    // l'ordre. Le reste se lit par ITEM, sur SON snapshot, comme le CPM.
    const groupSnapshot = groupItems[0].snapshot;
    const budgetFixe = groupSnapshot.montantFixe;
    const videoCount = groupItems.length;
    // Plafond 150 $/vidéo (RÉPLIQUE lib/pricing-engine) : dépassement rogné sur le
    // CPM d'abord, puis la part fixe (pathologique). Sans dépassement = inchangé.
    let remainingFixe = budgetFixe;
    let fixedRaw = 0;
    let groupCpm = 0;
    let fixedOverflow = 0;
    for (const it of groupItems) {
      const perVideo = fixePerVideo(it.snapshot);
      const fixedShare = Math.min(perVideo, Math.max(0, remainingFixe));
      remainingFixe -= fixedShare;
      fixedRaw += fixedShare;
      const cpm = assignmentCpm(it.snapshot, it.totalViews);
      const excess = Math.max(0, fixedShare + cpm - MAX_PAY_PER_VIDEO_EUR);
      const cpmOverflow = Math.min(cpm, excess);
      fixedOverflow += excess - cpmOverflow;
      const cappedCpm = round2(cpm - cpmOverflow);
      groupCpm = round2(groupCpm + cappedCpm);
      const views = Math.max(0, it.totalViews);
      // CPM : vues en deçà du seuil de plafond. FIXE SEUL : achat forfaitaire, donc
      // toutes les vues (sauf budget fixe épuisé → aucune). Cf lib/pricing-engine.
      const billableViews =
        it.snapshot.tauxCPM > 0
          ? Math.max(0, (MAX_PAY_PER_VIDEO_EUR - fixedShare) / it.snapshot.tauxCPM) * 1000
          : fixedShare > 0
            ? views
            : 0;
      perAssignment.push({
        assignmentId: it.assignmentId,
        pricingId: it.snapshot.pricingId,
        totalViews: views,
        cpm: cappedCpm,
        billedViews: Math.round(Math.min(views, billableViews)),
      });
    }
    const fixed = round2(round2(fixedRaw) - fixedOverflow);
    perPricing.push({
      pricingId: groupSnapshot.pricingId,
      // Un membre RÉEL de CE groupe : depuis que deux générations de snapshot
      // peuvent partager un pricingId, chercher un représentant par pricingId
      // seul renverrait le même assignment pour les deux groupes (ligne « Fixe »
      // gelée attribuée à la mauvaise vidéo).
      firstAssignmentId: groupItems[0].assignmentId,
      videoCount,
      nbVideosCible: groupSnapshot.nbVideosCible,
      montantFixe: budgetFixe,
      fixePerVideo: round2(fixePerVideo(groupSnapshot)),
      fixed,
      cpm: groupCpm,
    });
    fixedTotal = round2(fixedTotal + fixed);
    cpmTotal = round2(cpmTotal + groupCpm);
  }
  return {
    fixedTotal,
    cpmTotal,
    total: round2(fixedTotal + cpmTotal),
    perPricing,
    perAssignment,
  };
}

// ─── Paliers de bonus (RÉPLIQUE de lib/pricing-engine — DOIT rester identique) ─

export type BonusTier = {
  seuilVues: number;
  rewardType: "cash" | "nature";
  montant?: number;
  libelle?: string;
  /**
   * NATURE uniquement — ce que l'objet nous COÛTE réellement, jamais son prix
   * public. RÉPLIQUE de lib/pricing-engine.BonusTier (A6). Absent ⇒ tiret.
   */
  coutReel?: number;
};

export function tiersOf(pricing: {
  bonusTiers?: BonusTier[];
  seuilBonusVues?: number;
  montantBonus?: number;
}): BonusTier[] {
  if (pricing.bonusTiers && pricing.bonusTiers.length > 0) {
    return pricing.bonusTiers;
  }
  if ((pricing.seuilBonusVues ?? 0) > 0 && (pricing.montantBonus ?? 0) > 0) {
    return [
      {
        seuilVues: pricing.seuilBonusVues!,
        rewardType: "cash",
        montant: pricing.montantBonus!,
      },
    ];
  }
  return [];
}

export interface BonusTierEvaluation {
  crossed: BonusTier[];
  cashCrossedTotal: number;
  natureCrossed: BonusTier[];
  nextTier: BonusTier | null;
  viewsToNext: number | null;
}

export function evaluateBonusTiers(
  cumulViews: number,
  tiers: BonusTier[],
): BonusTierEvaluation {
  const cumul = Math.max(0, cumulViews);
  const sorted = [...tiers].sort((a, b) => a.seuilVues - b.seuilVues);
  const crossed = sorted.filter((t) => cumul >= t.seuilVues);
  const cashCrossedTotal = round2(
    crossed
      .filter((t) => t.rewardType === "cash")
      .reduce((s, t) => s + (t.montant ?? 0), 0),
  );
  const natureCrossed = crossed.filter((t) => t.rewardType === "nature");
  const nextTier = sorted.find((t) => cumul < t.seuilVues) ?? null;
  return {
    crossed,
    cashCrossedTotal,
    natureCrossed,
    nextTier,
    viewsToNext: nextTier ? Math.max(0, nextTier.seuilVues - cumul) : null,
  };
}

// ─── Vues + période d'un assignment ──────────────────────────────────────────

/** Date de publication d'un assignment = la PLUS PRÉCOCE de ses cibles (toutes
 *  publiées le même jour par confirmPublication), fallback legacy/createdAt.
 *  Exporté : réutilisé par le suivi vidéos créatrice (convex/creatorVideos). */
export function assignmentPublishedAt(a: Doc<"assignments">): number {
  const ts = (a.targets ?? [])
    .map((t) => t.publishedAt)
    .filter((x): x is number => typeof x === "number");
  if (ts.length > 0) return Math.min(...ts);
  return a.publishedAt ?? a.createdAt;
}

/**
 * Vues d'un assignment ET présence de métriques (au moins un snapshot déjà
 * relevé, via latestSnapshotAt), en UN SEUL passage sur les publications. SOURCE
 * UNIQUE des vues d'une vidéo, réutilisée par le CPM/cumul (paie) ET par le suivi
 * vidéos créatrice → aucune divergence de vues.
 *
 *  - `totalViews` : Σ de TOUTES les vues MESURÉES (warmup INCLUS) →
 *    AFFICHAGE/suivi (un post warmup reste tracké normalement, ses vues restent
 *    visibles). JAMAIS plafonné : on garde la mesure.
 *  - `payableViews` : Σ des vues RETENUES des posts RÉMUNÉRÉS (isRemunerated) →
 *    fixe + CPM. PLAFONNÉ à J+30 (cf convex/payWindow).
 *  - `bonusTierViews` : Σ des vues RETENUES des posts RÉMUNÉRÉS **et** en PROMO
 *    (isBonusTierPost) → cumul des PALIERS de bonus, et RIEN d'autre.
 *    Sous-ensemble de payableViews : un post warmup rémunéré (cas Kelly) est payé
 *    au fixe/CPM mais ne fait pas avancer les paliers. Cf convex/viewCounters
 *    (point de décision unique). PLAFONNÉ, comme toute assiette d'argent.
 *  - `promoViews` : Σ des vues MESURÉES des posts en promo → taux de conversion.
 *    JAMAIS plafonné : un taux de conversion mesure la réalité, pas la paie.
 *  - `hasPayablePost` : la vidéo compte-t-elle pour le FIXE (false = tout-warmup).
 *    INDÉPENDANT des vues → une vidéo plafonnée garde sa part fixe, elle ne
 *    devient JAMAIS une vidéo à zéro.
 *  - `hasMetrics` : suivi actif vs en cours de calcul (côté créatrice).
 *  - `payWindowClosed` / `viewsOutsideWindow` : de quoi DIRE le plafond à
 *    l'écran (cf convex/creatorVideos → portail « Mes vidéos »). Une baisse
 *    silencieuse serait illisible.
 *
 * ⚠️ UNE LECTURE D'INDEX EN PLUS PAR POST (`by_publication_and_capturedAt`,
 * bornée, `.first()`) : le relevé de fenêtre n'est PAS dénormalisé sur la
 * publication. C'est délibéré — une valeur dénormalisée de plus à maintenir
 * (comme `vuesLatest`) dériverait au premier re-run de sync, et le plafond doit
 * être RÉTROACTIF sur tout l'historique sans migration.
 *
 * Sans aucun post warmup et fenêtres ouvertes, payableViews === bonusTierViews
 * === totalViews et hasPayablePost === true → la paie est INCHANGÉE. Cf
 * lib/pricing-engine.payableAssignmentViews (A6).
 */
/**
 * Cache des vues d'un assignment, PARTAGÉ à l'échelle d'UNE query.
 *
 * `assignmentViewsAndMetrics` fait DEUX opérations Convex par publication (un
 * `db.get` + une requête indexée sur `metricSnapshots`), et les mêmes vidéos sont
 * traversées plusieurs fois dans la même query : une fois pour la ligne affichée,
 * une fois dans le breakdown de paie de sa (créatrice, mois). Sur la prod du
 * 2026-09-06, `getAttribution` et `getReliability` ont commencé à ÉCHOUER —
 * « Your request timed out performing too many system operations » — parce que ce
 * coût croît linéairement avec le nombre de publications (~20 de plus par jour).
 *
 * Le cache ne change AUCUN résultat : la clé est l'assignment, et `now` n'entre
 * dans aucun montant (cf. la signature). Il est volontairement passé de l'appelant
 * plutôt que global : une query le crée, l'utilise, le jette — jamais d'état qui
 * survit à une transaction.
 */
/** Vues et métriques d'UN assignment — cf assignmentViewsAndMetrics. */
export interface AssignmentViews {
  totalViews: number;
  payableViews: number;
  /** Vues RÉMUNÉRÉES et en PROMO — SEULE base du cumul de paliers. */
  bonusTierViews: number;
  /** Vues des posts en phase PROMO (non-warmup) — base des taux de conversion. */
  promoViews: number;
  hasPayablePost: boolean;
  /** Au moins un post en phase promo (détection des jours solo, même à 0 vue). */
  hasPromoPost: boolean;
  hasMetrics: boolean;
  /**
   * Posts RÉMUNÉRÉS dont AUCUNE vue n'a pu être mesurée.
   *
   * SIGNALÉ, JAMAIS BLOQUANT — arbitrage produit : une vidéo non mesurée ne
   * retient pas le cycle de paie, elle se signale pour que qui valide le sache.
   * Ce compteur ne modifie donc aucun montant ; il rend visible ce qui est payé
   * sur une ignorance plutôt que sur une mesure.
   */
  unmeasuredPayablePosts: number;
  /** Au moins un post RÉMUNÉRÉ dont la fenêtre de paie est close (et mesurée). */
  payWindowClosed: boolean;
  /** Σ des vues RÉMUNÉRÉES acquises hors fenêtre (mesurées − retenues). */
  viewsOutsideWindow: number;
}

/**
 * Mémoire de calcul d'UNE query de paie.
 *
 * `views` évite de recalculer deux fois la même assignation (une créatrice a
 * plusieurs cycles, chacun rejouait ses vidéos).
 *
 * `pubs` répond à un coût distinct, et plus lourd : `assignmentViewsAndMetrics`
 * faisait un `db.get` PAR PUBLICATION. Sur un projet à ~450 publications
 * publiées, c'est ~450 lectures unitaires là où l'index `by_project` en ramène
 * l'intégralité en UNE. Le budget qui saute n'est pas celui des octets (0,8 Mo
 * en prod) mais celui du NOMBRE d'opérations — c'est lui que Convex refuse
 * (« too many system operations »). Absent = on relit une par une, comme avant.
 */
export type AssignmentViewsCache = {
  views: Map<string, AssignmentViews>;
  pubs?: Map<string, Doc<"publications">>;
};

/** Cache vide, éventuellement pré-chargé des publications du projet. */
export function newViewsCache(
  pubs?: Map<string, Doc<"publications">>,
): AssignmentViewsCache {
  return { views: new Map(), pubs };
}

/**
 * Toutes les publications d'un projet, indexées par id, en UNE lecture.
 *
 * À réserver aux appelants qui parcourent tout le projet (paie, analytics) :
 * pour une seule assignation, un `db.get` reste moins cher.
 */
export async function loadProjectPublications(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
): Promise<Map<string, Doc<"publications">>> {
  const rows = await ctx.db
    .query("publications")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return new Map(rows.map((p) => [p._id as string, p]));
}

export async function assignmentViewsAndMetrics(
  ctx: QueryCtx | MutationCtx,
  a: Doc<"assignments">,
  /** Instant de référence — ne change AUCUN montant, seulement l'état affiché. */
  now: number = Date.now(),
  /** Cache d'UNE query (cf AssignmentViewsCache). Absent = comportement d'avant. */
  cache?: AssignmentViewsCache,
): Promise<AssignmentViews> {
  const cached = cache?.views.get(a._id as string);
  if (cached) return cached;
  const pubIds = [
    ...(a.targets ?? []).map((t) => t.publicationId),
    a.publicationId,
  ].filter((p): p is Id<"publications"> => p !== undefined);
  /** Vues MESURÉES (suivi) et RETENUES (paie) — jamais confondues. */
  const pubs: (RemunerationFlags & { measured: number; retained: number })[] = [];
  /** Un item par post, pour l'AFFICHAGE du plafond (cf aggregatePayWindow). */
  const windows: { retained: RetainedViews; isPaid: boolean }[] = [];
  let hasMetrics = false;
  let unmeasuredPayable = 0;
  const seen = new Set<string>();
  for (const pid of pubIds) {
    if (seen.has(pid)) continue;
    seen.add(pid);
    // Publication préchargée si l'appelant a fourni la table du projet ; sinon
    // lecture unitaire, exactement comme avant.
    const pub = cache?.pubs?.get(pid as string) ?? (await ctx.db.get(pid));
    if (!pub) continue;
    const measured = pub.vuesLatest ?? 0;
    // DERNIER relevé de la fenêtre de paie. La borne est un instant, donc elle
    // se lit directement dans l'index sur capturedAt — inutile de charger la
    // série pour filtrer sur daysSincePublication (cf payWindowEndsAt).
    //
    // ⚠️ INTERROGÉ SEULEMENT SI LA FENÊTRE EST CLOSE. `retainedViews` rend la
    // main AVANT de regarder ce relevé quand la fenêtre est encore ouverte :
    // l'assiette vaut alors les vues mesurées, quel que soit le relevé. On
    // payait donc une lecture indexée PAR PUBLICATION pour un résultat jeté —
    // et sur Snytch au 08/09/2026, 384 publications sur 449 (86 %) sont dans ce
    // cas. Le `now` est le MÊME que celui passé à `retainedViews` juste après :
    // les deux doivent lire la même fenêtre, sinon on se met à sauter des
    // lectures dont le calcul, lui, aurait besoin.
    const windowSnapshot = payWindowIsClosed(pub.datePubli, now)
      ? await ctx.db
          .query("metricSnapshots")
          .withIndex("by_publication_and_capturedAt", (q) =>
            q
              .eq("publicationId", pid)
              .lt("capturedAt", payWindowEndsAt(pub.datePubli)),
          )
          .order("desc")
          .first()
      : null;
    const retained = retainedViews({
      datePubli: pub.datePubli,
      measuredViews: measured,
      windowSnapshot,
      now,
    });
    const flags = {
      isWarmup: pub.isWarmup === true,
      remunere: pub.remunere,
    };
    // Non mesuré ET rémunéré = payé sur une ignorance. On le compte pour le
    // dire ; le montant, lui, ne bouge pas (cf `unmeasuredPayablePosts`).
    if (isRemunerated(flags) && collectAvailability(pub) !== "measured") {
      unmeasuredPayable += 1;
    }
    pubs.push({ ...flags, measured, retained: retained.views });
    windows.push({ retained, isPaid: isRemunerated(flags) });
    // Un snapshot a été relevé (Apify/YouTube/manuel) ⇒ suivi actif.
    if (pub.latestSnapshotAt !== undefined) hasMetrics = true;
  }
  // AFFICHAGE : vues MESURÉES, jamais plafonnées (le suivi continue).
  const totalViews = pubs.reduce((s, p) => s + p.measured, 0);
  // promo = non-warmup (isPromoPost, point unique) — DISTINCT de payable : un post
  // warmup rémunéré (cas Kelly) est payable mais HORS promo. MESURÉES aussi : un
  // taux de conversion se calcule sur les vues réelles, pas sur l'assiette.
  const promoViews = pubs.reduce(
    (s, p) => s + (isPromoPost(p) ? Math.max(0, p.measured) : 0),
    0,
  );
  const hasPromoPost = pubs.some((p) => isPromoPost(p));
  // Paliers : rémunéré ET promo (isBonusTierPost, point de décision unique).
  // ARGENT ⇒ vues RETENUES.
  const bonusTierViews = pubs.reduce(
    (s, p) => s + (isBonusTierPost(p) ? Math.max(0, p.retained) : 0),
    0,
  );
  const { payableViews, hasPayablePost } = payableAssignmentViews(
    pubs.map((p) => ({ ...p, views: p.retained })),
  );
  const payWindow = aggregatePayWindow(windows);
  const out = {
    totalViews,
    payableViews,
    bonusTierViews,
    promoViews,
    hasPayablePost,
    hasPromoPost,
    hasMetrics,
    unmeasuredPayablePosts: unmeasuredPayable,
    payWindowClosed: payWindow.closed,
    viewsOutsideWindow: payWindow.viewsOutsideWindow,
  };
  cache?.views.set(a._id as string, out);
  return out;
}

/** "YYYY-MM" → mois suivant ("YYYY-MM"), UTC (rollover Guard A). */
function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1)); // m (1-based) → mois suivant (0-based+1)
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}`;
}

/**
 * CUMUL TOTAL À VIE des vues du créateur sur le projet (Guard D) : somme des
 * `bonusTierViews` (RÉMUNÉRÉES **et** en promo) de TOUTES ses vidéos
 * publiées/payées à pricingSnapshot, SANS filtre de période (≠ du fixe/CPM qui
 * sont mensuels).
 *
 * ⚠️ BASE DISTINCTE DU CPM depuis le chantier « bonus sur vues rémunérées ». Un
 * post warmup RÉMUNÉRÉ (cas Kelly) est payé au fixe/CPM mais ne fait PAS avancer
 * les paliers → `cumul ≤ Σ payableViews`. C'est voulu : un bonus de vues ne se
 * gagne que sur des vues de promo. SEUL point d'entrée du cumul de paliers,
 * partagé par la PAIE (syncBonusUnlocks), la JAUGE (bonusStatusFor) et la
 * PROGRESSION → jamais un palier affiché mais non payé, ni l'inverse.
 */
export async function creatorCumulViews(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  /**
   * Cache de vues d'UNE query (cf AssignmentViewsCache). Un appelant qui boucle
   * sur TOUTES les créatrices — `getNatureRewards` — relisait sinon, pour chaque
   * assignation, ses publications ET son dernier relevé de fenêtre. C'est cette
   * query qui a fini par ÉCHOUER en prod le 2026-09-08 (« too many system
   * operations »). Absent = comportement d'avant, à l'identique.
   */
  viewsCache?: AssignmentViewsCache,
): Promise<number> {
  const assignments = (
    await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter(
    (a) =>
      a.projectId === projectId &&
      a.pricingSnapshot !== undefined &&
      (a.status === "published" || a.status === "paid"),
  );
  let cumul = 0;
  for (const a of assignments) {
    cumul += (
      await assignmentViewsAndMetrics(ctx, a, Date.now(), viewsCache)
    ).bonusTierViews;
  }
  return cumul;
}

/**
 * Grille de bonus EFFECTIVE d'un créateur : sa grille PERSO (bonusPricingId) si
 * posée, SINON la grille par DÉFAUT du projet (projects.defaultBonusPricingId).
 * Source UNIQUE partagée par l'AFFICHAGE (progression, bonusStatusFor) ET la PAIE
 * (syncBonusUnlocks) → échelle et déblocages TOUJOURS cohérents (jamais de palier
 * affiché mais non payé). La grille perso PRIME sur le défaut. null = aucune
 * grille (ni perso ni défaut). `pricingId` = grille réellement utilisée (clé des
 * unlocks). Lecture LIVE du doc pricing (aucun snapshot).
 */
export async function effectiveBonusPricing(
  ctx: QueryCtx | MutationCtx,
  creator: Doc<"creators">,
): Promise<{ pricingId: Id<"pricings">; tiers: BonusTier[] } | null> {
  let pricingId = creator.bonusPricingId;
  if (!pricingId) {
    const project = await ctx.db.get(creator.projectId);
    pricingId = project?.defaultBonusPricingId;
  }
  if (!pricingId) return null;
  const pricing = await ctx.db.get(pricingId);
  if (!pricing || pricing.projectId !== creator.projectId) return null;
  return { pricingId, tiers: tiersOf(pricing) };
}

/** Grille de paliers du créateur (perso, sinon défaut projet) — [] si aucune. */
export async function creatorBonusTiers(
  ctx: QueryCtx | MutationCtx,
  creator: Doc<"creators">,
): Promise<BonusTier[]> {
  const eff = await effectiveBonusPricing(ctx, creator);
  return eff?.tiers ?? [];
}

/** Une récompense en NATURE déjà DUE (palier franchi), avec son coût réel figé. */
export interface NatureDueEntry {
  creatorId: Id<"creators">;
  seuilVues: number;
  libelle: string | null;
  /** Coût réel FIGÉ au déblocage. null = jamais renseigné → hors du total. */
  coutReel: number | null;
  unlockedAt: number;
}

/**
 * Récompenses en NATURE déjà DUES d'un projet (un palier nature franchi = un
 * objet qu'on doit livrer). SOURCE UNIQUE partagée par le coût complet du moteur
 * (getAttribution) et la carte de détail (getNatureRewards) → les deux ne peuvent
 * pas diverger.
 *
 * Une récompense sans `coutReel` renseigné est renvoyée avec `null` : elle est
 * DUE mais non chiffrable. L'appelant l'exclut du total ET le signale — un coût
 * manquant qui disparaîtrait en silence ferait lire le total comme complet.
 */
/**
 * Récompenses en NATURE dues au titre d'une VICTOIRE DE DÉFI.
 *
 * Même contrat que `natureRewardsDue` (paliers) : une prime en nature ne crédite
 * AUCUN euro à la créatrice — elle ne passe pas par `totalDue` — mais elle nous
 * COÛTE, et ce coût doit entrer dans le coût complet du moteur. Sans ça, un défi
 * récompensé par un iPhone serait une dépense réelle invisible du calcul de
 * marge.
 *
 * Une victoire ANNULÉE ne coûte plus rien : l'objet n'est pas dû. Une prime sans
 * `coutReel` renseigné est rendue avec `null` — DUE mais non chiffrable ;
 * l'appelant l'exclut du total ET le signale, exactement comme pour les paliers.
 * Un 0 se lirait « gratuit ».
 */
export async function challengeNatureRewardsDue(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
): Promise<NatureDueEntry[]> {
  const wins = await ctx.db
    .query("challengeWins")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return wins
    .filter((w) => w.reward.type === "nature" && w.cancelledAt === undefined)
    .map((w) => ({
      creatorId: w.creatorId,
      // `seuilVues` n'a pas de sens pour un défi : on porte le score AU MOMENT
      // de la victoire, qui joue le même rôle (« gagné à tant de vues »).
      seuilVues: w.scoreAtWin,
      libelle: w.reward.libelle ?? null,
      coutReel:
        typeof w.reward.coutReel === "number" ? w.reward.coutReel : null,
      unlockedAt: w.wonAt,
    }));
}

export async function natureRewardsDue(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
): Promise<NatureDueEntry[]> {
  const unlocks = await ctx.db
    .query("bonusUnlocks")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return unlocks
    .filter((u) => u.rewardType === "nature")
    .map((u) => ({
      creatorId: u.creatorId,
      seuilVues: u.seuilVues,
      libelle: u.libelle ?? null,
      coutReel: typeof u.coutReel === "number" ? u.coutReel : null,
      unlockedAt: u.unlockedAt,
    }));
}

/**
 * Le $ de cet unlock est-il DÉJÀ GELÉ dans un paiement payé ? Le gel écrit une
 * lineItem `bonus_tier` AGRÉGÉE (aucun détail par palier récupérable), donc on
 * raisonne par FENÊTRE, et sur les DEUX modes de paie possibles :
 *  - mensuel : `attributionPeriod` correspond à une row payée ;
 *  - cycles J+30 : le cycle de `unlockedAt` correspond à une row payée
 *    (computeCyclePricingBreakdown fenêtre les unlocks par unlockedAt).
 * Vrai ⇒ intouchable : l'argent est parti, on ne le reprend pas en base.
 */
async function unlockIsFrozen(
  ctx: MutationCtx,
  u: Doc<"bonusUnlocks">,
  creator: Doc<"creators">,
): Promise<boolean> {
  const paid = (
    await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", u.creatorId))
      .collect()
  ).filter((p) => p.projectId === u.projectId && p.status === "paid");
  if (paid.length === 0) return false;
  if (paid.some((p) => p.period === u.attributionPeriod)) return true;
  if (creator.firstPostAt !== undefined) {
    const k = cycleIndexOf(creator.firstPostAt, u.unlockedAt);
    const key = cyclePeriodKey(cycleWindow(creator.firstPostAt, k).cycleStart);
    if (paid.some((p) => p.period === key)) return true;
  }
  return false;
}

/**
 * SYNC IDEMPOTENTE des paliers débloqués d'un créateur, dans LES DEUX SENS.
 *
 * MONTÉE — pour chaque palier franchi SANS row d'unlock existante (clé
 * (creatorId, pricingId, seuilVues)), INSÈRE un unlock : récompense FIGÉE +
 * `attributionPeriod` (Guard A : période courante ; rollover si déjà payée →
 * période ouverte courante, jamais perdu).
 *
 * DESCENTE — RÉVOQUE les unlocks de la grille EFFECTIVE dont le seuil n'est plus
 * atteint par le cumul. Guard E (immuabilité) est ainsi LEVÉ : il rendait le
 * changement « bonus sur vues rémunérées » inopérant, puisqu'un post basculé en
 * warmup après coup faisait tomber le cumul sans jamais reprendre le palier.
 * Deux garde-fous :
 *  - un unlock déjà GELÉ dans un paiement payé n'est JAMAIS révoqué
 *    (`unlockIsFrozen`) — on ne reprend pas de l'argent déjà versé ;
 *  - seuls les unlocks de la grille COURANTE (`pricingId`) sont candidats : un
 *    unlock gagné sous une grille précédente reste acquis.
 * Conséquence assumée : un palier révoqué puis re-franchi est ré-inséré avec un
 * `unlockedAt` neuf (nouvelle `attributionPeriod`, célébration rejouée).
 */
export async function syncBonusUnlocks(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
): Promise<{ unlocked: number; revoked: number }> {
  const creator = await ctx.db.get(creatorId);
  if (!creator || creator.projectId !== projectId) {
    return { unlocked: 0, revoked: 0 };
  }
  // Grille EFFECTIVE (perso ou défaut projet) → mêmes paliers que l'affichage,
  // et `pricingId` de la grille réellement utilisée (clé d'idempotence).
  const eff = await effectiveBonusPricing(ctx, creator);
  if (!eff || eff.tiers.length === 0) return { unlocked: 0, revoked: 0 };
  const { pricingId, tiers } = eff;
  const cumul = await creatorCumulViews(ctx, projectId, creatorId);
  const now = Date.now();
  let unlocked = 0;
  let revoked = 0;

  // DESCENTE d'abord : un palier qui n'est plus tenu sort avant qu'on réévalue
  // les montées (une même passe ne doit jamais insérer ET révoquer le même seuil).
  const existingUnlocks = (
    await ctx.db
      .query("bonusUnlocks")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter((u) => u.projectId === projectId && u.pricingId === pricingId);
  for (const u of existingUnlocks) {
    if (cumul >= u.seuilVues) continue;
    if (await unlockIsFrozen(ctx, u, creator)) continue;
    await ctx.db.delete(u._id);
    revoked += 1;
  }

  for (const tier of tiers) {
    if (cumul < tier.seuilVues) continue;
    const existing = await ctx.db
      .query("bonusUnlocks")
      .withIndex("by_creator_pricing_seuil", (q) =>
        q
          .eq("creatorId", creatorId)
          .eq("pricingId", pricingId)
          .eq("seuilVues", tier.seuilVues),
      )
      .first();
    if (existing) continue; // Déjà débloqué sous cette grille — pas de doublon.
    // Guard A — attribution : période du déblocage ; si DÉJÀ payée pour ce
    // créateur, on roule au mois suivant (période ouverte) → cash jamais perdu.
    let attributionPeriod = periodOf(now);
    const paidNow = (
      await ctx.db
        .query("payments")
        .withIndex("by_project_period", (q) =>
          q.eq("projectId", projectId).eq("period", attributionPeriod),
        )
        .collect()
    ).find((p) => p.creatorId === creatorId && p.status === "paid");
    if (paidNow) attributionPeriod = nextPeriod(attributionPeriod);
    await ctx.db.insert("bonusUnlocks", {
      projectId,
      creatorId,
      pricingId,
      seuilVues: tier.seuilVues,
      rewardType: tier.rewardType,
      montant: tier.montant,
      libelle: tier.libelle,
      // Figé comme le reste : le coût de CET objet-là, au moment où il devient dû.
      coutReel: tier.coutReel,
      unlockedAt: now,
      cumulAtUnlock: cumul,
      attributionPeriod,
    });
    unlocked += 1;
  }
  return { unlocked, revoked };
}

/**
 * Sync des paliers du créateur PROPRIÉTAIRE d'une publication (après mise à jour
 * de ses vues). Résout l'assignment (scan by_project → target.publicationId) →
 * creatorId → syncBonusUnlocks. No-op si non trouvé. Appelé depuis les écritures
 * de snapshots (manuel + cron).
 */
export async function syncBonusForPublication(
  ctx: MutationCtx,
  publicationId: Id<"publications">,
): Promise<void> {
  const pub = await ctx.db.get(publicationId);
  if (!pub) return;
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_project", (q) => q.eq("projectId", pub.projectId))
    .collect();
  const a = assignments.find(
    (x) =>
      (x.targets ?? []).some((t) => t.publicationId === publicationId) ||
      x.publicationId === publicationId,
  );
  if (!a) return;
  await syncBonusUnlocks(ctx, pub.projectId, a.creatorId);
}

export interface PricingBreakdown extends MonthlyPayout {
  /** Bonus cash des paliers débloqués ATTRIBUÉS à cette période (persistés). */
  bonusTierCashTotal: number;
  /** DÉTAIL par palier des unlocks cash de la période (AFFICHAGE seulement — la
   *  somme = bonusTierCashTotal, `total` inchangé). Vide sur un breakdown gelé
   *  (lineItems agrégées) → la vue retombe sur la ligne agrégée. */
  bonusTierCashUnlocks: { seuilVues: number; montant: number }[];
  /** Primes CASH des victoires de défi attribuées à cette période (persistées). */
  challengeTotal: number;
  /**
   * DÉTAIL par victoire — UNE ENTRÉE PAR PRIME, jamais agrégée.
   *
   * C'est la différence délibérée avec `bonusTierCashUnlocks`, dont la ligne
   * gelée est agrégée et dont le commentaire d'origine reconnaît qu'« aucun
   * détail par palier n'est récupérable » : `unlockIsFrozen` doit alors
   * raisonner par FENÊTRE pour deviner si un palier est déjà payé. Ici chaque
   * prime porte son défi et son id de victoire, donc l'annulation reste
   * vérifiable ligne à ligne.
   */
  challengeWins: {
    winId: string;
    challengeName: string;
    montant: number;
  }[];
  /**
   * Vidéos RÉMUNÉRÉES de la période dont aucune vue n'a pu être mesurée.
   *
   * SIGNALÉ, JAMAIS BLOQUANT (arbitrage produit) : le cycle se paie
   * normalement, `total` est intouché. Ce compteur sert uniquement à ce que
   * l'écran de paiement puisse dire « N vidéo(s) payée(s) sans mesure » avant
   * qu'on valide, au lieu de laisser croire qu'elles ont fait zéro vue.
   *
   * Vaut 0 sur un breakdown GELÉ (lineItems agrégées d'un cycle déjà payé) :
   * l'information n'y est pas récupérable, et un cycle payé ne se rediscute pas.
   */
  unmeasuredPayablePosts: number;
}

/**
 * Primes CASH des victoires de défi d'un créateur, fenêtrées par un prédicat
 * fourni (mois calendaire OU cycle J+30 — les deux modes de paie coexistent).
 *
 * ── Guard B, repris tel quel de `bonusUnlocks` ──────────────────────────────
 * Le cash d'une période vient UNIQUEMENT des victoires PERSISTÉES : on ne
 * réévalue JAMAIS un score au moment de payer. Le score a pu bouger depuis (une
 * vidéo retirée du défi, une autre créatrice passée devant) ; la prime, elle,
 * est due sur ce qui a été acté. C'est la même raison qui a fait écarter la
 * ré-évaluation live des paliers.
 *
 * ── Les victoires ANNULÉES sortent, sans disparaître ────────────────────────
 * `cancelledAt` défini ⇒ la prime n'est plus due, donc plus sommée ici. La row
 * reste en base avec son motif : le grand livre garde la trace de ce qui a été
 * annulé et pourquoi. Une suppression aurait effacé la question.
 */
/**
 * Les lectures PAR CRÉATRICE que TOUS ses cycles partagent.
 *
 * POURQUOI CE TYPE EXISTE. `computeCyclePricingBreakdown` est appelée une fois
 * PAR CYCLE, et elle re-collectait à chaque appel les MÊMES trois ensembles :
 * toutes les assignations de la créatrice, tous ses paliers débloqués, toutes
 * ses victoires de défi — puis un `db.get` par victoire pour le nom du défi.
 * Rien de tout cela ne dépend du cycle : le fenêtrage se fait ENSUITE, en
 * mémoire. Une créatrice à cinq cycles payait donc cinq fois la même lecture,
 * et un appelant qui boucle sur toutes les créatrices multipliait encore.
 *
 * Coût mesuré en prod le 2026-09-08 : `analyticsHub:getReliability` lisait
 * 4 371 documents en 16,5 s et ÉCHOUAIT (« Your request timed out performing
 * too many system operations ») ; `payments:getDueTotal` 2 173 documents en
 * 14 s ; `payments:projectLeaderboard` 12,8 s. Ces trois-là passent par ce
 * chemin.
 *
 * Même idiome que `AssignmentViewsCache` : optionnel, préparé par l'appelant,
 * absent = comportement d'avant à l'identique.
 */
export type CreatorPayrollSources = {
  assignments: Doc<"assignments">[];
  bonusUnlocks: Doc<"bonusUnlocks">[];
  challengeWins: Doc<"challengeWins">[];
  /** Nom du défi par id — résolu une fois, pas une fois par victoire ET par cycle. */
  challengeNames: Map<string, string>;
};

/**
 * Charge les sources d'UNE créatrice. `knownAssignments` évite une relecture à
 * l'appelant qui les a déjà (cf `cyclePaymentsForCreator`, qui les collecte
 * pour re-fenêtrer ses lineItems legacy).
 */
export async function loadCreatorPayrollSources(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  knownAssignments?: Doc<"assignments">[],
): Promise<CreatorPayrollSources> {
  const assignments =
    knownAssignments ??
    (
      await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).filter((a) => a.projectId === projectId);
  const bonusUnlocks = (
    await ctx.db
      .query("bonusUnlocks")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter((u) => u.projectId === projectId);
  const challengeWins = (
    await ctx.db
      .query("challengeWins")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter((w) => w.projectId === projectId);
  // Un `get` par DÉFI distinct, pas par victoire : deux primes du même défi ne
  // valent pas deux lectures, et surtout pas deux lectures par cycle.
  const challengeNames = new Map<string, string>();
  for (const id of new Set(challengeWins.map((w) => w.challengeId))) {
    const challenge = await ctx.db.get(id);
    if (challenge) challengeNames.set(id as string, challenge.name);
  }
  return { assignments, bonusUnlocks, challengeWins, challengeNames };
}

async function challengeCashWins(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  inWindow: (win: Doc<"challengeWins">) => boolean,
  sources?: CreatorPayrollSources,
): Promise<PricingBreakdown["challengeWins"]> {
  const all =
    sources?.challengeWins ??
    (
      await ctx.db
        .query("challengeWins")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).filter((w) => w.projectId === projectId);
  const wins = all.filter(
    (w) =>
      w.projectId === projectId &&
      w.reward.type === "cash" &&
      w.cancelledAt === undefined &&
      inWindow(w),
  );
  const out: PricingBreakdown["challengeWins"] = [];
  for (const w of wins) {
    // Nom LU au moment du calcul et FIGÉ au gel : renommer un défi ensuite ne
    // réécrit pas une feuille de paie déjà émise.
    const name = sources
      ? sources.challengeNames.get(w.challengeId as string)
      : (await ctx.db.get(w.challengeId))?.name;
    out.push({
      winId: w._id,
      challengeName: name ?? "Défi",
      montant: w.reward.amount ?? 0,
    });
  }
  return out.sort((a, b) => a.challengeName.localeCompare(b.challengeName, "fr"));
}

/**
 * Coût d'UNE vidéo lu depuis un breakdown de paie — POINT DE DÉCISION UNIQUE du
 * « on sait / on ne sait pas ».
 *
 * Le hub d'analytics cherche la vidéo dans le breakdown de sa (créatrice, mois).
 * Trois situations s'y confondaient, et la troisième éteignait des cartes :
 *
 *  1. `hasPricingSnapshot = false` — assignation LEGACY, sans barème figé. Le coût
 *     est réellement INCONNU → `null`. (Aucune en prod le 2026-09-05, mais le cas
 *     reste possible sur l'historique.)
 *  2. la vidéo (ou au moins son groupe de barème) est DANS le breakdown → coût
 *     calculé, comportement inchangé.
 *  3. barème figé, mais la vidéo est ABSENTE du breakdown parce qu'elle n'a AUCUN
 *     post rémunéré (`hasPayablePost = false`). Elle en a été retirée par DÉCISION
 *     — `remunere = false` posé à la main. Son coût n'est pas inconnu : il vaut
 *     ZÉRO. Elle ne consomme pas non plus de budget fixe, puisque le moteur ne la
 *     compte pas dans son groupe.
 *
 * Le cas 3 rendait `null` et contaminait tout : `getAttribution` pose
 * `costs.promo = null` dès qu'UNE vidéo promo manque, ce qui éteint « Coût
 * d'acquisition », « RPM coût » et « Écart » d'un coup. Constaté en prod le
 * 2026-09-05 : deux vidéos de Veljko (02 et 03/09, 4 posts promo passés à
 * `remunere = false` entre le 03 et le 05) suffisaient à vider les trois cartes.
 *
 * Reste `null` le cas vraiment anormal : barème figé, posts rémunérés, et pourtant
 * absente du breakdown. Là, on ne sait effectivement pas — et il faut le voir.
 */
export function assignmentCostFromBreakdown(input: {
  /** Un barème est-il FIGÉ sur l'assignation ? false = legacy. */
  hasPricingSnapshot: boolean;
  /** Part fixe/vidéo du groupe ; `null` si le groupe est absent du breakdown. */
  fixePerVideo: number | null;
  /** CPM plafonné de la vidéo ; `null` si la vidéo est absente du breakdown. */
  cpm: number | null;
  /** La vidéo a-t-elle au moins un post RÉMUNÉRÉ ? */
  hasPayablePost: boolean;
  /** Vues des posts rémunérés (assiette du CPM). */
  payableViews: number;
  /** Vues rémunérées ET en promo (cf viewCounters.paliers). */
  promoPaidViews: number;
}): { cost: number | null; promoCost: number | null } {
  if (!input.hasPricingSnapshot) return { cost: null, promoCost: null };
  if (input.fixePerVideo !== null || input.cpm !== null) {
    const fixed = input.fixePerVideo ?? 0;
    const cpm = input.cpm ?? 0;
    return {
      cost: round2(fixed + cpm),
      promoCost: promoVideoCost(
        fixed,
        cpm,
        input.payableViews,
        input.promoPaidViews,
      ),
    };
  }
  // Retirée de la paie par décision : coût CONNU, et il vaut zéro.
  if (!input.hasPayablePost) return { cost: 0, promoCost: 0 };
  return { cost: null, promoCost: null };
}

/**
 * Paie PRICING (live) d'un (créateur, projet, mois) — SOURCE UNIQUE consommée
 * par la lecture (getMyPayments/listPayments) ET le gel au paiement. FIXE/CPM :
 * assignments publiés/payés à pricingSnapshot dont le mois de publication =
 * `period`. BONUS CASH : Σ des bonusUnlocks CASH PERSISTÉS dont
 * `attributionPeriod === period` (Guard B — JAMAIS ré-évalué live ; le $
 * d'une période vient uniquement des unlocks persistés). Guard B (legacy) :
 * exclut les assignments déjà couverts par une lineItem legacy.
 *
 * `periodKeyOf` — comment un instant est ramené à un mois. Défaut `periodOf`
 * (UTC), qui est la période de PAIE et la seule valeur PERSISTÉE : tous les
 * appels de la paie gardent donc EXACTEMENT le comportement d'avant. Le seul
 * appelant qui l'écrase est la carte Rentabilité (convex/profitability.ts), qui
 * lit un mois CALENDAIRE Europe/Paris — il faut alors que la fenêtre du coût soit
 * la même que celle du revenu Whop et des vues, sinon une vidéo publiée le 1er à
 * 00:03 Paris se retrouve avec ses vues d'un côté et son coût de l'autre.
 * ⚠️ NE JAMAIS passer autre chose que `periodOf` depuis un chemin qui ÉCRIT
 * (accrual, gel au paiement) : la clé y sert de jointure avec `payments.period`.
 */
export async function computeLivePricingBreakdown(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  period: string,
  legacyAssignmentIds: Set<string>,
  periodKeyOf: (ts: number) => string = periodOf,
  /** Cache de vues d'UNE query — cf AssignmentViewsCache. */
  viewsCache?: AssignmentViewsCache,
  /**
   * Lectures par créatrice partagées par TOUTES ses périodes (cf
   * CreatorPayrollSources). Absent = on relit, comme avant.
   */
  sources?: CreatorPayrollSources,
): Promise<PricingBreakdown> {
  const allAssignments =
    sources?.assignments ??
    (
      await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).filter((a) => a.projectId === projectId);
  const assignments = allAssignments.filter(
    (a) =>
      a.projectId === projectId &&
      a.pricingSnapshot !== undefined &&
      (a.status === "published" || a.status === "paid") &&
      periodKeyOf(assignmentPublishedAt(a)) === period &&
      !legacyAssignmentIds.has(a._id),
  );
  const items: PayoutItem[] = [];
  let unmeasuredPayablePosts = 0;
  for (const a of assignments) {
    const { payableViews, hasPayablePost, unmeasuredPayablePosts: nonMesures } =
      await assignmentViewsAndMetrics(ctx, a, Date.now(), viewsCache);
    // Vidéo ENTIÈREMENT warmup → exclue (ni fixe compté, ni CPM). Partiellement
    // warmup → CPM sur les seules vues payables ; compte une fois pour le fixe.
    if (!hasPayablePost) continue;
    // Comptées seulement sur les vidéos RETENUES pour la paie : signaler une
    // vidéo warmup non mesurée n'aurait aucun sens, elle n'est pas payée.
    unmeasuredPayablePosts += nonMesures;
    items.push({
      assignmentId: a._id,
      snapshot: a.pricingSnapshot!,
      totalViews: payableViews,
    });
  }
  const base = computeMonthlyPayout(items);
  const allUnlocks =
    sources?.bonusUnlocks ??
    (
      await ctx.db
        .query("bonusUnlocks")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).filter((u) => u.projectId === projectId);
  const cashUnlocks = allUnlocks.filter(
    (u) =>
      u.projectId === projectId &&
      u.rewardType === "cash" &&
      u.attributionPeriod === period,
  );
  const bonusTierCashTotal = round2(
    cashUnlocks.reduce((s, u) => s + (u.montant ?? 0), 0),
  );
  // Détail par palier (AFFICHAGE) — même liste `cashUnlocks` déjà sommée
  // ci-dessus : la somme des montants = bonusTierCashTotal, `total` inchangé.
  const bonusTierCashUnlocks = cashUnlocks
    .map((u) => ({ seuilVues: u.seuilVues, montant: u.montant ?? 0 }))
    .sort((a, b) => a.seuilVues - b.seuilVues);
  // PRIMES DE DÉFI — fenêtrées sur `attributionPeriod`, comme les paliers.
  const challengeWins = await challengeCashWins(
    ctx,
    projectId,
    creatorId,
    (w) => w.attributionPeriod === period,
    sources,
  );
  const challengeTotal = round2(
    challengeWins.reduce((s, w) => s + w.montant, 0),
  );
  return {
    ...base,
    bonusTierCashTotal,
    bonusTierCashUnlocks,
    challengeTotal,
    challengeWins,
    unmeasuredPayablePosts,
    // ⚠️ La prime S'AJOUTE, elle ne remplace rien : `base.total` (fixe + CPM)
    // est intouché. C'est ce que garantit le barème dédié à fixe nul — les
    // vidéos de défi forment leur propre groupe de paie.
    total: round2(base.total + bonusTierCashTotal + challengeTotal),
  };
}

/**
 * Paie PRICING (live) d'un (créateur, projet) pour UN CYCLE J+30 GLISSANT.
 * IDENTIQUE à computeLivePricingBreakdown mais le fenêtrage est PERSO au créateur
 * (cycleIndexOf(firstPostAt, …)) au lieu du mois calendaire. Le MONTANT est
 * inchangé : MÊME moteur `computeMonthlyPayout` (fixe/CPM, cap 150$/vidéo) — seul
 * le prédicat de fenêtre change. FIXE/CPM : assignments publiés/payés à
 * pricingSnapshot dont le CYCLE de publication = `cycleIndex`. BONUS CASH : unlocks
 * cash dont le CYCLE de déblocage (unlockedAt) = `cycleIndex` (≠ attributionPeriod
 * calendaire, obsolète sous cycles). Exclut les assignments couverts par une
 * lineItem legacy (Guard B).
 */
export async function computeCyclePricingBreakdown(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  firstPostAt: number,
  cycleIndex: number,
  legacyAssignmentIds: Set<string>,
  /** Cache de vues d'UNE query — cf AssignmentViewsCache. */
  viewsCache?: AssignmentViewsCache,
  /**
   * Lectures par créatrice partagées par TOUS ses cycles (cf
   * CreatorPayrollSources). Absent = on relit, comme avant.
   */
  sources?: CreatorPayrollSources,
): Promise<PricingBreakdown> {
  const allAssignments =
    sources?.assignments ??
    (
      await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).filter((a) => a.projectId === projectId);
  const assignments = allAssignments.filter(
    (a) =>
      a.projectId === projectId &&
      a.pricingSnapshot !== undefined &&
      (a.status === "published" || a.status === "paid") &&
      cycleIndexOf(firstPostAt, assignmentPublishedAt(a)) === cycleIndex &&
      !legacyAssignmentIds.has(a._id),
  );
  const items: PayoutItem[] = [];
  let unmeasuredPayablePosts = 0;
  for (const a of assignments) {
    const { payableViews, hasPayablePost, unmeasuredPayablePosts: nonMesures } =
      await assignmentViewsAndMetrics(ctx, a, Date.now(), viewsCache);
    // Vidéo ENTIÈREMENT warmup → exclue (ni fixe compté, ni CPM). Partiellement
    // warmup → CPM sur les seules vues payables ; compte une fois pour le fixe.
    if (!hasPayablePost) continue;
    // Comptées seulement sur les vidéos RETENUES pour la paie : signaler une
    // vidéo warmup non mesurée n'aurait aucun sens, elle n'est pas payée.
    unmeasuredPayablePosts += nonMesures;
    items.push({
      assignmentId: a._id,
      snapshot: a.pricingSnapshot!,
      totalViews: payableViews,
    });
  }
  const base = computeMonthlyPayout(items);
  const allUnlocks =
    sources?.bonusUnlocks ??
    (
      await ctx.db
        .query("bonusUnlocks")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).filter((u) => u.projectId === projectId);
  const cashUnlocks = allUnlocks.filter(
    (u) =>
      u.projectId === projectId &&
      u.rewardType === "cash" &&
      cycleIndexOf(firstPostAt, u.unlockedAt) === cycleIndex,
  );
  const bonusTierCashTotal = round2(
    cashUnlocks.reduce((s, u) => s + (u.montant ?? 0), 0),
  );
  // Détail par palier (AFFICHAGE) — même liste `cashUnlocks` déjà sommée
  // ci-dessus : la somme des montants = bonusTierCashTotal, `total` inchangé.
  const bonusTierCashUnlocks = cashUnlocks
    .map((u) => ({ seuilVues: u.seuilVues, montant: u.montant ?? 0 }))
    .sort((a, b) => a.seuilVues - b.seuilVues);
  // PRIMES DE DÉFI — fenêtrées sur le CYCLE de la VICTOIRE (`wonAt`), comme les
  // paliers le sont sur `unlockedAt`. La prime est due au moment où la victoire
  // est actée, pas à la deadline du défi : un défi qui court à cheval sur deux
  // cycles paie dans celui où la barre a été franchie, et une prime ne se perd
  // pas parce qu'un cycle s'est clos entre-temps.
  const challengeWins = await challengeCashWins(
    ctx,
    projectId,
    creatorId,
    (w) => cycleIndexOf(firstPostAt, w.wonAt) === cycleIndex,
    sources,
  );
  const challengeTotal = round2(
    challengeWins.reduce((s, w) => s + w.montant, 0),
  );
  return {
    ...base,
    bonusTierCashTotal,
    bonusTierCashUnlocks,
    challengeTotal,
    challengeWins,
    unmeasuredPayablePosts,
    // ⚠️ S'AJOUTE (cf. computeLivePricingBreakdown) : fixe et CPM intouchés.
    total: round2(base.total + bonusTierCashTotal + challengeTotal),
  };
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
    throw err(ERR.PRICING_NOT_IN_PROJECT, "Pricing introuvable dans le projet.");
  }
  if (pricing.status !== "active") {
    throw err(ERR.PRICING_ARCHIVED, "Pricing archivé : réactive-le pour l'attribuer.");
  }
  return {
    pricingId: pricing._id,
    montantFixe: pricing.montantFixe,
    nbVideosCible: pricing.nbVideosCible,
    tauxCPM: pricing.tauxCPM,
    // legacy v1 sur le snapshot (ignorés par le moteur v2) — défaut 0.
    seuilBonusVues: pricing.seuilBonusVues ?? 0,
    montantBonus: pricing.montantBonus ?? 0,
  };
}

// ─── CRUD admin (scopé projet) ───────────────────────────────────────────────

type PricingInput = {
  name: string;
  montantFixe: number;
  nbVideosCible: number;
  tauxCPM: number;
  bonusTiers?: BonusTier[];
  bonusTemplateId?: Id<"bonusTemplates"> | null;
};

/**
 * Normalise la PROVENANCE de l'échelle pour l'écriture, en distinguant trois
 * intentions que la spread écraserait en une seule :
 *   - clé absente      → ne pas toucher au champ (patch partiel) ;
 *   - clé à `null`     → couper le lien au modèle (patch avec `undefined`, ce
 *                        qui SUPPRIME le champ côté Convex) ;
 *   - clé renseignée   → poser le lien.
 * Sans cette distinction, une simple modification de nom effacerait la
 * provenance, et l'écran cesserait de signaler qu'une échelle a divergé.
 */
function pricingWriteFields(args: PricingInput) {
  const { bonusTemplateId, ...rest } = args;
  if (!("bonusTemplateId" in args)) return rest;
  return { ...rest, bonusTemplateId: bonusTemplateId ?? undefined };
}

function validatePricingFields(args: PricingInput): PricingInput {
  const name = args.name.trim();
  if (name.length === 0) throw new ConvexError("Le nom du pricing est requis.");
  if (!Number.isInteger(args.nbVideosCible) || args.nbVideosCible < 1) {
    throw new ConvexError("nbVideosCible doit être un entier ≥ 1.");
  }
  for (const [label, val] of [
    ["montantFixe", args.montantFixe],
    ["tauxCPM", args.tauxCPM],
  ] as const) {
    if (!Number.isFinite(val) || val < 0) {
      throw new ConvexError(`${label} doit être un nombre ≥ 0.`);
    }
  }
  validateBonusTiers(args.bonusTiers ?? []);
  return { ...args, name };
}

/**
 * Validation d'une ÉCHELLE de paliers. Partagée par les barèmes et par les
 * MODÈLES d'échelle : un modèle est destiné à être recopié dans un barème, donc
 * il doit passer exactement les mêmes contrôles à la saisie — sinon on stocke
 * dans la bibliothèque une échelle que le barème refusera plus tard.
 */
function validateBonusTiers(tiers: BonusTier[]): void {
  for (const t of tiers) {
    if (!Number.isFinite(t.seuilVues) || t.seuilVues < 0) {
      throw new ConvexError("Le seuil de vues d'un palier doit être ≥ 0.");
    }
    if (t.rewardType === "cash") {
      if (!Number.isFinite(t.montant ?? NaN) || (t.montant ?? -1) < 0) {
        throw new ConvexError("Un palier cash exige un montant $ ≥ 0.");
      }
    } else {
      if (!(t.libelle ?? "").trim()) {
        throw new ConvexError("Un palier nature exige un libellé (ex. iPhone).");
      }
      // Facultatif, mais s'il est fourni il doit être un vrai montant : un coût
      // négatif ou NaN entrerait tel quel dans le coût complet du moteur.
      if (t.coutReel !== undefined && (!Number.isFinite(t.coutReel) || t.coutReel < 0)) {
        throw new ConvexError("Le coût réel d'un palier nature doit être ≥ 0.");
      }
    }
    if (t.rewardType === "cash" && t.coutReel !== undefined) {
      throw new ConvexError(
        "Le coût réel ne concerne que les paliers nature (le cash porte déjà son montant).",
      );
    }
  }
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

const BONUS_TIER_VALIDATOR = v.object({
  seuilVues: v.number(),
  rewardType: v.union(v.literal("cash"), v.literal("nature")),
  montant: v.optional(v.number()),
  libelle: v.optional(v.string()),
  // NATURE — coût réel pour NOUS. Facultatif : une récompense non chiffrée reste
  // visible (tiret) plutôt que d'être bloquée à la saisie ou comptée à 0.
  coutReel: v.optional(v.number()),
});

const PRICING_ARGS = {
  name: v.string(),
  montantFixe: v.number(),
  nbVideosCible: v.number(),
  tauxCPM: v.number(),
  bonusTiers: v.optional(v.array(BONUS_TIER_VALIDATOR)),
  // Provenance de l'échelle — traçabilité seule (cf schema). `null` la coupe
  // explicitement : une échelle repartie de zéro ne doit pas continuer à se
  // comparer à un modèle dont elle ne descend plus.
  bonusTemplateId: v.optional(v.union(v.id("bonusTemplates"), v.null())),
};

export const createPricing = permissionMutation("pricing.manage")({
  args: PRICING_ARGS,
  handler: async (ctx, args) => {
    const fields = pricingWriteFields(validatePricingFields(args));
    const pricingId = await ctx.db.insert("pricings", {
      projectId: ctx.projectId,
      ...fields,
      status: "active",
      createdAt: Date.now(),
    });
    return { pricingId };
  },
});

export const updatePricing = permissionMutation("pricing.manage")({
  args: { id: v.id("pricings"), ...PRICING_ARGS },
  handler: async (ctx, { id, ...args }) => {
    const pricing = await ctx.db.get(id);
    if (!pricing || pricing.projectId !== ctx.projectId) {
      throw new ConvexError("Pricing introuvable.");
    }
    const fields = pricingWriteFields(validatePricingFields(args));
    // Snapshot figé sur les assignments → modifier n'affecte QUE les futures
    // attributions (jamais les vidéos déjà attribuées). Les PALIERS, eux, sont
    // lus en direct : les toucher ici change bien la grille des créatrices.
    await ctx.db.patch(id, fields);
    return { ok: true };
  },
});

export const archivePricing = permissionMutation("pricing.manage")({
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

export const deletePricing = permissionMutation("pricing.manage")({
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
/**
 * BARÈMES SÉLECTIONNABLES À L'ASSIGNATION — bloc `assignments.manage`.
 *
 * POURQUOI CETTE QUERY EXISTE. `assignScriptCampaign` EXIGE un `pricingId` : sans
 * barème, on n'assigne pas. Or lister les barèmes vivait sous `pricing.manage`,
 * un bloc que le manager n'a pas — il ne pouvait donc pas accomplir le geste
 * central de son rôle. Masquer le sélecteur n'aurait rien réglé : ça aurait rendu
 * l'échec silencieux au lieu de bruyant.
 *
 * ⚠️ ELLE NE REND QUE `_id` ET `name` — aucun montant, aucun taux, aucun palier.
 * C'est exactement ce que le sélecteur affiche, et c'est plus étroit que la
 * frontière ne l'exige : le manager CHOISIT un barème par son nom, il n'en voit
 * pas les termes, et il ne peut toujours ni en créer, ni en modifier, ni en
 * archiver — tout cela reste sous `pricing.manage`.
 *
 * Actifs seulement : proposer un barème archivé serait offrir une impasse, le
 * serveur le refuse ensuite (`buildPricingSnapshot`).
 */
export const listPricingsForAssignment = permissionQuery("assignments.manage")({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("pricings")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return all
      .filter((p) => p.status === "active")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ _id: p._id, name: p.name }));
  },
});

/**
 * EFFECTIFS D'USAGE d'un barème — deux nombres, deux questions différentes :
 *
 *  - `assignmentCount` : vidéos dont le snapshot FIGÉ porte ce pricingId. C'est
 *    ce qui rend une suppression impossible, et l'écran l'affiche comme MOTIF de
 *    désactivation du bouton plutôt que de proposer un geste que le serveur
 *    refusera (`deletePricing`).
 *  - `bonusCreatorCount` : créatrices dont la grille de bonus EFFECTIVE est ce
 *    barème — la sienne en propre, ou par héritage du défaut projet. C'est le
 *    nombre qui compte avant de toucher aux paliers, parce que les paliers sont
 *    lus EN DIRECT (aucun snapshot ne les fige, cf effectiveBonusPricing).
 *
 * Un seul balayage des assignations et un seul des créatrices, hors de toute
 * boucle par barème.
 */
export const listPricings = permissionQuery("pricing.manage")({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, { includeArchived }) => {
    const all = await ctx.db
      .query("pricings")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();

    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const assignmentCounts = new Map<string, number>();
    for (const a of assignments) {
      const id = a.pricingSnapshot?.pricingId;
      if (id) assignmentCounts.set(id, (assignmentCounts.get(id) ?? 0) + 1);
    }

    const project = await ctx.db.get(ctx.projectId);
    const defaultBonusId = project?.defaultBonusPricingId ?? null;
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const bonusCounts = new Map<string, number>();
    for (const c of creators) {
      // Même résolution que effectiveBonusPricing : la grille perso PRIME, sinon
      // le défaut du projet. Les compter autrement ferait mentir l'avertissement
      // affiché avant d'écrire une échelle.
      const id = c.bonusPricingId ?? defaultBonusId;
      if (id) bonusCounts.set(id, (bonusCounts.get(id) ?? 0) + 1);
    }

    const rows = includeArchived
      ? all
      : all.filter((p) => p.status === "active");
    return rows
      .sort((a, b) => a.name.localeCompare(b.name))
      // Champs ÉNUMÉRÉS, jamais `...p` : un spread ferait sortir tout champ
      // ajouté plus tard au document sans que personne l'ait décidé.
      .map((p) => ({
        _id: p._id,
        name: p.name,
        status: p.status,
        createdAt: p.createdAt,
        montantFixe: p.montantFixe,
        nbVideosCible: p.nbVideosCible,
        tauxCPM: p.tauxCPM,
        bonusTiers: p.bonusTiers,
        // legacy v1 — `tiersOf` en a besoin pour rendre le seuil unique des
        // barèmes d'avant les paliers.
        seuilBonusVues: p.seuilBonusVues,
        montantBonus: p.montantBonus,
        bonusTemplateId: p.bonusTemplateId,
        assignmentCount: assignmentCounts.get(p._id) ?? 0,
        bonusCreatorCount: bonusCounts.get(p._id) ?? 0,
        isDefaultBonus: p._id === defaultBonusId,
      }));
  },
});

// ─── Bibliothèque de MODÈLES d'échelle de bonus ──────────────────────────────
//
// Les mêmes six paliers étaient recopiés à la main dans chaque barème. Un modèle
// se saisit une fois et se pique dans n'importe quel barème.
//
// ⚠️ LE MODÈLE NE PAIE JAMAIS. Appliquer un modèle RECOPIE ses paliers dans le
// barème ; c'est le barème qui reste la source de la paie, et la clé
// d'idempotence des unlocks (creatorId, pricingId, seuilVues) ne bouge pas d'un
// pouce. Deux conséquences assumées :
//   - modifier un modèle ne change RIEN tant qu'on ne le réapplique pas ;
//   - supprimer un modèle ne peut coûter aucun dollar à personne.
// C'est le prix payé pour ne pas toucher à la table qui décide qui a débloqué
// quel bonus.

export const listBonusTemplates = permissionQuery("pricing.manage")({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("bonusTemplates")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

const TEMPLATE_ARGS = {
  name: v.string(),
  tiers: v.array(BONUS_TIER_VALIDATOR),
};

function validateTemplate(args: { name: string; tiers: BonusTier[] }) {
  const name = args.name.trim();
  if (name.length === 0) throw new ConvexError("Le nom du modèle est requis.");
  if (args.tiers.length === 0) {
    throw new ConvexError("Un modèle sans palier n'a rien à recopier.");
  }
  // Mêmes contrôles qu'un barème : un modèle qui ne passerait pas la validation
  // d'un pricing serait une échelle piégée, refusée seulement à l'application.
  validateBonusTiers(args.tiers);
  const seuils = args.tiers.map((t) => t.seuilVues);
  if (new Set(seuils).size !== seuils.length) {
    throw new ConvexError("Deux paliers ne peuvent pas partager le même seuil.");
  }
  // Trié à l'écriture : une échelle se lit de bas en haut, et le tri retire une
  // source de fausse divergence entre deux modèles identiques mal saisis.
  return {
    name,
    tiers: [...args.tiers].sort((a, b) => a.seuilVues - b.seuilVues),
  };
}

export const createBonusTemplate = permissionMutation("pricing.manage")({
  args: TEMPLATE_ARGS,
  handler: async (ctx, args) => {
    const fields = validateTemplate(args);
    const templateId = await ctx.db.insert("bonusTemplates", {
      projectId: ctx.projectId,
      ...fields,
      createdAt: Date.now(),
    });
    return { templateId };
  },
});

export const updateBonusTemplate = permissionMutation("pricing.manage")({
  args: { id: v.id("bonusTemplates"), ...TEMPLATE_ARGS },
  handler: async (ctx, { id, ...args }) => {
    const tpl = await ctx.db.get(id);
    if (!tpl || tpl.projectId !== ctx.projectId) {
      throw new ConvexError("Modèle introuvable.");
    }
    // Aucune propagation ici, volontairement : la réapplication est un geste
    // séparé, qui annonce d'abord combien de créatrices elle touche.
    await ctx.db.patch(id, validateTemplate(args));
    return { ok: true };
  },
});

export const deleteBonusTemplate = permissionMutation("pricing.manage")({
  args: { id: v.id("bonusTemplates") },
  handler: async (ctx, { id }) => {
    const tpl = await ctx.db.get(id);
    if (!tpl || tpl.projectId !== ctx.projectId) {
      throw new ConvexError("Modèle introuvable.");
    }
    // Pas de garde d'usage : un modèle ne paie rien. Les barèmes qui en
    // descendent gardent leurs paliers intacts — ils perdent seulement la
    // mention de provenance, que l'écran traite comme « aucun modèle ».
    await ctx.db.delete(id);
    return { ok: true };
  },
});

/**
 * APPLIQUE un modèle à des barèmes : recopie ses paliers dans chacun et note la
 * provenance.
 *
 * ⚠️ CE GESTE CHANGE LA PAIE. Les paliers sont lus EN DIRECT (aucun snapshot ne
 * les fige) : après cet appel, les créatrices dont la grille effective est l'un
 * de ces barèmes voient l'échelle du modèle, et les paliers qu'elles ont déjà
 * franchis se matérialisent immédiatement — même contrat que
 * `setDefaultBonusPricing`, à qui on emprunte la synchronisation. Les unlocks
 * passés sont IMMUABLES et figés à leur déblocage : abaisser un seuil en ajoute,
 * le relever n'en retire aucun.
 *
 * Renvoie ce qui a été touché, pour que l'écran l'affiche au lieu de le deviner.
 */
export const applyBonusTemplate = permissionMutation("pricing.manage")({
  args: {
    templateId: v.id("bonusTemplates"),
    pricingIds: v.array(v.id("pricings")),
  },
  handler: async (ctx, { templateId, pricingIds }) => {
    const tpl = await ctx.db.get(templateId);
    if (!tpl || tpl.projectId !== ctx.projectId) {
      throw new ConvexError("Modèle introuvable.");
    }
    if (pricingIds.length === 0) {
      throw new ConvexError("Choisis au moins un barème.");
    }
    // Validation d'abord, écriture ensuite : un id étranger au projet dans le
    // lot ne doit pas laisser la moitié des barèmes réécrits.
    const targets = [];
    for (const id of pricingIds) {
      const pricing = await ctx.db.get(id);
      if (!pricing || pricing.projectId !== ctx.projectId) {
        throw err(ERR.PRICING_NOT_IN_PROJECT, "Barème introuvable dans le projet.");
      }
      targets.push(pricing);
    }
    for (const pricing of targets) {
      await ctx.db.patch(pricing._id, {
        bonusTiers: tpl.tiers,
        bonusTemplateId: templateId,
      });
    }

    // Créatrices dont la grille EFFECTIVE est l'un des barèmes touchés : grille
    // perso pointant dessus, ou héritage du défaut projet si celui-ci en est.
    const touched = new Set<string>(targets.map((p) => p._id));
    const project = await ctx.db.get(ctx.projectId);
    const defaultIsTouched =
      project?.defaultBonusPricingId !== undefined &&
      touched.has(project.defaultBonusPricingId);
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    let creatorsSynced = 0;
    for (const c of creators) {
      const concerned = c.bonusPricingId
        ? touched.has(c.bonusPricingId)
        : defaultIsTouched;
      if (!concerned) continue;
      await syncBonusUnlocks(ctx, ctx.projectId, c._id);
      creatorsSynced += 1;
    }
    return { pricings: targets.length, creatorsSynced };
  },
});

/**
 * DÉRIVE DE SNAPSHOT — assignations dont le barème FIGÉ ne correspond plus aux
 * termes actuels de leur pricing.
 *
 * Le snapshot est figé à l'attribution et jamais réécrit ; éditer un barème
 * EN PLACE n'affecte donc que les attributions futures. Rien ne le montrait :
 * sur Snytch, 56 assignations sont restées à 100 $/60 + 1,1 alors que l'écran
 * affichait 0 $/60 + 1,0, et le pricingId identique masquait l'écart.
 *
 * Renvoie, PAR pricing, les générations de snapshot divergentes avec leur
 * effectif et un échantillon d'assignations (pour le détail au clic).
 */
export const listPricingSnapshotDrift = permissionQuery("pricing.manage")({
  args: {},
  handler: async (ctx) => {
    const pricings = await ctx.db
      .query("pricings")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const creators = new Map(
      (
        await ctx.db
          .query("creators")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect()
      ).map((c) => [c._id, c.name]),
    );

    type Gen = {
      montantFixe: number;
      nbVideosCible: number;
      tauxCPM: number;
      count: number;
      /** Échantillon borné — le détail au clic n'a pas à charger 500 lignes. */
      sample: {
        assignmentId: Id<"assignments">;
        creatorName: string;
        createdAt: number;
        status: string;
      }[];
    };
    const SAMPLE_MAX = 25;
    const byPricing = new Map<string, Map<string, Gen>>();

    for (const a of assignments) {
      const snap = a.pricingSnapshot;
      if (!snap) continue;
      const live = pricings.find((p) => p._id === snap.pricingId);
      if (!live) continue; // pricing supprimé : hors périmètre de la comparaison
      const same =
        snap.montantFixe === live.montantFixe &&
        snap.nbVideosCible === live.nbVideosCible &&
        snap.tauxCPM === live.tauxCPM;
      if (same) continue;
      const key = `${snap.montantFixe}|${snap.nbVideosCible}|${snap.tauxCPM}`;
      let gens = byPricing.get(snap.pricingId);
      if (!gens) {
        gens = new Map();
        byPricing.set(snap.pricingId, gens);
      }
      let g = gens.get(key);
      if (!g) {
        g = {
          montantFixe: snap.montantFixe,
          nbVideosCible: snap.nbVideosCible,
          tauxCPM: snap.tauxCPM,
          count: 0,
          sample: [],
        };
        gens.set(key, g);
      }
      g.count += 1;
      if (g.sample.length < SAMPLE_MAX) {
        g.sample.push({
          assignmentId: a._id,
          creatorName: creators.get(a.creatorId) ?? a.creatorNameSnapshot ?? "—",
          createdAt: a.createdAt,
          status: a.status,
        });
      }
    }

    return pricings
      .map((p) => {
        const gens = [...(byPricing.get(p._id)?.values() ?? [])].sort(
          (x, y) => y.count - x.count,
        );
        return {
          pricingId: p._id,
          pricingName: p.name,
          /** Termes ACTUELS, pour l'affichage « figé X vs actuel Y ». */
          current: {
            montantFixe: p.montantFixe,
            nbVideosCible: p.nbVideosCible,
            tauxCPM: p.tauxCPM,
          },
          driftCount: gens.reduce((s, g) => s + g.count, 0),
          generations: gens.map((g) => ({
            ...g,
            sample: g.sample.sort((x, y) => x.createdAt - y.createdAt),
          })),
        };
      })
      .filter((r) => r.driftCount > 0);
  },
});

// ─── Statut des paliers de bonus (cumul + jauge + récompenses) ───────────────

/**
 * Statut bonus d'un créateur (cumul + grille + récompenses débloquées). Le $
 * cash DÉBLOQUÉ (lifetime) vient des unlocks PERSISTÉS ; la jauge (prochain
 * palier) est calculée live sur le cumul courant. ISOLATION par creatorId.
 */
async function bonusStatusFor(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creator: Doc<"creators">,
): Promise<{
  cumulViews: number;
  tiers: BonusTier[];
  crossed: BonusTier[];
  nextTier: BonusTier | null;
  viewsToNext: number | null;
  cashUnlockedTotal: number;
  natureUnlocked: { libelle: string; unlockedAt: number }[];
}> {
  const tiers = await creatorBonusTiers(ctx, creator);
  const cumulViews = await creatorCumulViews(ctx, projectId, creator._id);
  const ev = evaluateBonusTiers(cumulViews, tiers);
  const unlocks = (
    await ctx.db
      .query("bonusUnlocks")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect()
  ).filter((u) => u.projectId === projectId);
  const cashUnlockedTotal = round2(
    unlocks
      .filter((u) => u.rewardType === "cash")
      .reduce((s, u) => s + (u.montant ?? 0), 0),
  );
  const natureUnlocked = unlocks
    .filter((u) => u.rewardType === "nature")
    .map((u) => ({ libelle: u.libelle ?? "Récompense", unlockedAt: u.unlockedAt }))
    .sort((a, b) => a.unlockedAt - b.unlockedAt);
  return {
    cumulViews,
    tiers,
    crossed: ev.crossed,
    nextTier: ev.nextTier,
    viewsToNext: ev.viewsToNext,
    cashUnlockedTotal,
    natureUnlocked,
  };
}

/** CRÉATEUR — son statut bonus sur le projet courant (jauge + récompenses). */
export const getMyBonusStatus = creatorQuery({
  args: {},
  handler: async (ctx) => {
    const creator = await ctx.db.get(ctx.creatorId);
    if (!creator) return null;
    return bonusStatusFor(ctx, ctx.projectId, creator);
  },
});

/** ADMIN — statut bonus d'UN créateur du projet (panneau récompenses). */
export const getCreatorBonusStatus = permissionQuery("pricing.manage")({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, { creatorId }) => {
    const creator = await ctx.db.get(creatorId);
    if (!creator || creator.projectId !== ctx.projectId) return null;
    return bonusStatusFor(ctx, ctx.projectId, creator);
  },
});

/** ADMIN — grille de bonus par DÉFAUT du projet (id ou null). */
export const getDefaultBonusPricingId = permissionQuery("pricing.manage")({
  args: {},
  handler: async (ctx): Promise<Id<"pricings"> | null> => {
    const project = await ctx.db.get(ctx.projectId);
    return project?.defaultBonusPricingId ?? null;
  },
});

/**
 * ADMIN — désigne (ou retire avec null) la grille de bonus par DÉFAUT du projet.
 * Toute créatrice SANS grille perso en hérite pour l'échelle ET la paie
 * (cf effectiveBonusPricing). Matérialise IMMÉDIATEMENT (idempotent) les paliers
 * déjà atteints par ces créatrices → leurs bonus cash entrent en paie au prochain
 * cycle ouvert. N'affecte PAS les créatrices à grille perso, ni les cycles déjà
 * payés (gel intact), ni Fixe/CPM.
 * ⚠️ Changer le défaut X→Y peut re-débloquer un même seuil sous la nouvelle
 * grille (clé d'idempotence = creatorId+pricingId+seuil) — même propriété qu'un
 * changement de grille perso ; à réserver aux (rares) reconfigurations assumées.
 */
export const setDefaultBonusPricing = permissionMutation("pricing.manage")({
  args: { pricingId: v.union(v.id("pricings"), v.null()) },
  handler: async (ctx, { pricingId }): Promise<{ synced: number }> => {
    if (pricingId !== null) {
      const pricing = await ctx.db.get(pricingId);
      if (!pricing || pricing.projectId !== ctx.projectId) {
        throw err(ERR.PRICING_NOT_IN_PROJECT, "Pricing introuvable dans le projet.");
      }
    }
    await ctx.db.patch(ctx.projectId, {
      defaultBonusPricingId: pricingId ?? undefined,
    });
    // Créatrices SANS grille perso → héritent du défaut : sync immédiat.
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    let synced = 0;
    for (const c of creators) {
      if (c.bonusPricingId) continue;
      await syncBonusUnlocks(ctx, ctx.projectId, c._id);
      synced += 1;
    }
    return { synced };
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
