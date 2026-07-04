/**
 * SNYTCH « Mes vidéos » — définition des 4 filtres par statut de l'onglet
 * créatrice + comptage. Helper PUR (aucune dépendance React/Convex) → testé
 * Vitest. A6 : convex/ ne peut pas importer lib/ ; les littéraux de statut sont
 * les mêmes que `CreatorVideoStatus` renvoyé par convex/creatorVideos (contrat
 * partagé par valeur, pas par import).
 *
 * Mapping (le périmètre est déjà « vidéo soumise et au-delà », todo/in_progress
 * exclus côté serveur) :
 *   - all      → tout le périmètre.
 *   - pending  → video_submitted (soumise, en attente de validation admin).
 *   - online   → to_publish + published + paid GROUPÉS (approuvé-pas-publié ET
 *                réellement en ligne sous un seul filtre).
 *   - rejected → video_rejected.
 */

export type CreatorVideoStatus =
  | "video_submitted"
  | "video_rejected"
  | "to_publish"
  | "published"
  | "paid";

export type CreatorVideoFilterKey = "all" | "pending" | "online" | "rejected";

export const CREATOR_VIDEO_FILTERS: {
  key: CreatorVideoFilterKey;
  label: string;
  /** null = tout le périmètre (pas de restriction de statut). */
  statuses: CreatorVideoStatus[] | null;
}[] = [
  { key: "all", label: "Toutes mes vidéos", statuses: null },
  { key: "pending", label: "En attente", statuses: ["video_submitted"] },
  {
    key: "online",
    label: "Approuvé et en ligne",
    statuses: ["to_publish", "published", "paid"],
  },
  { key: "rejected", label: "Rejeté", statuses: ["video_rejected"] },
];

/** Un statut appartient-il au filtre `key` ? (`all` accepte tout le périmètre.) */
export function matchesCreatorVideoFilter(
  status: CreatorVideoStatus,
  key: CreatorVideoFilterKey,
): boolean {
  const filter = CREATOR_VIDEO_FILTERS.find((f) => f.key === key);
  if (!filter || filter.statuses === null) return true;
  return filter.statuses.includes(status);
}

/** Compte, pour chaque filtre, le nombre de vidéos correspondantes (compteurs UI). */
export function countCreatorVideosByFilter(
  videos: readonly { status: CreatorVideoStatus }[],
): Record<CreatorVideoFilterKey, number> {
  const counts: Record<CreatorVideoFilterKey, number> = {
    all: 0,
    pending: 0,
    online: 0,
    rejected: 0,
  };
  for (const v of videos) {
    for (const f of CREATOR_VIDEO_FILTERS) {
      if (matchesCreatorVideoFilter(v.status, f.key)) counts[f.key] += 1;
    }
  }
  return counts;
}
