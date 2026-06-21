import { adminQuery } from "./functions";
import { v } from "convex/values";
import {
  gatherCampaignViews,
  aggregateByTier,
  aggregateByBrick,
  aggregateByCombo,
  campaignMedianOf,
  median,
  type CampaignViews,
} from "./scriptAnalytics";

/**
 * S4 — Query de DÉCISION du bulk testing. campaignDecisions COMPOSE sur les
 * agrégats S3 (scriptAnalytics) : une seule passe gatherCampaignViews, puis
 * réutilise aggregateByTier / aggregateByBrick / aggregateByCombo (NE recalcule
 * PAS les médianes from scratch) et en TIRE des verdicts par dimension + la
 * liste des signaux forts.
 *
 * 100 % adminQuery → le créateur n'a AUCUN accès aux décisions/verdicts/signaux
 * (isolation, cf rappel S2/S3 sur la fuite de la mécanique combinatoire).
 *
 * S4 RECOMMANDE, il n'agit pas : « à pousser »/« à couper » sont des recos que
 * l'admin suit en assignant ; le système ne ré-assigne JAMAIS automatiquement
 * (hors scope, garder l'humain dans la boucle).
 *
 * ⚠️ A6 — convex/ ne peut pas importer lib/. La LOGIQUE de décision ci-dessous
 * est une RÉPLIQUE de lib/scriptDecision.ts (où vivent les tests Vitest). Toute
 * évolution des seuils/règles doit être faite des DEUX côtés.
 */

// ─── Réplique seuils + logique (lib/scriptDecision.ts) ───────────────────────
const DECISION_THRESHOLD = 50; // = JUGEABLE_THRESHOLD (scriptStats)
const PUSH_DELTA = 0.25;
const CUT_DELTA = -0.25;
const MIN_JUDGEABLE_PEERS = 1;
const STRONG_SIGNAL_MULTIPLE = 2;
const MIN_SIGNAL_POSTS = 3;

type BrickVerdict = "en_test" | "a_pousser" | "a_couper" | "neutre";

interface BrickInput {
  key: string;
  label: string;
  kind: string;
  postCount: number;
  viewsMedian: number | null;
}
export interface BrickDecision {
  key: string;
  label: string;
  kind: string;
  verdict: BrickVerdict;
  reason: string;
  postCount: number;
  viewsMedian: number | null;
  deltaVsPeerMedian: number | null;
  peerMedian: number | null;
}
interface SignalInput {
  key: string;
  label: string;
  kind: string;
  postCount: number;
  viewsMedian: number | null;
}
export interface StrongSignal {
  key: string;
  label: string;
  kind: string;
  postCount: number;
  viewsMedian: number;
  multipleOfGlobal: number;
  reason: string;
}

function isJudgeable(b: BrickInput): boolean {
  return b.postCount >= DECISION_THRESHOLD && b.viewsMedian !== null;
}
function pct(fraction: number): string {
  const sign = fraction >= 0 ? "+" : "−";
  return `${sign}${Math.round(Math.abs(fraction) * 100)} %`;
}

function decideBrick(
  brick: BrickInput,
  peersOfSameKind: readonly BrickInput[],
): BrickDecision {
  const base = {
    key: brick.key,
    label: brick.label,
    kind: brick.kind,
    postCount: brick.postCount,
    viewsMedian: brick.viewsMedian,
    deltaVsPeerMedian: null as number | null,
    peerMedian: null as number | null,
  };

  if (!isJudgeable(brick)) {
    return {
      ...base,
      verdict: "en_test",
      reason: `${brick.postCount}/${DECISION_THRESHOLD} posts — pas encore jugeable`,
    };
  }

  const judgeablePeers = peersOfSameKind.filter(
    (p) => p.key !== brick.key && isJudgeable(p),
  );
  if (judgeablePeers.length < MIN_JUDGEABLE_PEERS) {
    return {
      ...base,
      verdict: "en_test",
      reason: `${brick.postCount} posts mais pas assez de pairs jugeables pour comparer`,
    };
  }

  const peerMedian = median(
    judgeablePeers.map((p) => p.viewsMedian as number),
  ) as number;
  const brickMedian = brick.viewsMedian as number;

  let delta: number;
  if (peerMedian === 0) {
    delta = brickMedian > 0 ? Infinity : 0;
  } else {
    delta = (brickMedian - peerMedian) / peerMedian;
  }

  let verdict: BrickVerdict;
  if (delta >= PUSH_DELTA) verdict = "a_pousser";
  else if (delta <= CUT_DELTA) verdict = "a_couper";
  else verdict = "neutre";

  const deltaStr = Number.isFinite(delta) ? pct(delta) : "+∞";
  const reason =
    verdict === "a_pousser"
      ? `Médiane ${deltaStr} vs pairs, sur ${brick.postCount} posts`
      : verdict === "a_couper"
        ? `Médiane ${deltaStr} sous les pairs, sur ${brick.postCount} posts`
        : `Dans la moyenne des pairs (${deltaStr}), sur ${brick.postCount} posts`;

  return {
    ...base,
    verdict,
    reason,
    deltaVsPeerMedian: Number.isFinite(delta) ? delta : null,
    peerMedian,
  };
}

function decideKind(bricks: readonly BrickInput[]): BrickDecision[] {
  return bricks.map((b) => decideBrick(b, bricks));
}

function detectStrongSignals(
  items: readonly SignalInput[],
  globalMedian: number | null,
): StrongSignal[] {
  if (globalMedian === null || globalMedian <= 0) return [];
  const out: StrongSignal[] = [];
  for (const it of items) {
    if (it.viewsMedian === null) continue;
    if (it.postCount < MIN_SIGNAL_POSTS || it.postCount >= DECISION_THRESHOLD)
      continue;
    const ratio = it.viewsMedian / globalMedian;
    if (ratio < STRONG_SIGNAL_MULTIPLE) continue;
    out.push({
      key: it.key,
      label: it.label,
      kind: it.kind,
      postCount: it.postCount,
      viewsMedian: it.viewsMedian,
      multipleOfGlobal: ratio,
      reason: `Médiane ${ratio.toFixed(1)}× la campagne sur ${it.postCount} posts — à confirmer manuellement`,
    });
  }
  return out.sort((a, b) => b.multipleOfGlobal - a.multipleOfGlobal);
}

// ─── Query ───────────────────────────────────────────────────────────────────

const WINDOW = v.union(
  v.literal("j3"),
  v.literal("j7"),
  v.literal("j14"),
  v.literal("j30"),
);

export type DecisionDimensionKind = "tier" | "flux" | "cta";

export interface DecisionDimension {
  kind: DecisionDimensionKind;
  decisions: BrickDecision[];
}

export interface CampaignDecisions {
  found: boolean;
  /** Verdicts par dimension, ordre tier → corps → flux → cta. */
  dimensions: DecisionDimension[];
  /** Signaux forts (combos/briques sous le seuil mais explosifs) à valider à la main. */
  strongSignals: StrongSignal[];
  /** Nb total de publications de script mesurées à la fenêtre (état vide). */
  totalPosts: number;
  /** Au moins une dimension a une brique jugeable (≥ seuil) → on peut recommander. */
  anyJudgeable: boolean;
}

/** Construit la liste decision-engine pour les briques d'un kind donné. */
function brickInputs(
  rows: { brickId: string; label: string; postCount: number; viewsMedian: number | null }[],
  kind: DecisionDimensionKind,
): BrickInput[] {
  return rows.map((r) => ({
    key: r.brickId,
    label: r.label,
    kind,
    postCount: r.postCount,
    viewsMedian: r.viewsMedian,
  }));
}

function buildDecisions(views: CampaignViews): CampaignDecisions {
  const tiers = aggregateByTier(views);
  const bricks = aggregateByBrick(views);
  const combos = aggregateByCombo(views);
  const globalMedian = campaignMedianOf(views);

  // Dimension TIER : on juge les 3 tiers de hook les uns contre les autres
  // (un tier accumule 50 posts bien plus vite qu'une brique de hook précise).
  const tierInputs: BrickInput[] = tiers.map((t) => ({
    key: t.tier,
    label: `Tier ${t.tier}`,
    kind: "tier",
    postCount: t.postCount,
    viewsMedian: t.viewsMedian,
  }));

  // Refonte 3 briques : dimensions tier / flux / cta (la dimension corps a
  // disparu — les ex-corps sont des hooks, jugés via la dimension tier).
  const flux = bricks.filter((b) => b.kind === "flux");
  const cta = bricks.filter((b) => b.kind === "cta");

  const dimensions: DecisionDimension[] = [
    { kind: "tier", decisions: decideKind(tierInputs) },
    { kind: "flux", decisions: decideKind(brickInputs(flux, "flux")) },
    { kind: "cta", decisions: decideKind(brickInputs(cta, "cta")) },
  ];

  // SIGNAUX FORTS — combos précis ET briques/tiers : tout ce qui explose le
  // seuil haut sous 50 posts. Le combo donne le grain le plus fin.
  const comboSignals: SignalInput[] = combos.map((c) => ({
    key: c.comboKey,
    label: `Tier ${c.tier ?? "?"} · ${c.fluxLabel} · ${c.ctaLabel}`,
    kind: "combo",
    postCount: c.postCount,
    viewsMedian: c.viewsMedian,
  }));
  const tierSignals: SignalInput[] = tiers.map((t) => ({
    key: `tier:${t.tier}`,
    label: `Tier ${t.tier}`,
    kind: "tier",
    postCount: t.postCount,
    viewsMedian: t.viewsMedian,
  }));
  const brickSignals: SignalInput[] = bricks
    .filter((b) => b.kind !== "hook")
    .map((b) => ({
      key: `brick:${b.brickId}`,
      label: b.label,
      kind: b.kind,
      postCount: b.postCount,
      viewsMedian: b.viewsMedian,
    }));
  const strongSignals = detectStrongSignals(
    [...comboSignals, ...tierSignals, ...brickSignals],
    globalMedian,
  );

  const anyJudgeable = dimensions.some((d) =>
    d.decisions.some(
      (dec) => dec.postCount >= DECISION_THRESHOLD && dec.viewsMedian !== null,
    ),
  );

  return {
    found: views.found,
    dimensions,
    strongSignals,
    totalPosts: views.samples.length,
    anyJudgeable,
  };
}

/**
 * campaignDecisions — pour une campagne + une fenêtre J+X, renvoie les verdicts
 * par dimension (tier/corps/flux/cta) et les signaux forts à valider. Changer de
 * fenêtre recalcule tout (la médiane bouge avec la fenêtre).
 */
export const campaignDecisions = adminQuery({
  args: { campaignId: v.id("scriptCampaigns"), window: WINDOW },
  handler: async (ctx, { campaignId, window }): Promise<CampaignDecisions> => {
    const views = await gatherCampaignViews(
      ctx,
      ctx.projectId,
      campaignId,
      window,
    );
    return buildDecisions(views);
  },
});
