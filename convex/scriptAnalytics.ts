import { adminQuery } from "./functions";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { findMatchingSnapshot, type SnapshotAge } from "./snapshotMatching";
import { normalizeTier } from "./scriptTier";
import { buildPublicationAssignmentMap, postLabel } from "./trackerData";
import { passesWarmupMode, type WarmupMode } from "./warmupMode";

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
  // "latest" = dernier snapshot de CHAQUE post (vues à jour, couverture maximale :
  // aucun post exclu faute de maturité). gatherCampaignViews/findMatchingSnapshot
  // le gèrent déjà. Utilisé par le pré-remplissage « Rejouer ce script » (perf par
  // brique/combo sur TOUT l'historique, pas une fenêtre j7). La page analytics
  // garde ses fenêtres jX pour ses verdicts normalisés.
  v.literal("latest"),
);

// 2 tiers (Argent/Autre). Le "B" legacy est replié sur "A" via normalizeTier.
export const TIERS = ["S", "A"] as const;
export type Tier = (typeof TIERS)[number];
// Refonte 3 briques. Un kind inconnu (corps legacy) retombe en fin via `?? 99`.
const KIND_ORDER: Record<string, number> = { hook: 0, flux: 1, cta: 2 };

/** Un échantillon = une publication de script ayant une vue résolue à la fenêtre.
 *
 *  `views` reste la SEULE base des médianes/verdicts (aggregateBy* — inchangé).
 *  Les autres champs sont ADDITIFS, pour le drill-down par variable (postsByBrick)
 *  SANS second scan : `likes`/`comments` viennent du MÊME snapshot matché que
 *  `views` (même fenêtre) ; les champs d'affichage viennent de la publication
 *  déjà chargée dans la passe. Aucun agrégat ne les lit → médianes préservées. */
interface ViewSample {
  comboKey: string;
  hookBrickId: Id<"scriptBricks">;
  fluxBrickId: Id<"scriptBricks">;
  ctaBrickId: Id<"scriptBricks">;
  views: number;
  // ─── Drill-down (additif) — métriques du snapshot matché à la fenêtre ───────
  likes: number;
  comments: number;
  // ─── Drill-down (additif) — identité + affichage du post ────────────────────
  publicationId: Id<"publications">;
  carouselId: string;
  label: string;
  plateforme: "TikTok" | "Instagram" | "YouTube";
  mediaType: "carousel" | "short" | "screenrecorder";
  compte: string;
  datePubli: number;
  postUrl: string | null;
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
/**
 * Segmentation WARMUP / PROMO des analytics de script.
 *
 * Le mode existe déjà côté produit (convex/warmupMode) mais était FIGÉ à
 * « exclude » ici : impossible de regarder les performances des warmup, ni de
 * comparer les deux populations. `contentType` posé à l'assignation se propage
 * en `publications.isWarmup`, donc ce filtre segmente désormais exactement la
 * qualification saisie par l'admin.
 *
 * DÉFAUT INCHANGÉ (« exclude ») : toutes les surfaces existantes appellent sans
 * argument et lisent la même chose qu'avant. TD-019 tient — le warmup reste
 * retiré à la SOURCE unique des échantillons, pour que médianes par variable et
 * médiane de référence soient filtrées d'un seul coup.
 */
export async function gatherCampaignViews(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  campaignId: Id<"scriptCampaigns">,
  window: SnapshotAge,
  /** Segment lu. Défaut « exclude » = comportement historique, appelants inchangés. */
  warmupMode: WarmupMode = "exclude",
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
  // TD-019 : surface de DÉCISION (verdicts de bulk-testing). Warmup exclu ICI,
  // à la source unique des échantillons → les médianes PAR VARIABLE et la
  // médiane de CAMPAGNE qui leur sert de référence sont filtrées d'un seul coup
  // (sinon le biais warmup est compté deux fois). Helper unique.
  const scriptPubs = pubs.filter(
    (p) =>
      p.scriptCombo?.campaignId === campaignId &&
      passesWarmupMode(p.isWarmup === true, warmupMode),
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
      // Même snapshot matché que `views` — likes requis, comments optionnel (→ 0
      // comme le tracker, pour l'engagement dérivé au rendu).
      likes: match.likes,
      comments: match.comments ?? 0,
      publicationId: p._id,
      carouselId: p.carouselId,
      label: postLabel(p),
      plateforme: p.plateforme,
      mediaType: p.mediaType ?? "carousel",
      compte: p.compte,
      datePubli: p.datePubli,
      postUrl: p.postUrl ?? null,
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
        // Tier normalisé (B legacy → A) ; null si la brique n'a pas de tier.
        tier: b.tier ? normalizeTier(b.tier) : null,
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

// ─── Drill-down : les POSTS réels derrière une variable de brique ─────────────

/**
 * Un post du drill-down, à la FENÊTRE de la passe. Shape ALIGNÉE sur
 * `TrackerPost` (components/tracker/PostsList) pour réutiliser le présentational
 * tel quel. `vues`/`likes`/`comments` = métriques du snapshot matché à J+X (PAS
 * le latest) ; l'engagement est dérivé au rendu via engagementRate.
 */
export interface BrickPostRow {
  _id: Id<"publications">;
  carouselId: string;
  label: string;
  plateforme: "TikTok" | "Instagram" | "YouTube";
  mediaType: "carousel" | "short" | "screenrecorder";
  compte: string;
  creatorId: Id<"creators"> | null;
  creatorName: string | null;
  formatId: Id<"formats"> | null;
  formatName: string | null;
  datePubli: number;
  postUrl: string | null;
  vues: number;
  likes: number;
  comments: number;
}

/**
 * Pour une brique-variable donnée, la liste des posts qui l'utilisent, À LA
 * FENÊTRE de la passe. Réplique A6 de lib/scriptPosts.selectSamplesForBrick :
 * garde les samples dont le slot du `kind` de la brique === brickId (via slotOf).
 * Le `corps` legacy n'a pas de slot → liste vide. Rows SANS créateur/format
 * (résolus par la query). Trié vues décroissantes (le client re-trie). Pur sur
 * un CampaignViews déjà chargé.
 *
 * Cohérence verdict↔preuve : ce sont EXACTEMENT les samples qui produisent la
 * médiane de la brique dans aggregateByBrick (même passe, même fenêtre, mêmes
 * posts mesurés à J+X). Une brique sans sample mesuré → liste vide.
 */
export function postsByBrick(
  views: CampaignViews,
  brickId: Id<"scriptBricks">,
): BrickPostRow[] {
  const brick = views.bricksById.get(brickId as string);
  if (!brick || brick.kind === "corps") return [];
  const kind = brick.kind as "hook" | "flux" | "cta";
  const rows: BrickPostRow[] = views.samples
    .filter((s) => slotOf(s, kind) === brickId)
    .map((s) => ({
      _id: s.publicationId,
      carouselId: s.carouselId,
      label: s.label,
      plateforme: s.plateforme,
      mediaType: s.mediaType,
      compte: s.compte,
      creatorId: null,
      creatorName: null,
      formatId: null,
      formatName: null,
      datePubli: s.datePubli,
      postUrl: s.postUrl,
      vues: s.views,
      likes: s.likes,
      comments: s.comments,
    }));
  return rows.sort((a, b) => b.vues - a.vues);
}

/**
 * postsForBrick — pour une campagne + une brique + une fenêtre J+X, la liste des
 * posts RÉELS qui utilisent cette variable, avec leurs métriques individuelles À
 * CETTE FENÊTRE. Partage la MÊME passe gatherCampaignViews que perfByBrick → les
 * posts affichés sont exactement ceux qui produisent la médiane/verdict de la
 * variable. Enrichit ensuite chaque post de son créateur/format via les
 * assignments (même attribution que le tracker). Admin-only.
 */
export const postsForBrick = adminQuery({
  args: {
    campaignId: v.id("scriptCampaigns"),
    brickId: v.id("scriptBricks"),
    window: WINDOW,
  },
  handler: async (
    ctx,
    { campaignId, brickId, window },
  ): Promise<BrickPostRow[]> => {
    const views = await gatherCampaignViews(
      ctx,
      ctx.projectId,
      campaignId,
      window,
    );
    const rows = postsByBrick(views, brickId);
    if (rows.length === 0) return [];
    // Créateur/format via les assignments (script → format null). Chargé
    // uniquement ici (pas dans la passe partagée) → médianes non impactées.
    const refs = await buildPublicationAssignmentMap(ctx);
    return rows.map((r) => {
      const ref = refs.get(r._id as string);
      return {
        ...r,
        creatorId: ref?.creatorId ?? null,
        creatorName: ref?.creatorName ?? null,
        formatId: ref?.formatId ?? null,
        formatName: ref?.formatName ?? null,
      };
    });
  },
});

export interface TierPerf extends Distribution {
  tier: Tier;
}

/**
 * Vues agrégées par tier de hook. Renvoie TOUJOURS les 2 tiers (« Argent » =
 * S, « Autre » = A ; postCount 0 → en_test) pour un rendu stable. Le tier d'une
 * publication = tier du hook de son combo (même si la brique a été désactivée
 * depuis), NORMALISÉ : un hook ex-"B" (legacy, non encore migré) compte dans
 * « Autre » (A). Un hook sans tier est ignoré. Pur sur un CampaignViews chargé.
 */
export function aggregateByTier(views: CampaignViews): TierPerf[] {
  const { bricksById, samples } = views;
  const byTier = new Map<Tier, number[]>(TIERS.map((t) => [t, []]));
  for (const s of samples) {
    const hook = bricksById.get(s.hookBrickId as string);
    if (!hook?.tier) continue; // hook sans tier → non classé
    byTier.get(normalizeTier(hook.tier))!.push(s.views); // "B" → "A"
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
