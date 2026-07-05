/**
 * Cycle de paiement J+30 GLISSANT, ancré sur le 1er post de CHAQUE créateur.
 * Cycle k = [firstPostAt + 30j·k, firstPostAt + 30j·(k+1)) ; k = floor((now −
 * firstPostAt)/30j). PUR + déterministe (`now` injecté) → testé Vitest.
 *
 * Le MONTANT ne change pas : ce module ne fait que DÉCOUPER le temps en fenêtres
 * de 30 j propres au créateur (regroupement des gains + date de prochaine paie).
 *
 * ⚠️ A6 — RÉPLIQUE serveur dans convex/payCycle.ts (un module convex/ ne peut pas
 * importer lib/). Garder les DEUX en phase (CYCLE_LENGTH_MS, calcCycle,
 * cycleIndexOf, cycleWindow, cyclePeriodKey). Les tests de référence vivent ici.
 */

/** Durée d'un cycle en jours (glissant, pas calendaire). */
export const CYCLE_LENGTH_DAYS = 30;

const DAY_MS = 86_400_000;

/** Durée d'un cycle en ms. */
export const CYCLE_LENGTH_MS = CYCLE_LENGTH_DAYS * DAY_MS;

export type PayCycle = {
  /** Index 0-based : 0 = tout premier cycle (dès le 1er post). */
  cycleIndex: number;
  /** Début inclus (ms). */
  cycleStart: number;
  /** Fin exclue (ms) = début du cycle suivant = date de prochaine paie. */
  cycleEnd: number;
};

/**
 * Cycle contenant `now`, relatif à `firstPostAt`. `now` avant `firstPostAt`
 * (ne devrait pas arriver — firstPostAt = 1er post) → cycle 0 (borné à ≥ 0).
 */
export function calcCycle(firstPostAt: number, now: number): PayCycle {
  const elapsed = Math.max(0, now - firstPostAt);
  const cycleIndex = Math.floor(elapsed / CYCLE_LENGTH_MS);
  return cycleWindow(firstPostAt, cycleIndex);
}

/** Index (0-based) du cycle contenant `ts`. */
export function cycleIndexOf(firstPostAt: number, ts: number): number {
  return Math.floor(Math.max(0, ts - firstPostAt) / CYCLE_LENGTH_MS);
}

/** Fenêtre [start, end) d'un cycle d'index donné. */
export function cycleWindow(
  firstPostAt: number,
  cycleIndex: number,
): PayCycle {
  const cycleStart = firstPostAt + cycleIndex * CYCLE_LENGTH_MS;
  return { cycleIndex, cycleStart, cycleEnd: cycleStart + CYCLE_LENGTH_MS };
}

/**
 * Clé de période STABLE d'un cycle = date de début en ISO "YYYY-MM-DD" (UTC,
 * triable lexicographiquement). Sert de clé (créateur, cycle) pour la row de
 * paiement gelée au marquage payé (cf convex/payments).
 */
export function cyclePeriodKey(cycleStart: number): string {
  return new Date(cycleStart).toISOString().slice(0, 10);
}

/**
 * Libellé d'un cycle « 5 juil – 3 août 2026 » (dernier jour INCLUS = cycleEnd −
 * 1 j). UTC pour rester déterministe (ne dépend pas du fuseau du navigateur).
 */
export function formatCycleRange(cycleStart: number, cycleEnd: number): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  };
  const start = new Date(cycleStart).toLocaleDateString("fr-FR", opts);
  const end = new Date(cycleEnd - DAY_MS).toLocaleDateString("fr-FR", {
    ...opts,
    year: "numeric",
  });
  return `${start} – ${end}`;
}
