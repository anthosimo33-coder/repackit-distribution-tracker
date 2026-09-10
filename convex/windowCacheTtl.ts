import { parisDayKey } from "./viewsDaily";

/**
 * DURÉE DE VIE du cache des agrégats PostHog recalculés sur une plage libre.
 *
 * Module PUR (aucun import serveur) pour être testable sans monter Convex — la
 * règle tient en une ligne mais elle porte le piège habituel du dépôt : le
 * sélecteur de période rend des jours PARISIENS, et le runtime Convex tourne en
 * UTC. Comparer `to` à « aujourd'hui » vu d'UTC ferait, chaque soir entre 22 h
 * et minuit, passer la plage du jour pour une plage passée — donc figée 24 h
 * alors qu'elle est encore en train de se remplir.
 */

/** Une plage entièrement passée : ses événements sont ingérés, ils ne bougeront plus. */
export const TTL_PASSE_MS = 24 * 60 * 60 * 1000;

/** Une plage qui touche aujourd'hui : cadence du reste du hub, dont le cron est horaire. */
export const TTL_EN_COURS_MS = 60 * 60 * 1000;

/**
 * TTL applicable à une plage dont la borne haute est `to` (« YYYY-MM-DD »,
 * jour parisien), évaluée à l'instant `now`.
 */
export function windowCacheTtlMs(to: string, now: number): number {
  return to < parisDayKey(now) ? TTL_PASSE_MS : TTL_EN_COURS_MS;
}

/** Clé de cache d'une plage — les jours parisiens tels que le sélecteur les donne. */
export function windowCacheKey(from: string, to: string): string {
  return `${from}|${to}`;
}
