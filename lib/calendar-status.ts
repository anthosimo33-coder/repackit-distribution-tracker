/**
 * Statut CALENDRIER d'un post planifié — point d'accès CLIENT.
 *
 * La DÉFINITION vit dans `convex/calendarStatus.ts` (module pur : A6 interdit
 * `convex/ → lib/`, pas l'inverse). Ce fichier ne fait que ré-exporter, pour que
 * les imports existants (`@/lib/calendar-status`) continuent de marcher et qu'il
 * n'existe qu'UNE implémentation — les notifications de retard tournent côté
 * serveur et doivent compter exactement comme l'écran.
 *
 * ⚠️ Le jour de référence est désormais épinglé sur EUROPE/PARIS et non plus sur
 * le fuseau du navigateur. Voir l'en-tête du module propriétaire : `postDate` est
 * stocké à minuit Paris, et le comparer depuis un autre fuseau le fait basculer
 * d'un jour. Les tests vivent dans `lib/calendar-status.test.ts`.
 */
export {
  CALENDAR_STATUS_LABEL,
  calendarStatus,
  isPastPost,
  isSameLocalDay,
  lateDays,
  onTimeTally,
  parisDayIndex,
  parisHour,
  representativePostedAt,
  type CalendarStatus,
  type OnTimeTally,
} from "../convex/calendarStatus";
