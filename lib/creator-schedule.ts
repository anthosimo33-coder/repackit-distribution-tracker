/**
 * CHRONOLOGIE de l'espace créatrice — ce qui est à rattraper, et dans quel ordre.
 *
 * ⚠️ Deux notions de « retard » coexistent dans ce produit, et les confondre
 * donnerait un dashboard incompréhensible :
 *
 *   - « En retard » (lib/assignment-status, badge rose) porte sur `dueDate`,
 *     l'échéance de PRODUCTION : la vidéo n'est pas tournée.
 *   - « À rattraper » (ici) porte sur `postDate`, la date de PUBLICATION : la
 *     vidéo peut être prête et simplement pas postée.
 *
 * Une vidéo peut être tournée à temps et publiée en retard, et l'inverse. Les
 * deux badges coexistent donc volontairement, avec des mots différents.
 *
 * ⚠️ Ce module NE touche PAS `lib/calendar-status` : celui-là est partagé avec le
 * calendrier ADMIN, et y injecter la règle de plage horaire changerait ce que
 * l'admin voit. Fonction dédiée, sémantique admin intacte (même discipline qu'en
 * #56, où deux tentatives d'y glisser postWindow ont été retirées).
 */

/** Minuit local du jour d'un instant — le repère de comparaison est le JOUR. */
function dayIndex(ts: number): number {
  const d = new Date(ts);
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

/** Minutes écoulées depuis minuit LOCAL — même repère que `postWindow`. */
function minutesOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

export interface ScheduleItem {
  /** Jour de publication planifié (ms). Absent ⇒ hors chronologie. */
  postDate?: number | null;
  /** Créneau horaire, en minutes depuis minuit local (cf convex/postWindow). */
  postWindow?: { startMin: number; endMin: number } | null;
  /** Date de publication RÉELLE (ms), ou absente si pas encore publié. */
  publishedAt?: number | null;
}

/**
 * La tâche est-elle À RATTRAPER ?
 *
 * Deux cas, et deux seulement :
 *   1. le jour prévu est ENTIÈREMENT passé et rien n'a été publié ;
 *   2. c'est aujourd'hui, un créneau est défini, et l'heure de fin est dépassée.
 *
 * Sans créneau, une tâche du jour n'est JAMAIS en retard avant minuit : la
 * journée n'est pas finie, rien ne permet de dire que la créatrice est en faute.
 *
 * Publiée ⇒ jamais à rattraper, même publiée en retard : le rattrapage est fait.
 * (Le fait qu'elle soit sortie hors délai reste visible côté admin via
 * `calendarStatus`, qui rend « late » — ce n'est pas la même question.)
 */
export function isToCatchUp(item: ScheduleItem, now: number): boolean {
  const { postDate, postWindow, publishedAt } = item;
  if (postDate == null) return false;
  if (publishedAt != null) return false;

  const jourPrevu = dayIndex(postDate);
  const jourCourant = dayIndex(now);
  if (jourCourant > jourPrevu) return true;
  if (jourCourant < jourPrevu) return false;

  // Jour même : seul un créneau dépassé le rend rattrapable.
  if (!postWindow) return false;
  return minutesOfDay(now) > postWindow.endMin;
}

/** Rang de section du dashboard — l'ordre de haut en bas, sans exception. */
export type ScheduleBucket = "catchup" | "today" | "upcoming" | "none";

/**
 * Section d'une tâche. `catchup` prime TOUJOURS sur `today` : une tâche du jour
 * ne doit jamais s'afficher au-dessus d'un rattrapage, même si son créneau est
 * imminent — sinon l'ancien passe sous le radar, ce qui est précisément le
 * problème qu'on corrige.
 */
export function scheduleBucket(item: ScheduleItem, now: number): ScheduleBucket {
  if (item.postDate == null) return "none";
  if (item.publishedAt != null) return "none";
  if (isToCatchUp(item, now)) return "catchup";
  return dayIndex(item.postDate) === dayIndex(now) ? "today" : "upcoming";
}

const BUCKET_RANK: Record<ScheduleBucket, number> = {
  catchup: 0,
  today: 1,
  upcoming: 2,
  none: 3,
};

/**
 * Tri STRICT du dashboard : rattrapages (du plus ancien au plus récent), puis
 * aujourd'hui, puis à venir. À section égale, l'ordre est chronologique — donc
 * le retard le plus vieux arrive en tête, celui qu'on a le plus laissé traîner.
 *
 * Tri STABLE (comparateur total, jamais 0 sur des dates différentes) : deux
 * rendus successifs de la même liste donnent le même ordre.
 */
export function compareBySchedule(
  a: ScheduleItem,
  b: ScheduleItem,
  now: number,
): number {
  const ra = BUCKET_RANK[scheduleBucket(a, now)];
  const rb = BUCKET_RANK[scheduleBucket(b, now)];
  if (ra !== rb) return ra - rb;
  return (a.postDate ?? 0) - (b.postDate ?? 0);
}

/** Trie une liste selon la chronologie imposée (copie, n'altère pas l'entrée). */
export function sortBySchedule<T extends ScheduleItem>(
  items: T[],
  now: number,
): T[] {
  return [...items].sort((a, b) => compareBySchedule(a, b, now));
}
