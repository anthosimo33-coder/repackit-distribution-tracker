import {
  adminMutation,
  adminQuery,
  creatorQuery,
  e2eMutation,
} from "./functions";
import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { periodOf } from "./payments";
import { cycleIndexOf } from "./payCycle";
import { isRemunerated, type RemunerationFlags } from "./remunerate";

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
    totalViews: number;
    cpm: number;
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
  for (const [pricingId, groupItems] of groups) {
    const snapshot = groupItems[0].snapshot;
    const perVideo = fixePerVideo(snapshot);
    const videoCount = groupItems.length;
    // Fixe du groupe (plafonné au budget montantFixe) — arrondi au niveau groupe.
    const fixedGroup = round2(Math.min(videoCount * perVideo, snapshot.montantFixe));
    // Plafond 150 $/vidéo (RÉPLIQUE lib/pricing-engine) : dépassement rogné sur le
    // CPM d'abord, puis la part fixe (pathologique). Sans dépassement = inchangé.
    let remainingFixe = snapshot.montantFixe;
    let groupCpm = 0;
    let fixedOverflow = 0;
    for (const it of groupItems) {
      const fixedShare = Math.min(perVideo, Math.max(0, remainingFixe));
      remainingFixe -= fixedShare;
      const cpm = assignmentCpm(it.snapshot, it.totalViews);
      const excess = Math.max(0, fixedShare + cpm - MAX_PAY_PER_VIDEO_EUR);
      const cpmOverflow = Math.min(cpm, excess);
      fixedOverflow += excess - cpmOverflow;
      const cappedCpm = round2(cpm - cpmOverflow);
      groupCpm = round2(groupCpm + cappedCpm);
      perAssignment.push({
        assignmentId: it.assignmentId,
        pricingId: it.snapshot.pricingId,
        totalViews: Math.max(0, it.totalViews),
        cpm: cappedCpm,
      });
    }
    const fixed = round2(fixedGroup - fixedOverflow);
    perPricing.push({
      pricingId,
      videoCount,
      nbVideosCible: snapshot.nbVideosCible,
      montantFixe: snapshot.montantFixe,
      fixePerVideo: round2(perVideo),
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
 *  - `totalViews` : Σ de TOUTES les vues (warmup INCLUS) → AFFICHAGE/suivi (un
 *    post warmup reste tracké normalement, ses vues restent visibles).
 *  - `payableViews` : Σ des vues des posts NON-warmup → CPM + cumul de paliers.
 *  - `hasPayablePost` : la vidéo compte-t-elle pour le FIXE (false = tout-warmup).
 *  - `hasMetrics` : suivi actif vs en cours de calcul (côté créatrice).
 *
 * Sans aucun post warmup, payableViews === totalViews et hasPayablePost === true
 * → la paie est INCHANGÉE. Cf lib/pricing-engine.payableAssignmentViews (A6).
 */
export async function assignmentViewsAndMetrics(
  ctx: QueryCtx | MutationCtx,
  a: Doc<"assignments">,
): Promise<{
  totalViews: number;
  payableViews: number;
  hasPayablePost: boolean;
  hasMetrics: boolean;
}> {
  const pubIds = [
    ...(a.targets ?? []).map((t) => t.publicationId),
    a.publicationId,
  ].filter((p): p is Id<"publications"> => p !== undefined);
  const pubs: PublicationViews[] = [];
  let hasMetrics = false;
  const seen = new Set<string>();
  for (const pid of pubIds) {
    if (seen.has(pid)) continue;
    seen.add(pid);
    const pub = await ctx.db.get(pid);
    if (!pub) continue;
    pubs.push({
      views: pub.vuesLatest ?? 0,
      isWarmup: pub.isWarmup === true,
      remunere: pub.remunere,
    });
    // Un snapshot a été relevé (Apify/YouTube/manuel) ⇒ suivi actif.
    if (pub.latestSnapshotAt !== undefined) hasMetrics = true;
  }
  const totalViews = pubs.reduce((s, p) => s + p.views, 0);
  const { payableViews, hasPayablePost } = payableAssignmentViews(pubs);
  return { totalViews, payableViews, hasPayablePost, hasMetrics };
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
 * vues PAYABLES (posts warmup EXCLUS) de TOUTES ses vidéos publiées/payées à
 * pricingSnapshot, SANS filtre de période (≠ du fixe/CPM qui sont mensuels).
 * Même base de vues que le CPM → jauge, CPM et paliers cohérents (un post
 * warmup ne fait avancer NI le CPM NI le cumul de paliers).
 */
export async function creatorCumulViews(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
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
    cumul += (await assignmentViewsAndMetrics(ctx, a)).payableViews;
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

/**
 * SYNC IDEMPOTENTE des paliers débloqués d'un créateur. Calcule le cumul, lit sa
 * grille, et pour chaque palier franchi SANS row d'unlock existante (Guard E —
 * clé (creatorId, pricingId, seuilVues)), INSÈRE un unlock IMMUABLE : récompense
 * FIGÉE + `attributionPeriod` (Guard A : période courante ; rollover si déjà
 * payée → période ouverte courante, jamais perdu). Sans effet si rien de neuf.
 */
export async function syncBonusUnlocks(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
): Promise<{ unlocked: number }> {
  const creator = await ctx.db.get(creatorId);
  if (!creator || creator.projectId !== projectId) return { unlocked: 0 };
  // Grille EFFECTIVE (perso ou défaut projet) → mêmes paliers que l'affichage,
  // et `pricingId` de la grille réellement utilisée (clé d'idempotence).
  const eff = await effectiveBonusPricing(ctx, creator);
  if (!eff || eff.tiers.length === 0) return { unlocked: 0 };
  const { pricingId, tiers } = eff;
  const cumul = await creatorCumulViews(ctx, projectId, creatorId);
  const now = Date.now();
  let unlocked = 0;
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
    if (existing) continue; // Guard E — immuable, jamais redéclenché.
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
      unlockedAt: now,
      cumulAtUnlock: cumul,
      attributionPeriod,
    });
    unlocked += 1;
  }
  return { unlocked };
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
}

/**
 * Paie PRICING (live) d'un (créateur, projet, mois) — SOURCE UNIQUE consommée
 * par la lecture (getMyPayments/listPayments) ET le gel au paiement. FIXE/CPM :
 * assignments publiés/payés à pricingSnapshot dont le mois de publication =
 * `period`. BONUS CASH : Σ des bonusUnlocks CASH PERSISTÉS dont
 * `attributionPeriod === period` (Guard B — JAMAIS ré-évalué live ; le $
 * d'une période vient uniquement des unlocks persistés). Guard B (legacy) :
 * exclut les assignments déjà couverts par une lineItem legacy.
 */
export async function computeLivePricingBreakdown(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  period: string,
  legacyAssignmentIds: Set<string>,
): Promise<PricingBreakdown> {
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
    const { payableViews, hasPayablePost } = await assignmentViewsAndMetrics(
      ctx,
      a,
    );
    // Vidéo ENTIÈREMENT warmup → exclue (ni fixe compté, ni CPM). Partiellement
    // warmup → CPM sur les seules vues payables ; compte une fois pour le fixe.
    if (!hasPayablePost) continue;
    items.push({
      assignmentId: a._id,
      snapshot: a.pricingSnapshot!,
      totalViews: payableViews,
    });
  }
  const base = computeMonthlyPayout(items);
  const cashUnlocks = (
    await ctx.db
      .query("bonusUnlocks")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter(
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
  return {
    ...base,
    bonusTierCashTotal,
    bonusTierCashUnlocks,
    total: round2(base.total + bonusTierCashTotal),
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
): Promise<PricingBreakdown> {
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
      cycleIndexOf(firstPostAt, assignmentPublishedAt(a)) === cycleIndex &&
      !legacyAssignmentIds.has(a._id),
  );
  const items: PayoutItem[] = [];
  for (const a of assignments) {
    const { payableViews, hasPayablePost } = await assignmentViewsAndMetrics(
      ctx,
      a,
    );
    // Vidéo ENTIÈREMENT warmup → exclue (ni fixe compté, ni CPM). Partiellement
    // warmup → CPM sur les seules vues payables ; compte une fois pour le fixe.
    if (!hasPayablePost) continue;
    items.push({
      assignmentId: a._id,
      snapshot: a.pricingSnapshot!,
      totalViews: payableViews,
    });
  }
  const base = computeMonthlyPayout(items);
  const cashUnlocks = (
    await ctx.db
      .query("bonusUnlocks")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter(
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
  return {
    ...base,
    bonusTierCashTotal,
    bonusTierCashUnlocks,
    total: round2(base.total + bonusTierCashTotal),
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
};

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
  for (const t of args.bonusTiers ?? []) {
    if (!Number.isFinite(t.seuilVues) || t.seuilVues < 0) {
      throw new ConvexError("Le seuil de vues d'un palier doit être ≥ 0.");
    }
    if (t.rewardType === "cash") {
      if (!Number.isFinite(t.montant ?? NaN) || (t.montant ?? -1) < 0) {
        throw new ConvexError("Un palier cash exige un montant $ ≥ 0.");
      }
    } else if (!(t.libelle ?? "").trim()) {
      throw new ConvexError("Un palier nature exige un libellé (ex. iPhone).");
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

const BONUS_TIER_VALIDATOR = v.object({
  seuilVues: v.number(),
  rewardType: v.union(v.literal("cash"), v.literal("nature")),
  montant: v.optional(v.number()),
  libelle: v.optional(v.string()),
});

const PRICING_ARGS = {
  name: v.string(),
  montantFixe: v.number(),
  nbVideosCible: v.number(),
  tauxCPM: v.number(),
  bonusTiers: v.optional(v.array(BONUS_TIER_VALIDATOR)),
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
export const getCreatorBonusStatus = adminQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, { creatorId }) => {
    const creator = await ctx.db.get(creatorId);
    if (!creator || creator.projectId !== ctx.projectId) return null;
    return bonusStatusFor(ctx, ctx.projectId, creator);
  },
});

/** ADMIN — grille de bonus par DÉFAUT du projet (id ou null). */
export const getDefaultBonusPricingId = adminQuery({
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
export const setDefaultBonusPricing = adminMutation({
  args: { pricingId: v.union(v.id("pricings"), v.null()) },
  handler: async (ctx, { pricingId }): Promise<{ synced: number }> => {
    if (pricingId !== null) {
      const pricing = await ctx.db.get(pricingId);
      if (!pricing || pricing.projectId !== ctx.projectId) {
        throw new ConvexError("Pricing introuvable dans le projet.");
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
