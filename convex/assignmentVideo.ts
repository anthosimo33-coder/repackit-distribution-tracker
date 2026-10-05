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
