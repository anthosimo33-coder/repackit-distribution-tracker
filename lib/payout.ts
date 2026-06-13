/**
 * P9 — date de paie. Pur + testé Vitest (`now` injectable, déterministe).
 *
 * Le projet définit un `payoutDay` (jour du mois, 1-28 côté admin mais on gère
 * 1-31 défensivement). On raisonne en UTC (cohérent avec periodOf/warmup) :
 * les bords de mois (payoutDay > nb de jours du mois, ex. 31 en février) sont
 * clampés au dernier jour du mois.
 *
 * Calculé CÔTÉ CLIENT (les pages créateur importent lib/) → pas de réplique
 * convex nécessaire (règle A6 non déclenchée).
 */

/** Nombre de jours du mois `month` (0-11) de l'année `year` (UTC). */
function daysInMonth(year: number, month: number): number {
  // Le jour 0 du mois suivant = dernier jour du mois courant.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Prochaine occurrence du jour de paie (timestamp ms, minuit UTC).
 *
 * - Si le jour de paie de CE mois n'est pas encore passé (aujourd'hui ≤ jour de
 *   paie clampé) → ce mois-ci. Sinon → le mois suivant.
 * - payoutDay clampé au dernier jour du mois cible (ex. 31 en février → 28/29).
 */
export function nextPayoutDate(
  payoutDay: number,
  now: number = Date.now(),
): number {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-11
  const today = d.getUTCDate();

  const clampedThis = Math.min(payoutDay, daysInMonth(year, month));
  if (today <= clampedThis) {
    return Date.UTC(year, month, clampedThis);
  }
  // Mois suivant (avec rollover d'année).
  const nextMonthIdx = month + 1;
  const ny = year + Math.floor(nextMonthIdx / 12);
  const nm = nextMonthIdx % 12;
  const clampedNext = Math.min(payoutDay, daysInMonth(ny, nm));
  return Date.UTC(ny, nm, clampedNext);
}

/** Période d'accrual "YYYY-MM" → libellé lisible « juin 2026 ». */
export function formatPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
}

/** Nombre de jours pleins entre `now` et la prochaine paie (≥ 0). */
export function daysUntilPayout(
  payoutDay: number,
  now: number = Date.now(),
): number {
  const DAY = 86_400_000;
  // On compare des minuits UTC pour un décompte calendaire stable.
  const d = new Date(now);
  const todayMidnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
  );
  return Math.max(0, Math.round((nextPayoutDate(payoutDay, now) - todayMidnight) / DAY));
}
