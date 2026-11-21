/**
 * L'écran Missions lit sa liste en DEUX parts (convex/assignments,
 * `listAssignmentsPilotagePart`) : les missions créées depuis le début de la
 * fenêtre (« recentes ») et les autres (« anciennes »). Une écriture ne relance
 * que la part de la mission qu'elle touche — presque toujours la récente — au
 * lieu de relire tout le projet (facture Convex, 21/11/2026).
 */

const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** Le 05/01/1970 à 0 h UTC est un lundi : les semaines se comptent depuis lui. */
const LUNDI = 4 * DAY;
/** Les missions des quatre dernières semaines pleines au moins sont « récentes ». */
const FENETRE_SEMAINES = 4;

/**
 * Début de la part récente : le lundi 0 h UTC de la semaine de `now`, moins
 * quatre semaines. Arrondi à la semaine pour que tous les onglets demandent la
 * même chose (une seule lecture partagée) et que la coupure ne bouge qu'une fois
 * par semaine.
 */
export function debutDesMissionsRecentes(now: number): number {
  const lundi = Math.floor((now - LUNDI) / WEEK) * WEEK + LUNDI;
  return lundi - FENETRE_SEMAINES * WEEK;
}

/**
 * Les deux parts en une liste, dans l'ordre de la liste entière : création
 * (`createdAt`) la plus récente d'abord. Chaque part arrive déjà dans cet ordre ;
 * à égalité, la liste entière garde l'ordre des documents, où toute ancienne
 * précède toute récente.
 */
export function fusionnerPilotage<T extends { createdAt: number }>(
  recentes: readonly T[],
  anciennes: readonly T[],
): T[] {
  const out: T[] = [];
  let i = 0;
  let j = 0;
  while (i < recentes.length && j < anciennes.length) {
    if (recentes[i].createdAt > anciennes[j].createdAt) out.push(recentes[i++]);
    else out.push(anciennes[j++]);
  }
  while (i < recentes.length) out.push(recentes[i++]);
  while (j < anciennes.length) out.push(anciennes[j++]);
  return out;
}
