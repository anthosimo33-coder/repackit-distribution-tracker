import { adminQuery } from "./functions";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { findMatchingSnapshot, type SnapshotAge } from "./snapshotMatching";

/**
 * S3 — Analytics par VARIABLE de script (lecture du bulk testing). Pour une
 * campagne + une fenêtre de vues J+X (J3/J7/J14/J30), agrège les vues des
 * publications de script (raccordées par publications.scriptCombo, cf
 * validateAssignment) PAR BRIQUE, PAR TIER de hook, et PAR COMBO complet.
 *
 * 100 % adminQuery → le créateur n'a AUCUN accès (isolation, cf rappel S2 sur la
 * fuite du label paiement). Lecture seule, aucune décision automatique (S4).
 *
 * ⚠️ A6 — réplique des stats de lib/scriptStats.ts (convex/ ne peut pas importer
 * lib/). Les tests de la médiane/quartiles/seuil vivent dans lib/scriptStats.test.ts.
 *
 * PERF — idiome identique à dashboard/aggregateTimeseries : collect by_project
 * (pas de full scan), filtrage des publications de la campagne EN MÉMOIRE
 * (Convex n'indexe pas les champs imbriqués), et regroupement des seuls
 * snapshots des publications concernées. À l'échelle du bulk testing (quelques
 * centaines de posts) c'est négligeable ; si le volume explose, basculer sur des
 * requêtes by_publication ciblées sur l'ensemble de pubs déjà identifié.
 */

// ─── Réplique stats (lib/scriptStats.ts) ─────────────────────────────────────
const JUGEABLE_THRESHOLD = 50;
type DataStatus = "en_test" | "jugeable";

function statusForCount(postCount: number): DataStatus {
  return postCount >= JUGEABLE_THRESHOLD ? "jugeable" : "en_test";
}
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((acc, v2) => acc + v2, 0) / values.length;
}
function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
interface Distribution {
  postCount: number;
  viewsMedian: number | null;
  viewsMean: number | null;
  viewsP25: number | null;
  viewsP75: number | null;
  status: DataStatus;
}
function summarize(values: readonly number[]): Distribution {
  return {
    postCount: values.length,
    viewsMedian: median(values),
    viewsMean: mean(values),
    viewsP25: quantile(values, 0.25),
    viewsP75: quantile(values, 0.75),
    status: statusForCount(values.length),
  };
}

// ─── Chargement partagé ──────────────────────────────────────────────────────

const WINDOW = v.union(
  v.literal("j3"),
  v.literal("j7"),
  v.literal("j14"),
  v.literal("j30"),
);

export const TIERS = ["S", "A", "B"] as const;
export type Tier = (typeof TIERS)[number];
// Refonte 3 briques. Un kind inconnu (corps legacy) retombe en fin via `?? 99`.
const KIND_ORDER: Record<string, number> = { hook: 0, flux: 1, cta: 2 };

/** Un échantillon = une publication de script ayant une vue résolue à la fenêtre. */
interface ViewSample {
  comboKey: string;
  hookBrickId: Id<"scriptBricks">;
  fluxBrickId: Id<"scriptBricks">;
  ctaBrickId: Id<"scriptBricks">;
  views: number;
}

export interface CampaignViews {
  found: boolean;
  bricksById: Map<string, Doc<"scriptBricks">>;
  activeBricks: Doc<"scriptBricks">[];
  samples: ViewSample[];
}

/**
 * Cœur partagé des queries analytics ET décision (S4 compose dessus) : résout,
 * pour chaque publication de la campagne, sa vue à la fenêtre choisie, et
 * renvoie les échantillons + les briques. Appelé UNE fois par query.
 */
export async function gatherCampaignViews(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  campaignId: Id<"scriptCampaigns">,
  window: SnapshotAge,
): Promise<CampaignViews> {
  const campaign = await ctx.db.get(campaignId);
  if (!campaign || campaign.projectId !== projectId) {
    return { found: false, bricksById: new Map(), activeBricks: [], samples: [] };
  }

  const bricks = await ctx.db
    .query("scriptBricks")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .collect();
  const bricksById = new Map(bricks.map((b) => [b._id as string, b]));
  const activeBricks = bricks
    .filter((b) => b.active)
    .sort((a, b) => {
      if (a.kind !== b.kind)
        return (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
      return (a.order ?? a.createdAt) - (b.order ?? b.createdAt);
    });

  // Publications de CETTE campagne (filtre en mémoire sur le champ imbriqué).
  const pubs = await ctx.db
    .query("publications")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const scriptPubs = pubs.filter(
    (p) => p.scriptCombo?.campaignId === campaignId,
  );
  const pubIds = new Set(scriptPubs.map((p) => p._id as string));

  // Snapshots des SEULES publications concernées, regroupés par publication.
  const allSnaps = await ctx.db
    .query("metricSnapshots")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const snapsByPub = new Map<string, Doc<"metricSnapshots">[]>();
  for (const s of allSnaps) {
    if (!pubIds.has(s.publicationId as string)) continue;
    const arr = snapsByPub.get(s.publicationId as string);
    if (arr) arr.push(s);
    else snapsByPub.set(s.publicationId as string, [s]);
  }

  const samples: ViewSample[] = [];
  for (const p of scriptPubs) {
    const combo = p.scriptCombo;
    if (!combo) continue;
    const match = findMatchingSnapshot(
      snapsByPub.get(p._id as string) ?? [],
      window,
    );
    if (!match) continue; // pas de mesure à cette fenêtre → hors échantillon
    samples.push({
      comboKey: combo.comboKey,
      hookBrickId: combo.hookBrickId,
      fluxBrickId: combo.fluxBrickId,
      ctaBrickId: combo.ctaBrickId,
      views: match.vues,
    });
  }

  return { found: true, bricksById, activeBricks, samples };
}

/** Slot de combo portant une brique d'un kind donné. */
function slotOf(s: ViewSample, kind: string): Id<"scriptBricks"> {
  switch (kind) {
    case "hook":
      return s.hookBrickId;
    case "flux":
      return s.fluxBrickId;
    default:
      return s.ctaBrickId;
  }
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export interface BrickPerf extends Distribution {
  brickId: Id<"scriptBricks">;
  kind: "hook" | "flux" | "cta";
  label: string;
  tier: Tier | null;
}

/**
 * Pour CHAQUE brique active de la campagne, distribution des vues des
 * publications dont le combo contient cette brique. Trié par kind puis médiane
 * décroissante (nulls en dernier). Pur sur un CampaignViews déjà chargé.
 *
 * Refonte 3 briques : la dimension "corps" a disparu. Une brique legacy
 * kind="corps" pas encore reclassée est exclue (perte assumée — pas de slot).
 */
export function aggregateByBrick(views: CampaignViews): BrickPerf[] {
  const { activeBricks, samples } = views;
  const out: BrickPerf[] = activeBricks
    .filter((b) => b.kind !== "corps")
    .map((b) => {
      const kind = b.kind as "hook" | "flux" | "cta";
      const values = samples
        .filter((s) => slotOf(s, kind) === b._id)
        .map((s) => s.views);
      return {
        brickId: b._id,
        kind,
        label: b.label,
        tier: (b.tier as Tier | undefined) ?? null,
        ...summarize(values),
      };
    });
  return out.sort((a, b) => {
    if (a.kind !== b.kind)
      return (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
    return (b.viewsMedian ?? -1) - (a.viewsMedian ?? -1);
  });
}

/** perfByBrick — cf aggregateByBrick. */
export const perfByBrick = adminQuery({
  args: { campaignId: v.id("scriptCampaigns"), window: WINDOW },
  handler: async (ctx, { campaignId, window }): Promise<BrickPerf[]> =>
    aggregateByBrick(
      await gatherCampaignViews(ctx, ctx.projectId, campaignId, window),
    ),
});

export interface TierPerf extends Distribution {
  tier: Tier;
}

/**
 * Vues agrégées par tier de hook (S/A/B). Renvoie TOUJOURS les 3 tiers
 * (postCount 0 → en_test) pour un rendu stable. Le tier d'une publication = tier
 * du hook de son combo (même si la brique a été désactivée depuis). Pur sur un
 * CampaignViews déjà chargé.
 */
export function aggregateByTier(views: CampaignViews): TierPerf[] {
  const { bricksById, samples } = views;
  const byTier = new Map<Tier, number[]>(TIERS.map((t) => [t, []]));
  for (const s of samples) {
    const hook = bricksById.get(s.hookBrickId as string);
    const tier = hook?.tier as Tier | undefined;
    if (tier && byTier.has(tier)) byTier.get(tier)!.push(s.views);
  }
  return TIERS.map((tier) => ({ tier, ...summarize(byTier.get(tier)!) }));
}

/** perfByTier — cf aggregateByTier. */
export const perfByTier = adminQuery({
  args: { campaignId: v.id("scriptCampaigns"), window: WINDOW },
  handler: async (ctx, { campaignId, window }): Promise<TierPerf[]> =>
    aggregateByTier(
      await gatherCampaignViews(ctx, ctx.projectId, campaignId, window),
    ),
});

export interface ComboPerf extends Distribution {
  comboKey: string;
  tier: Tier | null;
  hookLabel: string;
  fluxLabel: string;
  ctaLabel: string;
  /** Jugeable ET surperforme la médiane de campagne. */
  signal: boolean;
}

/** Médiane GLOBALE de campagne (toutes publications de script confondues, à la
 *  fenêtre). Référence du `signal` perfByCombo ET de detectStrongSignals (S4). */
export function campaignMedianOf(views: CampaignViews): number | null {
  return median(views.samples.map((s) => s.views));
}

/**
 * Distribution par comboKey complet (la plupart sous le seuil → "en test"). Trié
 * par médiane décroissante. `signal` = jugeable ET médiane au-dessus de la
 * médiane globale de la campagne. Pur sur un CampaignViews déjà chargé.
 */
export function aggregateByCombo(views: CampaignViews): ComboPerf[] {
  const { bricksById, samples } = views;
  const campaignMedian = campaignMedianOf(views);

  const byCombo = new Map<string, ViewSample[]>();
  for (const s of samples) {
    const arr = byCombo.get(s.comboKey);
    if (arr) arr.push(s);
    else byCombo.set(s.comboKey, [s]);
  }

  const label = (id: Id<"scriptBricks">) =>
    bricksById.get(id as string)?.label ?? "—";

  const out: ComboPerf[] = [...byCombo.values()].map((group) => {
    const head = group[0];
    const dist = summarize(group.map((s) => s.views));
    const hook = bricksById.get(head.hookBrickId as string);
    const signal =
      dist.status === "jugeable" &&
      dist.viewsMedian !== null &&
      campaignMedian !== null &&
      dist.viewsMedian > campaignMedian;
    return {
      comboKey: head.comboKey,
      tier: (hook?.tier as Tier | undefined) ?? null,
      hookLabel: label(head.hookBrickId),
      fluxLabel: label(head.fluxBrickId),
      ctaLabel: label(head.ctaBrickId),
      signal,
      ...dist,
    };
  });
  return out.sort((a, b) => (b.viewsMedian ?? -1) - (a.viewsMedian ?? -1));
}

/** perfByCombo — cf aggregateByCombo. */
export const perfByCombo = adminQuery({
  args: { campaignId: v.id("scriptCampaigns"), window: WINDOW },
  handler: async (ctx, { campaignId, window }): Promise<ComboPerf[]> =>
    aggregateByCombo(
      await gatherCampaignViews(ctx, ctx.projectId, campaignId, window),
    ),
});
