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

import { parisDayIndex, plannedDayStart } from "../convex/calendarStatus";

/**
 * Minuit local du jour d'un instant — le repère de comparaison est le JOUR.
 *
 * ⚠️ Réservé à `now` (l'horloge de la créatrice, celle de son navigateur). Le
 * JOUR PRÉVU, lui, ne se lit JAMAIS ainsi : c'est une étiquette écrite à minuit
 * Paris, et la lire en heure locale la décale d'un jour pour toute personne à
 * l'ouest de Paris — jusqu'à Londres. Il passe par `parisDayIndex` /
 * `plannedDayStart` (cf. convex/calendarStatus).
 *
 * Les deux index encodent le mois de la MÊME façon (0-based), donc ils se
 * comparent — c'est ce qui rend « jour prévu vs aujourd'hui » lisible ici.
 */
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

  const jourPrevu = parisDayIndex(postDate); // ÉTIQUETTE, jamais convertie
  const jourCourant = dayIndex(now); // son horloge à elle
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

/**
 * REGROUPEMENT PAR JOUR de la liste de missions — ce qui fait qu'« une semaine
 * se lit d'un coup ».
 *
 * Quatre familles, dans l'ordre où elles doivent être lues :
 *   - `catchup` : le jour prévu est passé (ou le créneau du jour est dépassé),
 *     rien n'est publié. Même prédicat que le bandeau rouge — `isToCatchUp` est
 *     appelé, jamais réimplémenté : deux définitions du retard finiraient par
 *     désigner des missions différentes dans deux endroits de l'écran.
 *   - `days` : un seau PAR JOUR sur l'horizon demandé, à partir d'aujourd'hui.
 *     Les jours vides ne sont pas matérialisés (une semaine à trois missions ne
 *     doit pas afficher quatre sections vides).
 *   - `later` : au-delà de l'horizon.
 *   - `undated` : aucune `postDate`. Ces missions-là n'apparaissent NI au
 *     calendrier NI dans les bandeaux — sans cette famille, elles resteraient
 *     invisibles partout ailleurs que dans un bloc plafonné.
 *
 * PUR (`now` injecté), donc testable. Deux repères, et ils ne sont pas
 * interchangeables : le jour PRÉVU est une étiquette (lue à Paris), la journée
 * COURANTE est celle de la créatrice (son navigateur).
 */
export interface ScheduleGroups<T> {
  catchup: T[];
  days: { dayStart: number; items: T[] }[];
  later: T[];
  undated: T[];
}

/**
 * Minuit UTC du jour LOCAL d'un instant — borne de seau et clé de tri.
 *
 * UTC et non local, pour que les seaux du jour prévu (construits depuis
 * l'étiquette Paris, cf `plannedDayStart`) et la borne « aujourd'hui » vivent
 * dans le MÊME repère. Comparer un minuit local à un minuit d'étiquette
 * décalerait les seaux de quelques heures — donc, certains jours, d'un jour.
 */
export function startOfDayUtcFromLocal(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

export function groupBySchedule<T extends ScheduleItem>(
  items: T[],
  now: number,
  horizonDays: number = 7,
): ScheduleGroups<T> {
  const out: ScheduleGroups<T> = { catchup: [], days: [], later: [], undated: [] };
  const byDay = new Map<number, T[]>();
  const todayStart = startOfDayUtcFromLocal(now);
  const horizonEnd = todayStart + horizonDays * 86_400_000;

  for (const item of items) {
    if (item.postDate == null) {
      out.undated.push(item);
      continue;
    }
    if (isToCatchUp(item, now)) {
      out.catchup.push(item);
      continue;
    }
    // Seau du jour PRÉVU : son étiquette, pas sa lecture locale.
    const dayStart = plannedDayStart(item.postDate);
    // Un jour ANTÉRIEUR à aujourd'hui qui n'est pas « à rattraper » est déjà
    // publié : il n'a rien à faire dans une liste de missions à faire.
    if (dayStart < todayStart) continue;
    if (dayStart >= horizonEnd) {
      out.later.push(item);
      continue;
    }
    const bucket = byDay.get(dayStart);
    if (bucket) bucket.push(item);
    else byDay.set(dayStart, [item]);
  }

  // Le plus ancien retard EN TÊTE : c'est celui qu'on a le plus laissé traîner.
  out.catchup.sort((a, b) => (a.postDate ?? 0) - (b.postDate ?? 0));
  out.later.sort((a, b) => (a.postDate ?? 0) - (b.postDate ?? 0));
  out.days = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayStart, group]) => ({
      dayStart,
      items: group.sort((a, b) => (a.postDate ?? 0) - (b.postDate ?? 0)),
    }));
  return out;
}
