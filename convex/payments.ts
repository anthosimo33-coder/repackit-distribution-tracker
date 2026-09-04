import {
  adminViewAsQuery,
  creatorQuery,
  e2eMutation,
  permissionMutation,
  permissionQuery,
} from "./functions";
import { internal } from "./_generated/api";
import {
  computeLivePricingBreakdown,
  computeCyclePricingBreakdown,
  assignmentPublishedAt,
  syncBonusUnlocks,
  MAX_PAY_PER_VIDEO_EUR,
  type PricingBreakdown,
} from "./pricing";
import {
  calcCycle,
  cycleWindow,
  cyclePeriodKey,
  cycleIndexOf,
  CYCLE_LENGTH_MS,
  payAnchorOf,
} from "./payCycle";
import { paidBeforePayWindow } from "./payWindow";
import { resolveCreatorKind } from "./roles";
import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ERR, err } from "./errorCodes";

/**
 * P8 — Paiements (accrual). LOGIQUE D'ARGENT : chaque montant crédité est
 * calculé SERVEUR (jamais un montant fourni par le client) et l'accrual est
 * IDEMPOTENT (revalider / recalculer ne crédite jamais deux fois).
 *
 * Ce module porte : le calcul de période, la réplique serveur de
 * computeEarnings (règle A6 — un module convex/ ne peut pas importer lib/, cf
 * isFormatAllowedOnPlatform / normalizeSourceId / warmup), et les helpers
 * d'upsert de lineItems (base + bonus) appelés par assignments.validate /
 * assignments.computeViewBonus.
 */

type LineItem = {
  // Optionnel : un palier bonus cumulé (bonus_tier) n'a pas d'assignment.
  assignmentId?: Id<"assignments">;
  /** Phrase FIGÉE au paiement (français). Repli d'affichage, jamais réécrite. */
  label: string;
  /** Données structurées — le libellé est recomposé à l'affichage (cf schema). */
  detail?: {
    videoCount?: number;
    views?: number;
    cycleIndex?: number;
    challengeName?: string;
  };
  amount: number;
  // base/bonus = LEGACY ; fixed/cpm + bonus_tier = pricing GELÉ au paiement ;
  // clip = montant fixe par clip (clippeur) ; retainer = forfait de cycle
  // (talent) ; challenge = prime d'une victoire de défi, UNE LIGNE PAR VICTOIRE.
  // Cinq modèles de rémunération, cinq kinds — cf schema.
  kind:
    | "base"
    | "bonus"
    | "fixed"
    | "cpm"
    | "bonus_tier"
    | "clip"
    | "retainer"
    | "challenge";
  // Chantier C — plateforme du post pour les lineItems "base" (paiement PAR
  // POST : N bases/assignment, 1 par cible). Absent sur les bonus (1/assignment)
  // et les bases legacy (mono-compte).
  platform?: "TikTok" | "Instagram" | "YouTube";
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Période d'accrual "YYYY-MM" (UTC, déterministe — aligné sur todayKey/warmup). */
export function periodOf(now: number): string {
  const d = new Date(now);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}`;
}

// ─── Réplique serveur de lib/earnings.computeEarnings (règle A6) ──────────────
// DOIT rester identique à lib/earnings.ts (testé Vitest là-bas). Modèle :
//   base = basePerPost ; viewBonus = (viewBonusPer1k ?? 0) × vues / 1000 ;
//   bounty = somme des primes dont le seuil est atteint ; total = base+viewBonus+bounty.
export type RateSnapshot = {
  basePerPost: number;
  viewBonusPer1k?: number;
  bounties?: Array<{ thresholdViews: number; amount: number }>;
};

export interface Earnings {
  base: number;
  viewBonus: number;
  bounty: number;
  total: number;
}

export function computeEarnings(rate: RateSnapshot, views: number): Earnings {
  const v = Math.max(0, views);
  const base = round2(rate.basePerPost);
  const viewBonus = round2(((rate.viewBonusPer1k ?? 0) * v) / 1000);
  const bounty = round2(
    (rate.bounties ?? [])
      .filter((b) => v >= b.thresholdViews)
      .reduce((sum, b) => sum + b.amount, 0),
  );
  const rawTotal = round2(base + viewBonus + bounty);
  // Plafond 150 $/vidéo (RÉPLIQUE lib/earnings, A6) : cape le bonus (viewBonus
  // puis primes) → l'accrual (assignments.computeViewBonus = viewBonus+bounty)
  // est capé À LA SOURCE, base + bonus ≤ 150.
  if (rawTotal <= MAX_PAY_PER_VIDEO_EUR) {
    return { base, viewBonus, bounty, total: rawTotal };
  }
  const room = Math.max(0, round2(MAX_PAY_PER_VIDEO_EUR - base));
  const cappedViewBonus = Math.min(viewBonus, room);
  const cappedBounty = Math.min(bounty, round2(room - cappedViewBonus));
  return {
    base,
    viewBonus: cappedViewBonus,
    bounty: cappedBounty,
    total: round2(base + cappedViewBonus + cappedBounty),
  };
}

const recomputeTotal = (lineItems: LineItem[]): number =>
  round2(lineItems.reduce((s, li) => s + li.amount, 0));

/** Le paiement (projectId, creatorId, period) — créé s'il n'existe pas. */
export async function getOrCreatePayment(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    creatorId: Id<"creators">;
    period: string;
    now: number;
  },
): Promise<Doc<"payments">> {
  const existing = (
    await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect()
  ).find((p) => p.projectId === args.projectId && p.period === args.period);
  if (existing) return existing;
  const id = await ctx.db.insert("payments", {
    projectId: args.projectId,
    creatorId: args.creatorId,
    period: args.period,
    lineItems: [],
    totalDue: 0,
    status: "accruing",
    createdAt: args.now,
  });
  return (await ctx.db.get(id))!;
}

/**
 * Crédite la lineItem de BASE d'un assignment validé sur le paiement de la
 * période courante. IDEMPOTENT : si une lineItem "base" existe déjà pour cet
 * assignmentId, no-op (revalider ne crédite jamais deux fois).
 */
export async function accrueBaseLineItem(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    creatorId: Id<"creators">;
    assignmentId: Id<"assignments">;
    label: string;
    amount: number;
    now: number;
    // Chantier C — PAR POST : 1 base par (assignment, plateforme). Omis = base
    // unique legacy (idempotence par assignment seul).
    platform?: "TikTok" | "Instagram" | "YouTube";
  },
): Promise<void> {
  // Guard C — un assignment à pricingSnapshot relève du NOUVEAU modèle (paie
  // calculée à la lecture + gelée au paiement) : JAMAIS de lineItem legacy, même
  // si un futur appelant nous invoque par erreur (anti double paiement).
  const a = await ctx.db.get(args.assignmentId);
  if (a?.pricingSnapshot !== undefined) return;
  // Guard D — SYMÉTRIQUE de Guard C, pour le 3e modèle. Un assignment à
  // `clipRateSnapshot` est payé au CLIP (accrueClipLineItem) : lui écrire une
  // base legacy en plus produirait une ligne à 0 $ dans le grand livre, qui se
  // lirait « ce clip vaut zéro » à côté de sa vraie ligne, et que n'importe
  // quelle agrégation future ramasserait. Avec ce guard, les trois modèles sont
  // mutuellement exclusifs PAR CONSTRUCTION au lieu de se superposer.
  if (a?.clipRateSnapshot !== undefined) return;
  const period = periodOf(args.now);
  const payment = await getOrCreatePayment(ctx, {
    projectId: args.projectId,
    creatorId: args.creatorId,
    period,
    now: args.now,
  });
  // Idempotence PAR POST : une base déjà présente pour ce (assignment, plateforme)
  // → no-op. Plateformes distinctes → N bases distinctes (N × base).
  const alreadyBilled = payment.lineItems.some(
    (li) =>
      li.assignmentId === args.assignmentId &&
      li.kind === "base" &&
      li.platform === args.platform,
  );
  if (alreadyBilled) return;
  const lineItems: LineItem[] = [
    ...payment.lineItems,
    {
      assignmentId: args.assignmentId,
      label: args.label,
      amount: round2(args.amount),
      kind: "base",
      platform: args.platform,
    },
  ];
  await ctx.db.patch(payment._id, {
    lineItems,
    totalDue: recomputeTotal(lineItems),
  });
}

/**
 * Crédite la ligne d'un CLIP publié — le 3e modèle de rémunération.
 *
 * UNE LIGNE PAR CLIP, PAS PAR CIBLE. L'accrual partenaire est clé par
 * (assignment, plateforme) parce qu'il paie chaque post ; le clippeur est payé
 * au clip monté, qu'il sorte sur une ou deux plateformes. L'idempotence porte
 * donc sur `assignmentId` SEUL, et la ligne ne porte pas de `platform`.
 *
 * ⚠️ `MAX_PAY_PER_VIDEO_EUR` NE S'APPLIQUE PAS ICI, et c'est délibéré : ce
 * plafond protège d'une dérive du CPM (un montant calculé sur des vues). Le
 * tarif d'un clip est un montant unitaire fixe réglé par l'admin — le caper
 * amputerait silencieusement un tarif volontaire. Câblé explicitement plutôt que
 * laissé à l'héritage : le montant passe tel quel, quel qu'il soit.
 */
export async function accrueClipLineItem(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    creatorId: Id<"creators">;
    assignmentId: Id<"assignments">;
    label: string;
    amount: number;
    now: number;
  },
): Promise<void> {
  // Défense en profondeur : un assignment qui porterait AUSSI un pricingSnapshot
  // serait le chemin du double paiement clip + CPM. Impossible par construction
  // (assignScriptToRush n'en pose jamais, et une spec le prouve) — on refuse
  // quand même plutôt que de payer deux fois.
  const a = await ctx.db.get(args.assignmentId);
  if (a?.pricingSnapshot !== undefined) return;
  const payment = await getOrCreatePayment(ctx, {
    projectId: args.projectId,
    creatorId: args.creatorId,
    period: periodOf(args.now),
    now: args.now,
  });
  const already = payment.lineItems.some(
    (li) => li.assignmentId === args.assignmentId && li.kind === "clip",
  );
  if (already) return;
  const lineItems: LineItem[] = [
    ...payment.lineItems,
    {
      assignmentId: args.assignmentId,
      label: args.label,
      amount: round2(args.amount),
      kind: "clip",
    },
  ];
  await ctx.db.patch(payment._id, {
    lineItems,
    totalDue: recomputeTotal(lineItems),
  });
}

/**
 * FORFAIT DE CYCLE d'un talent — la ligne due pour UN cycle, ou `null`.
 *
 * SOURCE UNIQUE lue par l'écran (cycles « en cours ») ET par le gel
 * (`markCyclePaid`). Si les deux la calculaient séparément, l'admin finirait par
 * payer un montant différent de celui qu'il a lu — c'est exactement la
 * divergence que `convex/clipQuota.ts` a été créé pour empêcher côté quota.
 *
 * AUCUNE CONDITION DE LIVRAISON. Le cycle est dû parce qu'il a couru, pas parce
 * qu'un nombre de rushes a été atteint : l'écran affiche le compte de rushes à
 * côté du montant, et c'est l'admin qui décide de payer ou non. Un cycle sans
 * aucun rush porte donc quand même sa ligne — c'est précisément le cas où
 * l'admin doit voir « 0 rush » avant de poser son geste.
 */
export function retainerLineFor(
  creator: Doc<"creators">,
  cycleIndex: number,
): LineItem | null {
  if (resolveCreatorKind(creator.kind) !== "talent") return null;
  const montant = creator.cycleRetainer;
  if (typeof montant !== "number" || montant <= 0) return null;
  return {
    label: `Forfait — cycle ${cycleIndex + 1}`,
    detail: { cycleIndex: cycleIndex + 1 },
    amount: round2(montant),
    kind: "retainer",
  };
}

/**
 * Crédite/MET À JOUR la lineItem de BONUS d'un assignment. UN seul bonus par
 * assignment : recalcul = REMPLACEMENT de la ligne (jamais d'ajout). Attaché au
 * paiement portant déjà la base de cet assignment (base + bonus regroupés même
 * si le bonus est calculé un mois plus tard), sinon à la période courante.
 */
export async function upsertBonusLineItem(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    creatorId: Id<"creators">;
    assignmentId: Id<"assignments">;
    label: string;
    amount: number;
    now: number;
  },
): Promise<void> {
  // Guard C (cf accrueBaseLineItem) — pricingSnapshot ⇒ bonus dérivé du moteur.
  const a = await ctx.db.get(args.assignmentId);
  if (a?.pricingSnapshot !== undefined) return;
  const creatorPayments = (
    await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect()
  ).filter((p) => p.projectId === args.projectId);
  const payment =
    creatorPayments.find((p) =>
      p.lineItems.some(
        (li) => li.assignmentId === args.assignmentId && li.kind === "base",
      ),
    ) ??
    (await getOrCreatePayment(ctx, {
      projectId: args.projectId,
      creatorId: args.creatorId,
      period: periodOf(args.now),
      now: args.now,
    }));
  // Remplacement : on retire l'éventuel bonus existant de cet assignment.
  const others = payment.lineItems.filter(
    (li) => !(li.assignmentId === args.assignmentId && li.kind === "bonus"),
  );
  const lineItems: LineItem[] = [
    ...others,
    {
      assignmentId: args.assignmentId,
      label: args.label,
      amount: round2(args.amount),
      kind: "bonus",
    },
  ];
  await ctx.db.patch(payment._id, {
    lineItems,
    totalDue: recomputeTotal(lineItems),
  });
}

// ─── Modèle PRICING — gel au paiement + enrichissement à la lecture ──────────

/** assignmentIds déjà couverts par des lineItems LEGACY (Guard B — disjonction). */
function legacyAssignmentIds(p: Doc<"payments">): Set<string> {
  return new Set(
    p.lineItems
      .filter(
        (li) =>
          (li.kind === "base" || li.kind === "bonus") &&
          li.assignmentId !== undefined,
      )
      .map((li) => li.assignmentId as string),
  );
}

/**
 * Construit les lineItems PRICING GELÉES (fixed/cpm + bonus_tier cash) à partir
 * de la paie live de la période. Utilisé au paiement (markPaid) → fige le
 * montant pricing dans la row (lecture verbatim ensuite, jamais recalculée).
 * Le bonus de PALIER (cumul) est gelé en `bonus_tier` (DISJOINT du `bonus`
 * legacy par vidéo).
 */
async function frozenPricingLineItems(
  ctx: MutationCtx,
  p: Doc<"payments">,
): Promise<LineItem[]> {
  const breakdown = await computeLivePricingBreakdown(
    ctx,
    p.projectId,
    p.creatorId,
    p.period,
    legacyAssignmentIds(p),
  );
  const out: LineItem[] = [];
  for (const g of breakdown.perPricing) {
    if (g.fixed <= 0) continue;
    const rep = breakdown.perAssignment.find((a) => a.pricingId === g.pricingId);
    out.push({
      assignmentId: rep?.assignmentId as Id<"assignments"> | undefined,
      label: `Fixe — ${g.videoCount} vidéo${g.videoCount > 1 ? "s" : ""} publiée${g.videoCount > 1 ? "s" : ""}`,
      detail: { videoCount: g.videoCount },
      amount: g.fixed,
      kind: "fixed",
    });
  }
  for (const a of breakdown.perAssignment) {
    if (a.cpm > 0) {
      out.push({
        assignmentId: a.assignmentId as Id<"assignments">,
        label: `CPM — ${a.totalViews} vues`,
        detail: { views: a.totalViews },
        amount: a.cpm,
        kind: "cpm",
      });
    }
  }
  // Bonus de paliers CASH attribués à cette période (1 lineItem agrégée).
  if (breakdown.bonusTierCashTotal > 0) {
    out.push({
      label: "Bonus paliers (cumul de vues)",
      amount: breakdown.bonusTierCashTotal,
      kind: "bonus_tier",
    });
  }
  out.push(...challengeLineItems(breakdown));
  return out;
}

/**
 * Lignes de PRIME DE DÉFI — UNE PAR VICTOIRE, jamais une ligne agrégée.
 *
 * C'est l'écart délibéré avec `bonus_tier` juste au-dessus : sa ligne unique a
 * rendu le détail par palier irrécupérable, ce qui oblige `unlockIsFrozen` à
 * deviner par fenêtre si un palier est déjà payé. Ici la ligne nomme son défi,
 * si bien que le grand livre reste lisible et l'annulation vérifiable — la
 * garde de `cancelChallengeWin` peut s'appuyer sur un fait, pas sur un
 * intervalle.
 *
 * ⚠️ Le NOM est figé dans `detail.challengeName` : renommer un défi ensuite ne
 * réécrit pas une feuille de paie émise. `label` reste la phrase française de
 * repli (convention du dépôt), le libellé traduit se recompose autour de
 * `detail` dans la langue de la lectrice.
 */
function challengeLineItems(breakdown: PricingBreakdown): LineItem[] {
  return breakdown.challengeWins
    .filter((w) => w.montant > 0)
    .map((w) => ({
      label: `Prime de défi — ${w.challengeName}`,
      detail: { challengeName: w.challengeName },
      amount: w.montant,
      kind: "challenge" as const,
    }));
}

/** Breakdown pricing dérivé de lineItems GELÉES (période payée). */
function frozenBreakdownOf(p: Doc<"payments">): PricingBreakdown {
  const sumKind = (k: LineItem["kind"]) =>
    round2(
      p.lineItems.filter((li) => li.kind === k).reduce((s, li) => s + li.amount, 0),
    );
  const fixedTotal = sumKind("fixed");
  const cpmTotal = sumKind("cpm");
  // bonus_tier = bonus de PALIER cash (v2), DISJOINT du "bonus" legacy par vidéo.
  const bonusTierCashTotal = sumKind("bonus_tier");
  const challengeTotal = sumKind("challenge");
  // Gelé, mais PAS PERDU : chaque prime a sa propre ligne, on reconstitue donc
  // le détail à l'identique — contrairement aux paliers, dont la ligne agrégée
  // ne se décompose plus. `winId` n'est pas dans la ligne gelée (il n'y sert à
  // rien : la prime est versée, plus rien ne s'y rattache) ; le NOM, si, parce
  // que c'est lui qu'on lit.
  const challengeWins = p.lineItems
    .filter((li) => li.kind === "challenge")
    .map((li) => ({
      winId: "",
      challengeName: li.detail?.challengeName ?? li.label,
      montant: li.amount,
    }));
  return {
    fixedTotal,
    cpmTotal,
    bonusTierCashTotal,
    // Gelé : lineItem bonus_tier AGRÉGÉE → pas de détail par palier récupérable.
    // La vue retombe sur la ligne agrégée (bonusTierCashTotal).
    bonusTierCashUnlocks: [],
    challengeTotal,
    challengeWins,
    // Gelé : le statut de collecte du moment n'est pas dans les lignes payées,
    // et un cycle déjà payé ne se rediscute pas. 0 = « rien à signaler ICI »,
    // pas « tout était mesuré » — l'avertissement n'a de sens qu'AVANT de payer.
    unmeasuredPayablePosts: 0,
    total: round2(fixedTotal + cpmTotal + bonusTierCashTotal + challengeTotal),
    perPricing: [],
    perAssignment: [],
  };
}

// ─── Cycle J+30 GLISSANT — lecture re-fenêtrée par créateur ───────────────────

/**
 * Un CYCLE de paie d'un créateur (fenêtre de 30 j perso). Shape compatible avec
 * l'ancienne row (period/status/lineItems/totalDue/pricingBreakdown) + champs de
 * cycle. `key` = clé React (un cycle NON payé n'a pas de row Convex → pas de _id).
 */
export type CyclePayment = {
  key: string;
  cycleIndex: number;
  cycleStart: number;
  cycleEnd: number;
  /** Clé stable = date de début ISO "YYYY-MM-DD" (cf cyclePeriodKey). */
  period: string;
  status: "accruing" | "paid";
  paidAt: number | null;
  lineItems: LineItem[];
  totalDue: number;
  pricingBreakdown: PricingBreakdown;
  /**
   * Nombre de rushes DÉPOSÉS sur la fenêtre de ce cycle — talents uniquement,
   * `null` pour toute autre population.
   *
   * ⚠️ N'ENTRE DANS AUCUN CALCUL. Le forfait est dû parce que le cycle a couru ;
   * ce compte est là pour que l'admin voie « 12 rushes » — ou « 0 rush » — avant
   * de poser un geste qui reste le sien. Le lier au montant transformerait
   * `markCyclePaid` en règle automatique, ce que personne n'a demandé.
   */
  rushCount: number | null;
  /**
   * Cycle PAYÉ sous l'ANCIENNE règle : son montant a été gelé avant l'entrée en
   * vigueur du plafond J+30 (cf convex/payWindow.PAY_WINDOW_EFFECTIVE_AT), et il
   * comporte au moins une ligne assise sur des vues.
   *
   * Sert UNIQUEMENT à afficher une mention datée. Sans elle, une créatrice qui
   * compare deux cycles voit deux logiques de calcul et rien ne le lui dit —
   * exactement le genre d'écart silencieux que ce chantier existe pour éviter.
   * `false` sur tout cycle en cours, et sur un cycle payé que le plafond
   * n'aurait de toute façon pas déplacé.
   */
  computedBeforePayWindow: boolean;
};

/** LineItems GELÉES (fixed/cpm + bonus_tier cash) construites depuis un breakdown. */
function frozenLineItemsFromBreakdown(b: PricingBreakdown): LineItem[] {
  const out: LineItem[] = [];
  for (const g of b.perPricing) {
    if (g.fixed <= 0) continue;
    out.push({
      // Représentant pris DANS le groupe. Chercher par pricingId seul renvoyait
      // le même assignment pour deux groupes distincts depuis qu'un pricing
      // édité en place peut laisser deux générations de snapshot sous un id
      // unique — la ligne « Fixe » de l'un aurait pointé une vidéo de l'autre.
      assignmentId: g.firstAssignmentId as Id<"assignments"> | undefined,
      label: `Fixe — ${g.videoCount} vidéo${g.videoCount > 1 ? "s" : ""} publiée${g.videoCount > 1 ? "s" : ""}`,
      detail: { videoCount: g.videoCount },
      amount: g.fixed,
      kind: "fixed",
    });
  }
  for (const a of b.perAssignment) {
    if (a.cpm > 0) {
      out.push({
        assignmentId: a.assignmentId as Id<"assignments">,
        label: `CPM — ${a.totalViews} vues`,
        detail: { views: a.totalViews },
        amount: a.cpm,
        kind: "cpm",
      });
    }
  }
  if (b.bonusTierCashTotal > 0) {
    out.push({
      label: "Bonus paliers (cumul de vues)",
      amount: b.bonusTierCashTotal,
      kind: "bonus_tier",
    });
  }
  out.push(...challengeLineItems(b));
  return out;
}

/**
 * Paiements d'un créateur RE-FENÊTRÉS par ses cycles J+30 (ancre firstPostAt).
 * TOUS ses gains (existants accumulés + futurs) sont regroupés par sa fenêtre de
 * 30 j perso — MÊME moteur de montant (computeMonthlyPayout, cap 150$/vidéo) : seul
 * le REGROUPEMENT change → le TOTAL dû est INVARIANT. Cycles du plus récent au plus
 * ancien ; on garde ceux avec gains + TOUJOURS le cycle courant (« prochaine paie »
 * = son cycleEnd). firstPostAt absent (aucun post) → aucun cycle (liste vide).
 */
// EXPORTÉ pour convex/notifications.ts (section « cycles dus » du digest
// quotidien) : le digest doit compter EXACTEMENT les mêmes cycles que l'écran
// Paiements, donc il lit la même source plutôt qu'un second calcul.
export async function cyclePaymentsForCreator(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  now: number,
): Promise<CyclePayment[]> {
  const creator = await ctx.db.get(creatorId);
  // Ancre = payAnchorAt (talent) ?? firstPostAt (partenaire/clippeur). Pour un
  // partenaire, l'expression vaut exactement firstPostAt — cf payAnchorOf.
  const firstPostAt = creator ? payAnchorOf(creator) : undefined;
  if (!creator || firstPostAt === undefined) return [];
  const currentCycle = calcCycle(firstPostAt, now).cycleIndex;

  const rows = (
    await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter((p) => p.projectId === projectId);
  // Rows GELÉES (payées) indexées par clé de cycle (date de début ISO).
  const paidByPeriod = new Map(
    rows.filter((p) => p.status === "paid").map((p) => [p.period, p]),
  );

  // lineItems LEGACY (modèle RepackIt, base/bonus) des rows NON payées, re-fenêtrés
  // par le cycle de PUBLI de leur assignment (assignmentPublishedAt → cycle).
  const assignments = (
    await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect()
  ).filter((a) => a.projectId === projectId);
  const cycleOfAssignment = new Map(
    assignments.map((a) => [
      a._id,
      cycleIndexOf(firstPostAt, assignmentPublishedAt(a)),
    ]),
  );
  // Rushes du talent, chargés UNE fois pour tous ses cycles (index by_talent).
  // Population non-talent → aucune lecture supplémentaire.
  const estTalent = resolveCreatorKind(creator.kind) === "talent";
  const rushDates = estTalent
    ? (
        await ctx.db
          .query("rushes")
          .withIndex("by_talent", (q) => q.eq("talentId", creatorId))
          .collect()
      )
        .filter((r) => r.projectId === projectId)
        .map((r) => r.depositedAt)
    : [];

  const legacyByCycle = new Map<number, LineItem[]>();
  for (const p of rows) {
    if (p.status === "paid") continue;
    for (const li of p.lineItems) {
      const cyc = li.assignmentId
        ? cycleOfAssignment.get(li.assignmentId)
        : undefined;
      const k = cyc ?? currentCycle; // 0 est valide (nullish uniquement)
      const arr = legacyByCycle.get(k);
      if (arr) arr.push(li);
      else legacyByCycle.set(k, [li]);
    }
  }

  const out: CyclePayment[] = [];
  for (let k = currentCycle; k >= 0; k--) {
    const w = cycleWindow(firstPostAt, k);
    const period = cyclePeriodKey(w.cycleStart);
    const paid = paidByPeriod.get(period);
    if (paid) {
      out.push({
        key: `paid:${paid._id}`,
        cycleIndex: k,
        cycleStart: w.cycleStart,
        cycleEnd: w.cycleEnd,
        period,
        status: "paid",
        paidAt: paid.paidAt ?? null,
        lineItems: paid.lineItems,
        totalDue: paid.totalDue,
        pricingBreakdown: frozenBreakdownOf(paid),
        rushCount: estTalent
          ? rushDates.filter((d) => d >= w.cycleStart && d < w.cycleEnd).length
          : null,
        computedBeforePayWindow: paidBeforePayWindow({
          paidAt: paid.paidAt,
          lineItemKinds: paid.lineItems.map((li) => li.kind),
        }),
      });
      continue;
    }
    const legacyItems = legacyByCycle.get(k) ?? [];
    const legacyIds = new Set(
      legacyItems
        .filter((li) => li.assignmentId !== undefined)
        .map((li) => li.assignmentId as string),
    );
    const breakdown = await computeCyclePricingBreakdown(
      ctx,
      projectId,
      creatorId,
      firstPostAt,
      k,
      legacyIds,
    );
    // Forfait du talent — MÊME source que le gel (retainerLineFor) : l'admin ne
    // peut pas lire un montant et en payer un autre. `null` pour toute autre
    // population, donc chemin partenaire strictement inchangé.
    const retainer = retainerLineFor(creator, k);
    const items = retainer ? [...legacyItems, retainer] : legacyItems;
    const legacyTotal = recomputeTotal(items);
    out.push({
      key: `${creatorId}:${k}`,
      cycleIndex: k,
      cycleStart: w.cycleStart,
      cycleEnd: w.cycleEnd,
      period,
      status: "accruing",
      paidAt: null,
      lineItems: items,
      totalDue: round2(legacyTotal + breakdown.total),
      pricingBreakdown: breakdown,
      rushCount: estTalent
        ? rushDates.filter((d) => d >= w.cycleStart && d < w.cycleEnd).length
        : null,
      // Cycle EN COURS : il se calcule live, donc sous la règle actuelle.
      computedBeforePayWindow: false,
    });
  }
  return out.filter(
    (c) =>
      c.cycleIndex === currentCycle || c.totalDue > 0 || c.lineItems.length > 0,
  );
}

// ─── Queries (P9) ────────────────────────────────────────────────────────────

/**
 * Paiements du projet (tous créateurs), re-fenêtrés par cycle J+30 perso + infos
 * créateur (nom/email/méthode, export CSV). Triés cycle (date de début) desc.
 * NB : n'itère que les créateurs VIVANTS (une fiche supprimée avec des cycles
 * payés — inexistant tant que rien n'est versé — ne remonterait pas ici).
 */
async function collectProjectPaymentRows(
  ctx: QueryCtx,
  projectId: Id<"projects">,
) {
  const creators = await ctx.db
    .query("creators")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const now = Date.now();
  const liveIds = new Set(creators.map((c) => c._id));
  const out = [];
  for (const c of creators) {
    const cycles = await cyclePaymentsForCreator(
      ctx,
      projectId,
      c._id,
      now,
    );
    for (const cy of cycles) {
      out.push({
        ...cy,
        creatorId: c._id,
        creatorName: c.name,
        creatorEmail: c.email,
        creatorPaymentMethod: c.paymentMethod ?? null,
        creatorPaymentDetails: c.paymentDetails ?? null,
      });
    }
  }
  // Approche C — paiements ORPHELINS (fiche créateur supprimée : plus de
  // firstPostAt donc AUCUN cycle calculé) : on surface la row STOCKÉE telle
  // quelle (snapshot financier figé), lisible via creatorNameSnapshot. Sans ça,
  // l'historique d'un créateur supprimé disparaîtrait de la vue admin.
  const orphanRows = (
    await ctx.db
      .query("payments")
      .withIndex("by_project_period", (q) => q.eq("projectId", projectId))
      .collect()
  ).filter((p) => !liveIds.has(p.creatorId));
  for (const p of orphanRows) {
    out.push({
      // Fenêtre synthétique (ancre perdue avec la fiche) : juste pour l'affichage.
      key: `orphan:${p._id}`,
      cycleIndex: 0,
      cycleStart: p.createdAt,
      cycleEnd: p.createdAt + CYCLE_LENGTH_MS,
      period: p.period,
      status: (p.status === "paid" ? "paid" : "accruing") as
        | "paid"
        | "accruing",
      paidAt: p.paidAt ?? null,
      lineItems: p.lineItems,
      totalDue: p.totalDue,
      pricingBreakdown: frozenBreakdownOf(p),
      // Row ORPHELINE (fiche supprimée) : on ne sait plus si c'était un talent,
      // et ses rushes ont disparu avec la fiche. `null` = rien à afficher.
      rushCount: null as number | null,
      creatorId: p.creatorId,
      creatorName: p.creatorNameSnapshot ?? "—",
      creatorEmail: "",
      creatorPaymentMethod: null as
        | "sepa"
        | "paypal"
        | "usdt"
        | "autre"
        | null,
      creatorPaymentDetails: null as string | null,
    });
  }
  return out.sort(
    (a, b) =>
      b.cycleStart - a.cycleStart ||
      a.creatorName.localeCompare(b.creatorName, "fr"),
  );
}

export const listPayments = permissionQuery("payments.manage")({
  args: {},
  handler: async (ctx) => collectProjectPaymentRows(ctx, ctx.projectId),
});

/**
 * TOTAL DÛ du projet — la carte 3 du dashboard, et RIEN d'autre.
 *
 * POURQUOI CETTE QUERY EXISTE. Le dashboard calculait ce total côté client, en
 * lisant `listPayments` : le navigateur recevait donc l'INTÉGRALITÉ des cycles
 * de paie (montants par créatrice, lignes de paie, ventilation du barème et
 * jusqu'aux coordonnées bancaires servies pour l'export CSV) pour n'afficher
 * qu'un nombre. Masquer la carte n'y changeait rien : la donnée était déjà
 * partie. Ici, seul le nombre traverse le réseau.
 *
 * MÊME ENSEMBLE, MÊME ORDRE, MÊME ARITHMÉTIQUE que la page Paiements : les deux
 * passent par `collectProjectPaymentRows`, la somme est faite sur le tableau
 * DÉJÀ TRIÉ et sans arrondi — exactement le `reduce` que faisait le client.
 * Un total de dashboard qui diverge du total de la page Paiements serait pire
 * que pas de total du tout, et l'addition de flottants n'est pas commutative.
 */
export const getDueTotal = permissionQuery("payments.manage")({
  args: {},
  handler: async (ctx) => {
    const rows = await collectProjectPaymentRows(ctx, ctx.projectId);
    return {
      dueTotal: rows
        .filter((p) => p.status !== "paid")
        .reduce((sum, p) => sum + p.totalDue, 0),
    };
  },
});

export const getMyPayments = creatorQuery({
  args: {},
  handler: async (ctx) =>
    cyclePaymentsForCreator(ctx, ctx.projectId, ctx.creatorId, Date.now()),
});

/** ADMIN view-as — cycles/gains du créateur ciblé (lecture seule, scopé projet). */
export const getPaymentsAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) =>
    cyclePaymentsForCreator(ctx, ctx.projectId, ctx.creatorId, Date.now()),
});

/**
 * Classement d'un projet sur les gains du cycle J+30 EN COURS de chaque créateur.
 * Logique PARTAGÉE entre l'adminQuery `leaderboard` (vue admin) et la creatorQuery
 * `projectLeaderboard` (portail créateur) — 0 duplication. Métrique = `totalDue`
 * du cycle courant (fixe/CPM + bonus paliers cash = le vrai « à payer »). Réutilise
 * `cyclePaymentsForCreator` (le cycle courant y est TOUJOURS présent, même à 0 $)
 * et n'en garde QUE ce cycle. Créateur sans firstPostAt (aucun post) → pas de cycle
 * → exclu. Créateurs vivants uniquement (pas d'orphelins). Trié gains desc,
 * départage par nom → `rank` (1-based). `isMe` marque la fiche de l'appelant
 * (`meCreatorId` absent côté admin → tout false). Cycles désynchronisés (chacun
 * ancré sur son 1er post) → chaque ligne porte SA fenêtre (cycleStart/cycleEnd).
 */
async function computeProjectLeaderboard(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  now: number,
  meCreatorId?: Id<"creators">,
): Promise<
  Array<{
    creatorId: Id<"creators">;
    name: string;
    rank: number;
    totalDue: number;
    cycleStart: number;
    cycleEnd: number;
    isMe: boolean;
  }>
> {
  const creators = await ctx.db
    .query("creators")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const rows: Array<{
    creatorId: Id<"creators">;
    name: string;
    totalDue: number;
    cycleStart: number;
    cycleEnd: number;
  }> = [];
  for (const c of creators) {
    // CLASSEMENT RÉSERVÉ AUX PARTENAIRES. Un talent en est exclu de fait (il ne
    // publie jamais, donc pas de firstPostAt) mais un CLIPPEUR publie, et il y
    // apparaîtrait au milieu des partenaires. Or un classement compare des
    // performances : le clippeur monte les rushes d'un talent, il n'a pas produit
    // ce qu'il publie, et son modèle de paie (montant fixe par clip) n'a rien à
    // voir avec des gains de cycle au CPM. Comparer les deux ne mesure rien.
    // Un classement SÉPARÉ par population aurait peut-être du sens un jour ; il
    // n'est pas construit ici, et l'écrire coûterait moins que de laisser croire
    // que celui-ci le remplace.
    if (resolveCreatorKind(c.kind) !== "partner") continue;
    if (c.firstPostAt === undefined) continue; // aucun post → pas de cycle
    const currentIndex = calcCycle(c.firstPostAt, now).cycleIndex;
    const cycles = await cyclePaymentsForCreator(ctx, projectId, c._id, now);
    const current = cycles.find((cy) => cy.cycleIndex === currentIndex);
    if (!current) continue; // garde défensive (toujours présent en théorie)
    rows.push({
      creatorId: c._id,
      name: c.name,
      totalDue: current.totalDue,
      cycleStart: current.cycleStart,
      cycleEnd: current.cycleEnd,
    });
  }
  rows.sort(
    (a, b) => b.totalDue - a.totalDue || a.name.localeCompare(b.name, "fr"),
  );
  return rows.map((r, i) => ({
    ...r,
    rank: i + 1,
    isMe: meCreatorId !== undefined && r.creatorId === meCreatorId,
  }));
}

/** Leaderboard ADMIN du projet (cf computeProjectLeaderboard). isMe tout false. */
export const leaderboard = permissionQuery("payments.manage")({
  args: {},
  handler: async (ctx) =>
    computeProjectLeaderboard(ctx, ctx.projectId, Date.now()),
});

/**
 * Leaderboard PORTAIL créateur — MÊME classement, exposé à la créatrice
 * (transparence assumée : gains de toutes visibles). Le wrapper `creatorQuery`
 * VÉRIFIE que l'appelant est bien créateur de `projectId` (requireCreator → rejet
 * cross-projet, aucune fuite d'un projet où elle n'est pas) et injecte
 * `ctx.creatorId` → `isMe` marque sa propre ligne. Même helper que la vue admin.
 */
export const projectLeaderboard = creatorQuery({
  args: {},
  handler: async (ctx) =>
    computeProjectLeaderboard(ctx, ctx.projectId, Date.now(), ctx.creatorId),
});

// ─── Mutations admin — marquer payé (idempotent) ─────────────────────────────

/**
 * Marque UN CYCLE J+30 d'un créateur comme payé (modèle glissant). GÈLE le
 * breakdown du cycle (fixe/CPM + bonus paliers cash) dans une row keyée par
 * (créateur, cyclePeriodKey) → lecture verbatim ensuite. On passe `cycleIndex`
 * (pas la clé date, lossy si firstPostAt n'est pas à minuit) → la fenêtre + la
 * clé sont recalculées serveur. Idempotent : un cycle déjà payé → no-op.
 */
export const markCyclePaid = permissionMutation("payments.manage")({
  args: { creatorId: v.id("creators"), cycleIndex: v.number() },
  handler: async (ctx, { creatorId, cycleIndex }) => {
    const creator = await ctx.db.get(creatorId);
    if (!creator || creator.projectId !== ctx.projectId) {
      throw err(ERR.CREATOR_NOT_FOUND, "Créateur introuvable.");
    }
    // MÊME ancre que l'écran. Sans cette bascule, un talent s'affichait payable
    // et `markCyclePaid` jetait « n'a pas encore publié » — payable à l'écran,
    // impayable en pratique.
    const anchor = payAnchorOf(creator);
    if (anchor === undefined) {
      throw err(ERR.NO_PAY_CYCLE, "Aucun cycle : ce créateur n'a ni publication ni date d'activation.");
    }
    if (!Number.isInteger(cycleIndex) || cycleIndex < 0) {
      throw err(ERR.CYCLE_INVALID, "Cycle invalide.");
    }
    const w = cycleWindow(anchor, cycleIndex);
    const period = cyclePeriodKey(w.cycleStart);
    const rows = (
      await ctx.db
        .query("payments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).filter((p) => p.projectId === ctx.projectId);
    const existingRows = rows.filter((p) => p.period === period);
    if (existingRows.some((p) => p.status === "paid")) {
      return { ok: true, alreadyPaid: true };
    }
    // Matérialise les paliers franchis AVANT le gel (Guard A intra-cycle).
    await syncBonusUnlocks(ctx, ctx.projectId, creatorId);
    const breakdown = await computeCyclePricingBreakdown(
      ctx,
      ctx.projectId,
      creatorId,
      anchor,
      cycleIndex,
      new Set(),
    );
    // lineItems LEGACY (modèle RepackIt) appartenant à CE cycle (via le cycle de
    // publi de leur assignment) : CAPTURÉES dans la row gelée + RETIRÉES de leur
    // row source (accruing) → pas de double compte, le total du cycle est exact.
    const assignments = (
      await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    ).filter((a) => a.projectId === ctx.projectId);
    const cycleOfAssignment = new Map(
      assignments.map((a) => [
        a._id,
        cycleIndexOf(anchor, assignmentPublishedAt(a)),
      ]),
    );
    const legacyOfCycle: LineItem[] = [];
    for (const r of rows) {
      if (r.status === "paid" || r.period === period) continue;
      const keep: LineItem[] = [];
      let moved = false;
      for (const li of r.lineItems) {
        const cyc =
          li.assignmentId !== undefined
            ? cycleOfAssignment.get(li.assignmentId)
            : undefined;
        if (li.assignmentId !== undefined && cyc === cycleIndex) {
          legacyOfCycle.push(li);
          moved = true;
        } else {
          keep.push(li);
        }
      }
      if (moved) {
        await ctx.db.patch(r._id, {
          lineItems: keep,
          totalDue: recomputeTotal(keep),
        });
      }
    }
    const retainer = retainerLineFor(creator, cycleIndex);
    const frozen = [
      ...legacyOfCycle,
      ...frozenLineItemsFromBreakdown(breakdown),
      ...(retainer ? [retainer] : []),
    ];
    const now = Date.now();
    const target = existingRows[0];
    let paidTotal: number;
    if (target) {
      const lineItems = [...target.lineItems, ...frozen];
      paidTotal = recomputeTotal(lineItems);
      await ctx.db.patch(target._id, {
        status: "paid",
        paidAt: now,
        lineItems,
        totalDue: paidTotal,
      });
    } else {
      paidTotal = recomputeTotal(frozen);
      await ctx.db.insert("payments", {
        projectId: ctx.projectId,
        creatorId,
        period,
        lineItems: frozen,
        totalDue: paidTotal,
        status: "paid",
        paidAt: now,
        createdAt: now,
      });
    }
    // Notification créateur — hors transaction. En marquage EN MASSE (chantier A),
    // chaque cycle planifie SON action : envois parallèles, la boucle n'est ni
    // ralentie ni mise en échec par Resend. Non atteint sur le retour idempotent
    // « déjà payé » plus haut → jamais de second mail pour un même cycle.
    await ctx.scheduler.runAfter(0, internal.emails.sendPaymentPaid, {
      creatorId,
      amount: paidTotal,
      cycleStart: w.cycleStart,
      cycleEnd: w.cycleEnd,
    });
    return { ok: true, alreadyPaid: false };
  },
});

/** Marque UN paiement comme payé. Idempotent : re-marquer ne change pas paidAt. */
export const markPaymentPaid = permissionMutation("payments.manage")({
  args: { id: v.id("payments") },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id);
    if (!p || p.projectId !== ctx.projectId) {
      throw new ConvexError("Paiement introuvable.");
    }
    if (p.status === "paid") return { ok: true, alreadyPaid: true };
    // Matérialise les paliers franchis AVANT le gel (Guard A intra-période :
    // un palier juste franchi de cette période est attribué puis gelé).
    await syncBonusUnlocks(ctx, p.projectId, p.creatorId);
    // GEL au paiement : fige le montant PRICING (fixe/CPM + bonus paliers cash)
    // dans la row → lecture verbatim ensuite, jamais recalculée.
    const frozen = await frozenPricingLineItems(ctx, p);
    const lineItems = [...p.lineItems, ...frozen];
    await ctx.db.patch(id, {
      status: "paid",
      paidAt: Date.now(),
      lineItems,
      totalDue: recomputeTotal(lineItems),
    });
    return { ok: true, alreadyPaid: false };
  },
});

/**
 * Marque TOUTE une période comme payée (masse). Idempotent : saute les
 * paiements déjà payés (leur paidAt est préservé). Retourne le nb basculé.
 */
export const markPeriodPaid = permissionMutation("payments.manage")({
  args: { period: v.string() },
  handler: async (ctx, { period }) => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_project_period", (q) =>
        q.eq("projectId", ctx.projectId).eq("period", period),
      )
      .collect();
    const now = Date.now();
    let marked = 0;
    for (const p of payments) {
      if (p.status === "paid") continue;
      await syncBonusUnlocks(ctx, p.projectId, p.creatorId);
      const frozen = await frozenPricingLineItems(ctx, p);
      const lineItems = [...p.lineItems, ...frozen];
      await ctx.db.patch(p._id, {
        status: "paid",
        paidAt: now,
        lineItems,
        totalDue: recomputeTotal(lineItems),
      });
      marked++;
    }
    return { marked };
  },
});

// ─── Backfill one-shot — ancre firstPostAt (cycle J+30) ───────────────────────

/**
 * BACKFILL idempotent de creators.firstPostAt : pour chaque créateur ayant ≥1
 * publication published/paid mais PAS encore de firstPostAt, pose firstPostAt =
 * date de sa 1re publication (min assignmentPublishedAt). FIGÉ ensuite (jamais
 * réécrit — un créateur avec firstPostAt est SKIPPÉ). Ne touche AUCUNE paie (rien
 * n'est versé) : ne fait que poser l'ancre du cycle. Créateur sans post publié →
 * skippé (pas de cycle, pas de date fantôme).
 *
 * Runnable post-merge : `npx convex run payments:backfillFirstPostAt` (dev puis --prod).
 */
export const backfillFirstPostAt = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ updated: number; skipped: number }> => {
    const creators = await ctx.db.query("creators").collect();
    let updated = 0;
    let skipped = 0;
    for (const creator of creators) {
      if (creator.firstPostAt !== undefined) {
        skipped++; // ancre déjà posée → figée, jamais réécrite
        continue;
      }
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
        .collect();
      const published = assignments.filter(
        (a) => a.status === "published" || a.status === "paid",
      );
      if (published.length === 0) {
        skipped++; // aucun post publié → pas d'ancre (pas de cycle)
        continue;
      }
      const firstPostAt = Math.min(
        ...published.map((a) => assignmentPublishedAt(a)),
      );
      await ctx.db.patch(creator._id, { firstPostAt });
      updated++;
    }
    return { updated, skipped };
  },
});

// ─── Cleanup e2e (gated E2E_SECRET) ──────────────────────────────────────────

/** Supprime les paiements liés à un créateur de test ([E2E_TEST] / e2e-creator). */
export const cleanupTestPayments = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("payments").collect();
    let deleted = 0;
    for (const p of all) {
      const creator = await ctx.db.get(p.creatorId);
      const isTest =
        creator !== null &&
        (creator.name.startsWith("[E2E_TEST]") ||
          creator.email.includes("e2e-creator"));
      if (creator === null || isTest) {
        await ctx.db.delete(p._id);
        deleted++;
      }
    }
    return { deleted };
  },
});
