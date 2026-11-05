import type { Doc, Id } from "./_generated/dataModel";

/**
 * CLASSEMENT d'une mission dans « Mes vidéos » (onglet Gains) — module PUR,
 * extrait de convex/creatorVideos pour être testé sans runtime Convex.
 */

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

/** Une publication est matérialisée (cible OU legacy) → la vidéo est réellement en ligne. */
export function hasMaterializedPublication(a: Doc<"assignments">): boolean {
  return (
    (a.targets ?? []).some((t) => t.publicationId !== undefined) ||
    a.publicationId !== undefined
  );
}

/**
 * Classe un assignment dans le cycle de vie « vidéos » de la créatrice, ou null
 * s'il n'y appartient pas (mauvais projet, todo/in_progress, à publier sans
 * validation, statut legacy, ou published/paid sans publication matérialisée —
 * comportement conservé de #100).
 */
export function creatorVideoStatus(
  a: Doc<"assignments">,
  projectId: Id<"projects">,
): CreatorVideoStatus | null {
  if (a.projectId !== projectId) return null;
  switch (a.status) {
    case "video_submitted":
    case "video_rejected":
      return a.status;
    case "to_publish":
      // Publiée SANS VALIDATION (cf convex/videoReviewSkip) : « à publier » ne
      // veut pas dire « vidéo validée » — il n'y a peut-être encore aucune
      // vidéo. C'est une mission, comme todo/in_progress ; elle entre ici à sa
      // publication.
      return a.reviewSkippedFrom !== undefined ? null : a.status;
    case "published":
    case "paid":
      return hasMaterializedPublication(a) ? a.status : null;
    default:
      return null; // todo, in_progress, legacy (submitted/validated/rejected)
  }
}
