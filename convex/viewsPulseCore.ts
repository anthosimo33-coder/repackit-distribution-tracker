/**
 * LE POULS DES VUES — « Hier : +4 200 vues sur tes vidéos ».
 *
 * Module PUR (aucun import `_generated`), testable depuis `lib/`. La répartition
 * par jour n'est PAS refaite ici : c'est `computeDailyViewDeltasBy`, la même que
 * le graphe « vues d'un jour » du Tracker. Un chiffre calculé par un autre
 * chemin (delta brut de deux relevés, par exemple) tomberait voisin mais
 * différent, et l'écart se lirait comme un bug.
 *
 * « Hier » = la journée calendaire Europe/Paris précédant `now` : c'est l'axe
 * des relevés (cf convex/viewsDaily). Le relevé de vues tombe à 23 h 30 Paris,
 * donc la journée d'hier est entièrement couverte dès minuit.
 *
 * Groupe = l'assignment : une vidéo publiée sur deux plateformes fait UNE ligne,
 * comme sur l'écran « Mes vidéos ».
 */
import {
  computeDailyViewDeltasBy,
  parisDayKey,
  type SnapshotPoint,
} from "./viewsDaily";

export type ViewsPulse = {
  /** Jour Paris "YYYY-MM-DD". */
  date: string;
  views: number;
  /** Au moins un intervalle > 30 h : la valeur est une estimation au prorata. */
  estimated: boolean;
  perAssignment: { assignmentId: string; views: number }[];
};

export function computeViewsPulse(
  snaps: SnapshotPoint[],
  assignmentOfPublication: (publicationId: string) => string,
  now: number,
): ViewsPulse | null {
  const yesterday = parisDayKey(now - 86_400_000);
  const day = computeDailyViewDeltasBy(snaps, assignmentOfPublication).find(
    (d) => d.date === yesterday,
  );
  if (!day || day.value <= 0) return null;
  return {
    date: yesterday,
    views: day.value,
    estimated: day.estimated,
    perAssignment: day.parts.map((p) => ({ assignmentId: p.group, views: p.value })),
  };
}
