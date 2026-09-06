/**
 * TRADUCTION d'une fenêtre du hub (jours EUROPE/PARIS) en bornes HogQL (UTC).
 * Logique PURE, testée Vitest.
 *
 * ⚠️ LE PIÈGE DES TROIS HORLOGES. Le sélecteur rend des jours civils PARISIENS
 * (`parisDayKey`), les événements PostHog portent un instant UTC. Le 6 septembre
 * parisien ne commence pas le 6 à 00:00 UTC : il commence la VEILLE à 22:00 UTC
 * en été, à 23:00 en hiver. Traduire naïvement décalerait chaque borne d'une à
 * deux heures, et le hub a déjà payé ce défaut ailleurs (28 % des publications de
 * prod rangées le mauvais jour, cf convex/dateFr.ts).
 *
 * Le décalage n'est PAS une constante : il change au passage à l'heure d'hiver.
 * Il est donc relu pour CHAQUE borne, à sa propre date.
 *
 * La borne haute est EXCLUSIVE et vaut le début du jour SUIVANT : « du 1er au
 * 6 » comprend le 6 en entier. Une borne haute inclusive posée à 00:00 aurait
 * silencieusement amputé le dernier jour.
 */

/** Décalage d'Europe/Paris par rapport à UTC, en minutes, À CETTE DATE. */
function parisOffsetMinutes(utcMs: number): number {
  // `en-CA` + timeZone rend « 2026-09-06, 15:39:00 » : la même horloge lue à
  // Paris. L'écart avec la lecture UTC EST le décalage, sans table de fuseaux.
  const d = new Date(utcMs);
  const paris = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      // `hourCycle: "h23"` et SURTOUT PAS `hour12: false` : ce dernier fait
      // écrire minuit « 24:00:00 » à l'ICU, que `Date` relit comme le
      // lendemain 00:00. Le décalage sortait alors à 26 h et chaque borne
      // reculait d'un jour entier. Le défaut ne se déclenche qu'à minuit —
      // c'est-à-dire à chaque appel de cette fonction.
      hourCycle: "h23",
    })
      .format(d)
      .replace(", ", "T") + "Z",
  );
  return Math.round((paris.getTime() - d.getTime()) / 60000);
}

/**
 * Instant UTC (ms) où commence le jour parisien `day` ("YYYY-MM-DD").
 *
 * UNE seule passe suffit, et c'est démontrable : les bascules d'heure
 * européennes ont lieu à 01:00 UTC, donc TOUJOURS après minuit UTC. Le décalage
 * lu à minuit UTC et celui lu à l'instant corrigé (la veille à 22h ou 23h) sont
 * forcément du même côté de la bascule — vérifié sur les six jours qui entourent
 * les deux changements d'heure de 2026.
 *
 * Une seconde passe de correction avait été écrite ici « pour le jour du
 * basculement ». Elle a été retirée après l'avoir cassée sans faire rougir la
 * moindre assertion : c'était du code mort sous un commentaire faux.
 */
export function parisDayStartMs(day: string): number {
  const naive = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(naive)) return NaN;
  return naive - parisOffsetMinutes(naive) * 60000;
}

/** "YYYY-MM-DD" → jour suivant, en calcul civil pur (aucun fuseau à appliquer). */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Un instant UTC au format que HogQL comprend : 'YYYY-MM-DD hh:mm:ss'. */
export function hogDateTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Le prédicat de fenêtre à injecter dans les requêtes, ou `null` si les jours
 * sont illisibles ou dans le désordre — l'appelant retombe alors sur la fenêtre
 * par défaut plutôt que d'interroger sur des bornes absurdes.
 *
 * `column` existe pour les requêtes d'A/B test, qui doivent borner autre chose
 * que `timestamp` : la date du PREMIER abonnement d'une personne, calculée sur
 * quatre-vingt-dix jours d'historique. Mesuré en prod le 06/09 sur une fenêtre
 * de sept jours : 58 personnes sur 203 ont leur premier abonnement HORS de la
 * fenêtre. Sans cette borne appliquée à la bonne colonne, elles passeraient
 * toutes pour de nouveaux clients de la semaine.
 */
export function hogWindowClause(
  from: string,
  to: string,
  column = "timestamp",
): string | null {
  const start = parisDayStartMs(from);
  const end = parisDayStartMs(nextDay(to));
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return null;
  return `${column} >= toDateTime('${hogDateTime(start)}') AND ${column} < toDateTime('${hogDateTime(end)}')`;
}
