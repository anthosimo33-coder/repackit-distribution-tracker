import { creatorQuery, adminViewAsQuery } from "./functions";
import { isSnytchProject } from "./projects";
import {
  computeMonthlyPayout,
  assignmentPublishedAt,
  assignmentViewsAndMetrics,
  MAX_PAY_PER_VIDEO_EUR,
} from "./pricing";
import { computeEarnings } from "./payments";
import { calcCycle, cycleIndexOf } from "./payCycle";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * SNYTCH — suivi créatrice de TOUT le cycle de vie de ses vidéos depuis la
 * soumission (chantier « filtres statut Mes vidéos ») : la vidéo soumise, la
 * revue admin (attente / rejet + feedback), l'approbation, la publication et le
 * paiement. EXPOSE des données déjà existantes (assignments + publications +
 * métriques Apify/YouTube + pricing) ; ne recrée AUCUN tracking, n'ajoute AUCUN
 * champ au schéma. SNYTCH UNIQUEMENT (gate slug) : hors Snytch → listes/stats
 * vides, la nav et la carte dashboard ne pointent pas ici (RepackIt intact).
 *
 * PÉRIMÈTRE : les statuts `video_submitted` et AU-DELÀ (video_submitted,
 * video_rejected, to_publish, published, paid). `todo`/`in_progress` sont exclus
 * (pas encore de vidéo soumise → restent dans les missions à faire), tout comme
 * les littéraux legacy non migrés (submitted/validated/rejected).
 *
 * SOURCE UNIQUE du GAIN + des VUES : réservés aux vidéos EN LIGNE
 * (published/paid), calculés par le MÊME moteur cappé que « Mes paiements »
 * (computeMonthlyPayout v2 / computeEarnings legacy) → plafond 150 €/vidéo (#99,
 * MAX_PAY_PER_VIDEO_EUR) à l'identique, aucune divergence. Les vues viennent de
 * assignmentViewsAndMetrics (même source que le CPM). Avant publication
 * (submitted/rejected/to_publish), ni vues ni gain (rien n'est encore généré).
 *
 * ISOLATION : filtré serveur par ctx.creatorId — une créatrice ne voit JAMAIS
 * les vidéos d'une autre. Aucun brut inutile renvoyé.
 */

type Plateforme = "TikTok" | "Instagram" | "YouTube";

/** Statut de suivi (vidéos en ligne) : actif = des métriques sont déjà remontées ;
 *  pending = vidéo publiée mais aucune métrique encore relevée (en cours de calcul). */
export type VideoTrackingStatus = "active" | "pending";

/**
 * Statut de cycle de vie exposé à la créatrice (sous-ensemble « vidéo soumise et
 * au-delà » de la machine à états assignment). A6 : défini ici (convex/ ne peut
 * importer lib/) ; les mêmes littéraux servent aux filtres UI (lib/creator-video-filters).
 */
export type CreatorVideoStatus =
  | "video_submitted"
  | "video_rejected"
  | "to_publish"
  | "published"
  | "paid";

export type CreatorVideo = {
  id: Id<"assignments">;
  status: CreatorVideoStatus;
  /** Plateformes matérialisées (published/paid) ; vide avant publication. */
  platforms: Plateforme[];
  /** Date de publication RÉELLE ; null tant que la vidéo n'est pas en ligne. */
  publishedAt: number | null;
  /** Suivi vues (published/paid) ; null avant publication (rien à suivre). */
  trackingStatus: VideoTrackingStatus | null;
  /** Dernier compte de vues (published/paid, si métriques) ; null sinon. */
  views: number | null;
  /** Gain de CETTE vidéo, plafonné 150 € (published/paid) ; null avant publication. */
  gain: number | null;
  /** Le gain a atteint le plafond 150 € → afficher « gain max ». */
  capped: boolean;
  /** Feedback admin de REFUS (video_rejected), si stocké ; null sinon. */
  rejectionReason: string | null;
  /** La créatrice a bien un MP4 soumis (video_submitted..published) rattaché. */
  hasSubmittedVideo: boolean;
  /** Compte GÉRÉ par l'équipe : la créatrice suit (script + post + perfs) mais ne
   *  publie pas — l'UI affiche « géré par l'équipe » au lieu d'un CTA publier. */
  managedByAdmin: boolean;
};

/** Une publication est matérialisée (cible OU legacy) → la vidéo est réellement en ligne. */
function hasMaterializedPublication(a: Doc<"assignments">): boolean {
  return (
    (a.targets ?? []).some((t) => t.publicationId !== undefined) ||
    a.publicationId !== undefined
  );
}

/**
 * Classe un assignment dans le cycle de vie « vidéos » de la créatrice, ou null
 * s'il n'y appartient pas (mauvais projet, todo/in_progress, statut legacy, ou
 * published/paid sans publication matérialisée — comportement conservé de #100).
 */
function creatorVideoStatus(
  a: Doc<"assignments">,
  projectId: Id<"projects">,
): CreatorVideoStatus | null {
  if (a.projectId !== projectId) return null;
  switch (a.status) {
    case "video_submitted":
    case "video_rejected":
    case "to_publish":
      return a.status;
    case "published":
    case "paid":
      return hasMaterializedPublication(a) ? a.status : null;
    default:
      return null; // todo, in_progress, legacy (submitted/validated/rejected)
  }
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

async function toCreatorVideo(
  ctx: QueryCtx,
  a: Doc<"assignments">,
  status: CreatorVideoStatus,
): Promise<CreatorVideo> {
  const isOnline = status === "published" || status === "paid";

  // Vues + gain UNIQUEMENT pour les vidéos en ligne : avant publication rien
  // n'est généré (ne PAS matérialiser un gain de base fantôme sur to_publish).
  let views: number | null = null;
  let gain: number | null = null;
  let capped = false;
  let trackingStatus: VideoTrackingStatus | null = null;
  let publishedAt: number | null = null;

  if (isOnline) {
    const { totalViews, payableViews, hasPayablePost, hasMetrics } =
      await assignmentViewsAndMetrics(ctx, a);
    // Gain par vidéo — MÊME moteur cappé que Mes paiements (plafond 150 réutilisé).
    // Warmup : posts warmup EXCLUS de la paie → gain sur les seules vues PAYABLES ;
    // une vidéo entièrement warmup (hasPayablePost false) ne génère rien.
    const g = !hasPayablePost
      ? 0
      : a.pricingSnapshot
        ? computeMonthlyPayout([
            {
              assignmentId: a._id,
              snapshot: a.pricingSnapshot,
              totalViews: payableViews,
            },
          ]).total
        : computeEarnings(a.rateSnapshot, payableViews).total;
    // Vues AFFICHÉES = vues réelles trackées (warmup inclus) — le suivi reste normal.
    views = hasMetrics ? totalViews : null;
    gain = g;
    capped = g >= MAX_PAY_PER_VIDEO_EUR;
    trackingStatus = hasMetrics ? "active" : "pending";
    publishedAt = assignmentPublishedAt(a);
  }

  return {
    id: a._id,
    status,
    platforms: videoPlatforms(a),
    publishedAt,
    trackingStatus,
    views,
    gain,
    capped,
    rejectionReason:
      status === "video_rejected" ? (a.videoReviewFeedback ?? null) : null,
    hasSubmittedVideo:
      a.submittedVideoStorageId !== undefined ||
      a.submittedVideoStreamUid !== undefined,
    managedByAdmin: a.managedByAdmin === true,
  };
}

/**
 * Vidéos d'UNE créatrice depuis la soumission (Snytch only), triées par activité
 * décroissante (publishedAt pour les vidéos en ligne, fallback createdAt sinon —
 * cf assignmentPublishedAt) : les vidéos fraîchement soumises et les publiées
 * récentes remontent en tête.
 */
async function videosForCreator(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
): Promise<CreatorVideo[]> {
  if (!(await isSnytchProject(ctx, projectId))) return [];
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect();
  const covered = assignments
    .map((a) => ({ a, status: creatorVideoStatus(a, projectId) }))
    .filter(
      (x): x is { a: Doc<"assignments">; status: CreatorVideoStatus } =>
        x.status !== null,
    );
  covered.sort((x, y) => assignmentPublishedAt(y.a) - assignmentPublishedAt(x.a));
  return Promise.all(covered.map(({ a, status }) => toCreatorVideo(ctx, a, status)));
}

export type VideoStats = {
  /** Vidéos EN LIGNE ce mois (période courante UTC, alignée sur les paiements). */
  onlineCount: number;
  /** Vues cumulées de ces vidéos (0 pour les vidéos encore en cours de calcul). */
  totalViews: number;
  /** Gains générés ce mois (somme des gains PAR VIDÉO déjà plafonnés à 150 €). */
  totalGain: number;
};

/**
 * Récap dashboard : 3 chiffres du mois courant. Dérivé de la MÊME liste que
 * l'onglet, RESTREINT aux vidéos en ligne (published/paid) — les vidéos en
 * attente/rejetées/à publier ne comptent NI dans « en ligne » NI dans le gain
 * (sémantique #100 préservée : seules les vidéos publiées génèrent).
 */
async function videoStatsForCreator(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  now: number,
): Promise<VideoStats> {
  const videos = await videosForCreator(ctx, projectId, creatorId);
  const online = videos.filter(
    (v) => v.status === "published" || v.status === "paid",
  );
  const round2 = (n: number) => Math.round(n * 100) / 100;
  // Restreint au CYCLE J+30 EN COURS (fenêtre de 30 j ancrée sur le 1er post) →
  // cohérent avec « Mes paiements » (même fenêtrage). Sans firstPostAt (aucun post
  // en ligne possible), fenêtre vide.
  const creator = await ctx.db.get(creatorId);
  const firstPostAt = creator?.firstPostAt;
  const currentCycle =
    firstPostAt !== undefined ? calcCycle(firstPostAt, now).cycleIndex : null;
  const inCycle = online.filter(
    (v) =>
      v.publishedAt !== null &&
      firstPostAt !== undefined &&
      cycleIndexOf(firstPostAt, v.publishedAt) === currentCycle,
  );
  return {
    onlineCount: inCycle.length,
    totalViews: inCycle.reduce((s, v) => s + (v.views ?? 0), 0),
    totalGain: round2(inCycle.reduce((s, v) => s + (v.gain ?? 0), 0)),
  };
}

// ─── Queries (créatrice + view-as admin) ─────────────────────────────────────

/** Mes vidéos depuis la soumission (Snytch). Filtré serveur par ctx.creatorId. */
export const listMyPublishedVideos = creatorQuery({
  args: {},
  handler: async (ctx) => videosForCreator(ctx, ctx.projectId, ctx.creatorId),
});

/** ADMIN view-as — vidéos du créateur ciblé (lecture seule). */
export const listPublishedVideosAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) => videosForCreator(ctx, ctx.projectId, ctx.creatorId),
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
