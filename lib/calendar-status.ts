/**
 * Statut CALENDRIER d'un post planifié — à l'heure / en retard / manqué / prévu
 * (brique B du chantier « calendrier de publication »). DISTINCT du statut de
 * PRODUCTION (`status` : à publier, etc.) : c'est une information CALCULÉE en plus,
 * pour la vue calendrier, jamais stockée.
 *
 * AUCUNE TOLÉRANCE (décision cadrée) :
 *  - à l'heure : une publication existe ET le jour de publication = le jour prévu ;
 *  - en retard : une publication existe mais un AUTRE jour (après OU avant) ;
 *  - manqué   : le jour prévu est entièrement passé et AUCUNE publication ;
 *  - prévu    : le jour prévu est aujourd'hui ou futur, pas encore de publication.
 *
 * Logique PURE (primitives + `now` injecté → testable à horloge fixe, comme
 * lib/assignment-status.assignmentUrgency, PAS comme publication-status.isLate qui
 * fige Date.now()). Comparaison au JOUR CALENDAIRE LOCAL : postDate est stocké à
 * minuit local et le calcul tourne côté client (TZ de l'équipe), donc postDate,
 * postedAt et now sont dans le même référentiel.
 *
 * La date « réelle » (postedAt) est la date de CONFIRMATION de publication
 * (target.publishedAt), pas un vrai timestamp scrapé (aucun n'existe aujourd'hui) —
 * décision cadrée du chantier.
 */

export type CalendarStatus =
  | "on_time"
  | "late"
  | "missed"
  | "scheduled"
  | "none"; // pas de date de post planifiée → hors calendrier

/** Index de jour LOCAL comparable (année*10000 + mois*100 + jour). Monotone. */
function localDayIndex(ms: number): number {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

export function calendarStatus(input: {
  /** Jour de publication PLANIFIÉ (ms), ou absent → hors calendrier. */
  postDate: number | null | undefined;
  /** Date de publication RÉELLE (ms, = confirmation), ou null si pas publié. */
  postedAt: number | null | undefined;
  /** Horloge injectée (ms). */
  now: number;
}): CalendarStatus {
  const { postDate, postedAt, now } = input;
  if (postDate == null) return "none";
  const plannedDay = localDayIndex(postDate);
  if (postedAt != null) {
    // Publié : à l'heure SEULEMENT si le même jour calendaire (0 tolérance).
    return localDayIndex(postedAt) === plannedDay ? "on_time" : "late";
  }
  // Pas encore publié : manqué si le jour prévu est ENTIÈREMENT passé, sinon prévu
  // (le jour même compte comme « prévu » : la journée n'est pas terminée).
  return localDayIndex(now) > plannedDay ? "missed" : "scheduled";
}

export const CALENDAR_STATUS_LABEL: Record<CalendarStatus, string> = {
  on_time: "À l'heure",
  late: "En retard",
  missed: "Manqué",
  scheduled: "Prévu",
  none: "—",
};

/** true si le statut concerne un post PASSÉ (dénominateur du taux « à l'heure »). */
export function isPastPost(s: CalendarStatus): boolean {
  return s === "on_time" || s === "late" || s === "missed";
}
