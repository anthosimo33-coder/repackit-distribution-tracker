/**
 * Normalisation date de `datePromoStart` — RÉPLIQUE SERVEUR de `lib/promo-date.ts`
 * (règle A6). `floorToUtcMidnight` DOIT rester identique. Cf lib pour le pourquoi
 * (TZ-safe, même référentiel que datePubli).
 */

const DAY_MS = 86_400_000;

/** Ramène un ms à minuit UTC de son jour UTC (no-op si déjà minuit UTC). */
export function floorToUtcMidnight(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}
