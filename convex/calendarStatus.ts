/**
 * Statut CALENDRIER d'un post planifié — à l'heure / en retard / manqué / prévu.
 * DISTINCT du statut de PRODUCTION (`status` : à publier, etc.) : c'est une
 * information CALCULÉE en plus, jamais stockée.
 *
 * AUCUNE TOLÉRANCE (décision cadrée) :
 *  - à l'heure : une publication existe ET le jour de publication = le jour prévu ;
 *  - en retard : une publication existe mais un AUTRE jour (après OU avant) ;
 *  - manqué   : le jour prévu est entièrement passé et AUCUNE publication ;
 *  - prévu    : le jour prévu est aujourd'hui ou futur, pas encore de publication.
 *
 * ─── POURQUOI CE MODULE VIT DANS convex/ ─────────────────────────────────────
 * Module PUR (aucun import `_generated`) → importable par le serveur, le client
 * ET `lib/` pour les tests, en UNE définition. `lib/calendar-status.ts` le
 * ré-exporte. Même patron que `convex/accountPhase.ts` et `convex/postUrlDate.ts`.
 *
 * Il y avait jusqu'ici DEUX définitions de `representativePostedAt` (celle de
 * `lib/` et une réplique A6 dans `convex/assignments.ts`) et DEUX définitions du
 * dénominateur du taux à l'heure (`isPastPost`, exporté et testé mais appelé
 * nulle part, pendant que `AssignmentsCalendar` le réimplémentait en ligne).
 * C'est le motif `digest_warmup_late`, attrapé avant qu'il ne coûte.
 *
 * ─── ⚠️ LE JOUR DE RÉFÉRENCE EST ÉPINGLÉ SUR EUROPE/PARIS ────────────────────
 * L'ancienne version comparait des jours en heure LOCALE, ce qui allait tant que
 * le calcul ne tournait que dans un navigateur d'équipe. Les notifications de
 * retard le font tourner CÔTÉ SERVEUR, où le runtime Convex est en UTC — et
 * `postDate` est stocké à MINUIT PARIS, soit 22:00 UTC la veille en été. Sans
 * épingle, une partie des posts basculerait d'un jour : exactement le défaut que
 * #51/#52/#54 viennent de corriger sur 28 % des publications de prod.
 *
 * Conséquence assumée : un navigateur réglé sur un AUTRE fuseau voit désormais
 * les mêmes statuts que le serveur, et non plus les siens. C'est une correction,
 * et l'écran calendrier l'annonce en clair.
 *
 * ⚠️ `timeZone: "Europe/Paris"` avec des parties NUMÉRIQUES est prouvé dans le
 * runtime Convex — c'est le correctif #52, et `convex/dateFr.ts` /
 * `analyticsHub.parisDay` en dépendent. Ce sont les NOMS (mois en toutes lettres)
 * qui ne le sont pas, d'où la table en dur de `accountPhase.formatUtcDayFr`.
 * Règle du dépôt : fuseau oui, noms non.
 */

export type CalendarStatus =
  | "on_time"
  | "late"
  | "missed"
  | "scheduled"
  | "none"; // pas de date de post planifiée → hors calendrier

/** Formateur épinglé Paris, construit UNE fois (l'instancier par appel coûte). */
const PARIS_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Index de jour PARIS comparable (année*10000 + mois*100 + jour). Monotone.
 *
 * "en-CA" rend "YYYY-MM-DD" : un format ISO, donc découpable sans ambiguïté —
 * contrairement à "fr-FR" qui rendrait "JJ/MM/AAAA" et inverserait les champs.
 */
export function parisDayIndex(ms: number): number {
  const [y, m, d] = PARIS_YMD.format(new Date(ms)).split("-").map(Number);
  return y * 10000 + (m - 1) * 100 + d;
}

/** true si deux instants tombent le MÊME jour calendaire à Paris. */
export function isSameLocalDay(a: number, b: number): boolean {
  return parisDayIndex(a) === parisDayIndex(b);
}

/**
 * Date de publication RÉELLE représentative d'un assignment (= CONFIRMATION,
 * décision cadrée) : la PLUS ANCIENNE date parmi ses cibles (target.publishedAt),
 * sinon le legacy top-level publishedAt, sinon null (pas publié).
 */
export function representativePostedAt(a: {
  targets?: { publishedAt?: number | null }[] | null;
  publishedAt?: number | null;
}): number | null {
  const stamps = (a.targets ?? [])
    .map((t) => t.publishedAt)
    .filter((x): x is number => typeof x === "number");
  if (stamps.length > 0) return Math.min(...stamps);
  return typeof a.publishedAt === "number" ? a.publishedAt : null;
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
  const plannedDay = parisDayIndex(postDate);
  if (postedAt != null) {
    // Publié : à l'heure SEULEMENT si le même jour calendaire (0 tolérance).
    return parisDayIndex(postedAt) === plannedDay ? "on_time" : "late";
  }
  // Pas encore publié : manqué si le jour prévu est ENTIÈREMENT passé, sinon prévu
  // (le jour même compte comme « prévu » : la journée n'est pas terminée).
  return parisDayIndex(now) > plannedDay ? "missed" : "scheduled";
}

export const CALENDAR_STATUS_LABEL: Record<CalendarStatus, string> = {
  on_time: "À l'heure",
  late: "En retard",
  missed: "Manqué",
  scheduled: "Prévu",
  none: "—",
};

/**
 * true si le statut concerne un post PASSÉ — LE dénominateur du taux à l'heure.
 *
 * Définition UNIQUE : `AssignmentsCalendar` et les notifications de retard
 * l'appellent toutes deux. Deux sommes séparées finiraient par ne plus compter la
 * même chose, et l'écran afficherait un taux que le message contredirait.
 */
export function isPastPost(s: CalendarStatus): boolean {
  return s === "on_time" || s === "late" || s === "missed";
}

/**
 * Jours de RETARD d'une publication, ou `null` si elle n'est pas en retard.
 *
 * ⚠️ LE SIGNE, PAS LE STATUT. `calendarStatus` range le publié EN AVANCE dans
 * `late` (prévu le 12, sorti le 10 → « en retard »), ce qui convient à une
 * pastille « hors date » mais pas à un message qui annonce « X jours de retard ».
 * En prod les 15 posts hors date sont TOUS après leur date — mais depuis #51
 * antidater n'est plus qu'un avertissement, donc l'avance est atteignable.
 *
 * Renvoie donc un entier STRICTEMENT positif, ou `null` : pas publié, pas
 * planifié, à l'heure, ou en avance.
 */
export function lateDays(input: {
  postDate: number | null | undefined;
  postedAt: number | null | undefined;
}): number | null {
  const { postDate, postedAt } = input;
  if (postDate == null || postedAt == null) return null;
  const planned = parisDayIndex(postDate);
  const actual = parisDayIndex(postedAt);
  if (actual <= planned) return null;
  // Différence en JOURS RÉELS : l'index année*10000+mois*100+jour n'est pas
  // soustrayable (du 31/01 au 01/02 il vaut 71). On repasse par les dates.
  return Math.round(
    (utcMidnightOfParisDay(postedAt) - utcMidnightOfParisDay(postDate)) /
      86_400_000,
  );
}

/** Minuit UTC du jour PARIS contenant `ms` — support de soustraction en jours. */
function utcMidnightOfParisDay(ms: number): number {
  const [y, m, d] = PARIS_YMD.format(new Date(ms)).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Heure de PARIS (0-23) d'un instant, ou `null` si le runtime ne sait pas la
 * calculer.
 *
 * `null` plutôt qu'un repli sur UTC : l'appelant est un cron horaire qui déclenche
 * l'envoi quand l'heure correspond. Un repli silencieux sur UTC ferait partir le
 * bilan à la mauvaise heure toute l'année ; pire, une comparaison qui échoue
 * « vers vrai » enverrait 24 messages par jour. En cas de doute, on n'envoie pas.
 */
export function parisHour(ms: number): number | null {
  try {
    const h = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(ms));
    const n = Number(h);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
  } catch {
    return null;
  }
}
