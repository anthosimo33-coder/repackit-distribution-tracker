import { creatorQuery, adminViewAsQuery } from "./functions";
import { isSnytchProject } from "./projects";
import {
  computeMonthlyPayout,
  assignmentPublishedAt,
  assignmentViewsAndMetrics,
  MAX_PAY_PER_VIDEO_EUR,
} from "./pricing";
import { computeEarnings, periodOf } from "./payments";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * SNYTCH — suivi des vidéos PUBLIÉES par la créatrice (vues + statut de suivi +
 * gain par vidéo). EXPOSE des données déjà existantes (publications + métriques
 * Apify/YouTube + pricing) ; ne recrée AUCUN tracking. SNYTCH UNIQUEMENT (gate
 * slug) : hors Snytch → listes/stats vides, la nav et la carte dashboard ne
 * pointent pas ici (RepackIt intact).
 *
 * SOURCE UNIQUE du GAIN : le gain d'une vidéo réutilise le MÊME moteur cappé que
 * « Mes paiements » (computeMonthlyPayout pour le modèle pricing v2, computeEarnings
 * pour le legacy) — donc le plafond 150 €/vidéo (#99, MAX_PAY_PER_VIDEO_EUR)
 * s'applique à l'identique, aucune divergence avec les paiements. Les vues
 * proviennent de assignmentViewsAndMetrics (même source que le CPM).
 *
 * ISOLATION : filtré serveur par ctx.creatorId — une créatrice ne voit JAMAIS les
 * vidéos d'une autre. Aucun brut inutile renvoyé (pas d'ids de publication, de
 * snapshot pricing, de vues par plateforme).
 */

type Plateforme = "TikTok" | "Instagram" | "YouTube";

/** Statut de suivi : actif = des métriques sont déjà remontées ; pending = vidéo
 *  publiée mais aucune métrique encore relevée (fraîche, en cours de calcul). */
export type VideoTrackingStatus = "active" | "pending";

export type PublishedVideo = {
  id: Id<"assignments">;
  platforms: Plateforme[];
  publishedAt: number;
  trackingStatus: VideoTrackingStatus;
  /** Dernier compte de vues connu ; null tant qu'aucune métrique n'est remontée. */
  views: number | null;
  /** Gain de CETTE vidéo, plafonné à 150 € (source unique = moteur paie cappé). */
  gain: number;
  /** Le gain a atteint le plafond 150 € → afficher « gain max ». */
  capped: boolean;
};

/** Un assignment publié dont une publication est matérialisée = 1 vidéo suivie. */
function isPublishedVideo(a: Doc<"assignments">, projectId: Id<"projects">): boolean {
  if (a.projectId !== projectId) return false;
  if (a.status !== "published" && a.status !== "paid") return false;
  return (
    (a.targets ?? []).some((t) => t.publicationId !== undefined) ||
    a.publicationId !== undefined
  );
}

/** Plateformes de la vidéo (cibles matérialisées ; fallback legacy submittedPlatform). */
function videoPlatforms(a: Doc<"assignments">): Plateforme[] {
  const fromTargets = [
    ...new Set(
      (a.targets ?? [])
        .filter((t) => t.publicationId !== undefined)
        .map((t) => t.platform),
    ),
  ];
  if (fromTargets.length > 0) return fromTargets;
  return a.submittedPlatform ? [a.submittedPlatform] : [];
}

async function toPublishedVideo(
  ctx: QueryCtx,
  a: Doc<"assignments">,
): Promise<PublishedVideo> {
  const { totalViews, hasMetrics } = await assignmentViewsAndMetrics(ctx, a);
  // Gain par vidéo — MÊME moteur cappé que Mes paiements (plafond 150 réutilisé).
  const gain = a.pricingSnapshot
    ? computeMonthlyPayout([
        { assignmentId: a._id, snapshot: a.pricingSnapshot, totalViews },
      ]).total
    : computeEarnings(a.rateSnapshot, totalViews).total;
  return {
    id: a._id,
    platforms: videoPlatforms(a),
    publishedAt: assignmentPublishedAt(a),
    trackingStatus: hasMetrics ? "active" : "pending",
    views: hasMetrics ? totalViews : null,
    gain,
    capped: gain >= MAX_PAY_PER_VIDEO_EUR,
  };
}

/** Vidéos publiées d'UNE créatrice (Snytch only), triées de la plus récente. */
async function publishedVideosForCreator(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
): Promise<PublishedVideo[]> {
  if (!(await isSnytchProject(ctx, projectId))) return [];
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect();
  const videos = await Promise.all(
    assignments
      .filter((a) => isPublishedVideo(a, projectId))
      .map((a) => toPublishedVideo(ctx, a)),
  );
  return videos.sort((x, y) => y.publishedAt - x.publishedAt);
}

export type VideoStats = {
  /** Vidéos mises en ligne CE MOIS (période courante UTC, alignée sur les paiements). */
  onlineCount: number;
  /** Vues cumulées de ces vidéos (0 pour les vidéos encore en cours de calcul). */
  totalViews: number;
  /** Gains générés ce mois (somme des gains PAR VIDÉO déjà plafonnés à 150 €). */
  totalGain: number;
};

/** Récap dashboard : 3 chiffres du mois courant, dérivés de la même liste. */
async function videoStatsForCreator(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  now: number,
): Promise<VideoStats> {
  const videos = await publishedVideosForCreator(ctx, projectId, creatorId);
  const period = periodOf(now);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const monthly = videos.filter((v) => periodOf(v.publishedAt) === period);
  return {
    onlineCount: monthly.length,
    totalViews: monthly.reduce((s, v) => s + (v.views ?? 0), 0),
    totalGain: round2(monthly.reduce((s, v) => s + v.gain, 0)),
  };
}

// ─── Queries (créatrice + view-as admin) ─────────────────────────────────────

/** Mes vidéos publiées (Snytch). Filtré serveur par ctx.creatorId. */
export const listMyPublishedVideos = creatorQuery({
  args: {},
  handler: async (ctx) =>
    publishedVideosForCreator(ctx, ctx.projectId, ctx.creatorId),
});

/** ADMIN view-as — vidéos publiées du créateur ciblé (lecture seule). */
export const listPublishedVideosAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) =>
    publishedVideosForCreator(ctx, ctx.projectId, ctx.creatorId),
});

/** Récap dashboard — mes 3 chiffres vidéos du mois (Snytch). */
export const getMyVideoStats = creatorQuery({
  args: {},
  handler: async (ctx) =>
    videoStatsForCreator(ctx, ctx.projectId, ctx.creatorId, Date.now()),
});

/** ADMIN view-as — récap vidéos du créateur ciblé (lecture seule). */
export const getVideoStatsAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) =>
    videoStatsForCreator(ctx, ctx.projectId, ctx.creatorId, Date.now()),
});
