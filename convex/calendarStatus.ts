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
 * ─── ⚠️ LA JOURNÉE SE TERMINE CHEZ LA CRÉATRICE, PAS À PARIS ────────────────
 * Paris reste le fuseau du PLANIFIÉ (`postDate` y est stocké à minuit), mais
 * plus celui du VERDICT. Une créatrice à New York qui publiait le 8 à 20 h chez
 * elle était comptée « en retard » : il était 2 h du matin le 9 à Paris. Le
 * défaut touchait tout le monde à l'ouest de Paris, tous les soirs.
 *
 * D'où l'asymétrie, qui est VOULUE et doit le rester :
 *   - le jour PRÉVU se lit à Paris — c'est une ÉTIQUETTE (« le 8 »), écrite par
 *     l'équipe à minuit Paris ; la relire ailleurs la décalerait d'un jour ;
 *   - le jour RÉEL de publication et le jour COURANT se lisent chez ELLE — ce
 *     sont des INSTANTS, et la question posée est « sa journée est-elle
 *     finie ? ».
 *
 * `timeZone` absent ⇒ Europe/Paris : le comportement d'avant, pour toute
 * créatrice dont le fuseau est inconnu (aucune supposition faite à sa place).
 *
 * ⚠️ `timeZone: "Europe/Paris"` avec des parties NUMÉRIQUES est prouvé dans le
 * runtime Convex — c'est le correctif #52, et `convex/dateFr.ts` /
 * `analyticsHub.parisDay` en dépendent. Ce sont les NOMS (mois en toutes lettres)
 * qui ne le sont pas, d'où la table en dur de `accountPhase.formatUtcDayFr`.
 * Règle du dépôt : fuseau oui, noms non.
 */

import { dayIndex } from "./creatorDay";

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

/** Fuseau de référence quand celui de la créatrice est INCONNU : celui de
 *  l'équipe. Ne jamais le remplacer par une déduction — ne pas savoir est un
 *  état légitime, et supposer un fuseau produit exactement le faux retard que
 *  ce module vient de corriger. */
const FUSEAU_EQUIPE = "Europe/Paris";

/**
 * Index de jour comparable, DANS LE FUSEAU DONNÉ (Paris si inconnu).
 *
 * ⚠️ Passe par `creatorDay.dayIndex` et NON par `parisDayIndex` : les deux
 * n'encodent pas le mois de la même façon (0-based ici, 1-based là-bas), donc
 * leurs index ne sont PAS comparables entre eux. Tout ce qui se compare dans ce
 * fichier passe par cette fonction-ci — y compris le jour prévu, lu à Paris.
 */
function jourLocal(ms: number, timeZone?: string | null): number {
  return dayIndex(ms, timeZone ?? FUSEAU_EQUIPE);
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

/**
 * ─── LE JOUR PRÉVU EST UNE ÉTIQUETTE ────────────────────────────────────────
 *
 * `postDate` est un INSTANT (minuit Paris) qui représente un JOUR (« le 5 »).
 * Le rendre avec l'horloge du lecteur le déplace : minuit à Paris, c'est 19 h la
 * veille à São Paulo, 18 h la veille à New York — et 23 h la veille à Londres.
 * Une créatrice à l'ouest de Paris lisait donc « le 4 » là où l'équipe avait
 * planifié « le 5 », publiait le 4, et se retrouvait hors date.
 *
 * Ces trois fonctions sont le SEUL chemin autorisé pour lire un jour prévu côté
 * écran : la clé de rangement, la borne de journée, et le libellé. Toutes trois
 * lisent l'étiquette à Paris, donc rendent la même chose pour tout le monde.
 *
 * ⚠️ Ne pas confondre avec le VERDICT (`calendarStatus`), qui lui se prend dans
 * le fuseau de la créatrice : le jour prévu ne se convertit pas, sa journée si.
 */

/** Clé "YYYY-MM-DD" du jour prévu — rangement de calendrier, identique partout. */
export function plannedDayKey(postDate: number): string {
  return PARIS_YMD.format(new Date(postDate));
}

/** Minuit UTC de l'étiquette : support d'arithmétique en jours ET de rendu. */
export function plannedDayStart(postDate: number): number {
  const [y, m, d] = plannedDayKey(postDate).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Libellé du jour prévu dans la langue du lecteur, SANS conversion de fuseau.
 * Les options sont celles d'`Intl.DateTimeFormat` ; `timeZone` est imposé.
 */
export function formatPlannedDay(
  postDate: number,
  locale: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
  },
): string {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: FUSEAU_EQUIPE,
  }).format(new Date(postDate));
}

/**
 * Le jour prévu tombe-t-il sur la journée COURANTE de la créatrice ?
 *
 * Les deux moitiés de la question ne se lisent pas dans le même fuseau, et c'est
 * exactement le point : l'étiquette à Paris, « aujourd'hui » chez elle.
 */
export function isPlannedToday(
  postDate: number,
  now: number,
  timeZone?: string | null,
): boolean {
  return jourLocal(postDate, FUSEAU_EQUIPE) === jourLocal(now, timeZone);
}

export function calendarStatus(input: {
  /** Jour de publication PLANIFIÉ (ms), ou absent → hors calendrier. */
  postDate: number | null | undefined;
  /** Date de publication RÉELLE (ms, = confirmation), ou null si pas publié. */
  postedAt: number | null | undefined;
  /** Horloge injectée (ms). */
  now: number;
  /** Fuseau de la CRÉATRICE — c'est chez elle que la journée se termine.
   *  Absent/inconnu ⇒ Europe/Paris (cf. en-tête du module). */
  timeZone?: string | null;
}): CalendarStatus {
  const { postDate, postedAt, now, timeZone } = input;
  if (postDate == null) return "none";
  // Le jour PRÉVU est une étiquette écrite à minuit Paris → toujours lu à Paris.
  const plannedDay = jourLocal(postDate, FUSEAU_EQUIPE);
  if (postedAt != null) {
    // Publié : à l'heure SEULEMENT si le même jour calendaire CHEZ ELLE
    // (0 tolérance). Publier le 8 à 20 h à New York, c'est le 8.
    return jourLocal(postedAt, timeZone) === plannedDay ? "on_time" : "late";
  }
  // Pas encore publié : manqué quand SA journée est entièrement passée, sinon
  // prévu (le jour même compte comme « prévu » : elle a encore la soirée).
  return jourLocal(now, timeZone) > plannedDay ? "missed" : "scheduled";
}

export const CALENDAR_STATUS_LABEL: Record<CalendarStatus, string> = {
  // i18n-exempt: table jamais rendue — l'affichage passe par status.calendar.* (calendar-status-meta)
  on_time: "À l'heure",
  // i18n-exempt: table jamais rendue — l'affichage passe par status.calendar.* (calendar-status-meta)
  late: "En retard",
  // i18n-exempt: table jamais rendue — l'affichage passe par status.calendar.* (calendar-status-meta)
  missed: "Manqué",
  // i18n-exempt: table jamais rendue — l'affichage passe par status.calendar.* (calendar-status-meta)
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

/** Décompte des statuts d'un lot de posts planifiés, + le taux à l'heure. */
export interface OnTimeTally {
  onTime: number;
  late: number;
  missed: number;
  scheduled: number;
  /** Dénominateur : les posts PASSÉS (cf `isPastPost`). */
  past: number;
  /** `null` si aucun post passé — JAMAIS 0, qui se lirait « taux nul ». */
  rate: number | null;
}

/**
 * Taux à l'heure d'un lot de posts planifiés.
 *
 * Définition UNIQUE, consommée par l'écran calendrier ET par les notifications
 * de retard : le message ne doit pas annoncer un chiffre que l'écran contredit.
 *
 * ⚠️ Les posts SANS `postDate` n'entrent nulle part — ni au numérateur, ni au
 * dénominateur. Le taux mesure donc la ponctualité du PLANIFIÉ, pas de tout le
 * travail ; c'est pour ça que le libellé dit « taux de publication à l'heure ».
 * Le nombre d'assignations hors calendrier est un contrôle de Fiabilité à part.
 */
export function onTimeTally(
  posts: {
    postDate: number | null | undefined;
    postedAt: number | null | undefined;
    /** Fuseau de la créatrice de CE post — un lot peut en mélanger plusieurs
     *  (le taux d'un projet couvre Paris, New York et Los Angeles à la fois). */
    timeZone?: string | null;
  }[],
  now: number,
): OnTimeTally {
  let onTime = 0;
  let late = 0;
  let missed = 0;
  let scheduled = 0;
  let past = 0;
  for (const p of posts) {
    const s = calendarStatus({
      postDate: p.postDate,
      postedAt: p.postedAt,
      now,
      timeZone: p.timeZone,
    });
    if (s === "none") continue;
    if (isPastPost(s)) past++;
    if (s === "on_time") onTime++;
    else if (s === "late") late++;
    else if (s === "missed") missed++;
    else scheduled++;
  }
  return { onTime, late, missed, scheduled, past, rate: past > 0 ? onTime / past : null };
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
  /** Fuseau de la créatrice (cf. calendarStatus). */
  timeZone?: string | null;
}): number | null {
  const { postDate, postedAt, timeZone } = input;
  if (postDate == null || postedAt == null) return null;
  const planned = jourLocal(postDate, FUSEAU_EQUIPE);
  const actual = jourLocal(postedAt, timeZone);
  if (actual <= planned) return null;
  // Différence en JOURS RÉELS : l'index année*10000+mois*100+jour n'est pas
  // soustrayable (du 31/01 au 01/02 il vaut 71). On repasse par des dates —
  // construites depuis les ÉTIQUETTES de jour, donc comparables même quand les
  // deux ne viennent pas du même fuseau.
  return Math.round(
    (utcMidnightOfDayIndex(actual) - utcMidnightOfDayIndex(planned)) /
      86_400_000,
  );
}

/** Minuit UTC du jour porté par un index `jourLocal` (mois 1-based). */
function utcMidnightOfDayIndex(index: number): number {
  const y = Math.floor(index / 10000);
  const m = Math.floor((index % 10000) / 100);
  const d = index % 100;
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
