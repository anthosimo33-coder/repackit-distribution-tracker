/**
 * LA VIDÉO ENVOYÉE D'UNE MISSION — ce qui la protège.
 *
 * Incident du 05/10/2026 : une mission « à publier » (vidéo envoyée et validée)
 * a été abandonnée, puis supprimée depuis l'écran — la suppression effaçait le
 * fichier sur-le-champ (Convex + Cloudflare Stream). La créatrice a dû renvoyer
 * sa vidéo. Deux règles en sortent, tenues côté serveur :
 *  - abandonner une mission qui porte une vidéo exige une confirmation
 *    explicite (`force`) — convex/assignments.cancelAssignmentCore ;
 *  - supprimer une mission n'efface plus sa vidéo : elle part en archive
 *    (`deletedSubmittedVideos`), récupérable `DELETED_VIDEO_RETENTION_DAYS`
 *    jours, puis purgée par un cron.
 *
 * « Vidéo envoyée » = un FICHIER est rattaché (Convex ou Stream), quel que soit
 * le statut : une mission d'un compte géré par l'équipe naît « à publier » SANS
 * vidéo, et une mission « à refaire » garde la vidéo refusée tant qu'aucune
 * autre ne la remplace.
 *
 * Module PUR (aucun import `_generated`) : partagé par le serveur et l'écran
 * (lib/assignment-video).
 */

/** Jours pendant lesquels la vidéo d'une mission supprimée reste récupérable. */
export const DELETED_VIDEO_RETENTION_DAYS = 30;

export interface SubmittedVideoRefs {
  submittedVideoStorageId?: string | null;
  submittedVideoStreamUid?: string | null;
}

/** La mission porte-t-elle une vidéo envoyée (fichier Convex ou copie Stream) ? */
export function hasSubmittedVideo(a: SubmittedVideoRefs): boolean {
  return Boolean(a.submittedVideoStorageId) || Boolean(a.submittedVideoStreamUid);
}

const DAY_MS = 86_400_000;

/** Jours entiers restants avant l'effacement définitif d'une vidéo archivée (0 = échue). */
export function joursAvantEffacement(purgeAfter: number, now: number): number {
  return Math.max(0, Math.ceil((purgeAfter - now) / DAY_MS));
}

/**
 * RATTACHER une vidéo archivée à une mission (écran « Vidéos supprimées ») : la
 * vidéo reprend le circuit normal, comme si la créatrice venait de l'envoyer —
 * donc seulement là où elle POURRAIT l'envoyer, et sans rien écraser.
 */
export const STATUTS_RATTACHABLES: ReadonlySet<string> = new Set(["todo", "in_progress"]);

export type RefusRattachement =
  /** Le fichier d'origine n'existe plus (seule la copie de lecture reste). */
  | "fichier_absent"
  /** La mission est celle d'une autre créatrice. */
  | "autre_createatrice"
  /** La mission a déjà une vidéo envoyée : on ne la remplace pas. */
  | "deja_une_video"
  /** La mission n'attend pas de vidéo (abandonnée, publiée, payée…). */
  | "statut";

/** Pourquoi cette vidéo archivée ne peut pas rejoindre cette mission (null : elle peut). */
export function refusRattachement(
  archive: { creatorId: string; storageId?: string | null },
  mission: { creatorId: string; status: string } & SubmittedVideoRefs,
): RefusRattachement | null {
  if (!archive.storageId) return "fichier_absent";
  if (mission.creatorId !== archive.creatorId) return "autre_createatrice";
  if (hasSubmittedVideo(mission)) return "deja_une_video";
  if (!STATUTS_RATTACHABLES.has(mission.status)) return "statut";
  return null;
}
