/**
 * Options du filtre de STATUT de PRODUCTION (vue liste des Missions). Pur, testé.
 *
 * Le filtre compare le statut de la mission tel quel : une option qui n'est
 * plus un statut vivant ne trouve RIEN. C'était le cas jusqu'en octobre 2026 —
 * il proposait encore les statuts d'avant le circuit vidéo (soumis / validé /
 * rejeté, migrés depuis), et n'offrait ni « vidéo en revue », ni « à publier »,
 * ni « abandonné ».
 */
export const STATUS_FILTER_OPTIONS = [
  "all",
  "todo",
  "in_progress",
  "video_submitted",
  "video_rejected",
  "to_publish",
  "published",
  "paid",
  "cancelled",
] as const;

export type StatusFilterOption = (typeof STATUS_FILTER_OPTIONS)[number];
