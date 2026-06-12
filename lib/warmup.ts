/**
 * P5 — Warmup créateurs : SOURCE UNIQUE des durées + helpers purs (testables
 * Vitest, `now` injectable). Aucune dépendance Convex ni React.
 *
 * ⚠️ Règle A6 — un module convex/ ne peut pas importer lib/. La logique de
 * décompte/checks est donc répliquée côté serveur dans convex/warmup.ts ; toute
 * évolution ici doit l'être là-bas (et inversement). Les tests vivent ici.
 *
 * lib/compte-status.ts DÉRIVE WARMUP_DURATION_BY_PLATFORM de cette constante —
 * un seul barème dans toute l'app (décision du chantier P5).
 */

/** Durée de warmup (jours) par plateforme. Clés en minuscules (canonique). */
export const WARMUP_TARGET_DAYS = {
  youtube: 3,
  tiktok: 3,
  instagram: 14,
} as const;

export type WarmupPlatformKey = keyof typeof WARMUP_TARGET_DAYS;
export type Plateforme = "TikTok" | "Instagram" | "YouTube";

const DAY_MS = 86_400_000;

/** Plateforme applicative (capitalisée) → clé du barème. */
export function platformKey(plateforme: Plateforme): WarmupPlatformKey {
  switch (plateforme) {
    case "TikTok":
      return "tiktok";
    case "Instagram":
      return "instagram";
    case "YouTube":
      return "youtube";
  }
}

/** Durée par défaut (jours) pour la plateforme — pré-remplit targetDays. */
export function defaultTargetDays(plateforme: Plateforme): number {
  return WARMUP_TARGET_DAYS[platformKey(plateforme)];
}

/**
 * Clé de jour "YYYY-MM-DD" en UTC (déterministe, indépendant du fuseau du
 * client/serveur). Le warmup « tourne » sur la journée UTC — choix assumé pour
 * que client et serveur s'accordent sur « aujourd'hui » sans gérer de TZ.
 */
export function todayKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Nombre de jours pleins écoulés depuis le début du warmup (floor). */
export function daysElapsed(
  warmupStartedAt: number,
  now: number = Date.now(),
): number {
  return Math.floor((now - warmupStartedAt) / DAY_MS);
}

export interface WarmupProgress {
  /** Jour courant 1-indexé, clampé à targetDays (« Jour X / N »). */
  day: number;
  targetDays: number;
  /** true quand la durée cible est atteinte (warmup à valider/terminé). */
  complete: boolean;
}

/** Progression « Jour X / N » + complétion, avec targetDays (override admin). */
export function warmupProgress(
  warmupStartedAt: number,
  targetDays: number,
  now: number = Date.now(),
): WarmupProgress {
  const elapsed = daysElapsed(warmupStartedAt, now);
  return {
    day: Math.min(elapsed + 1, targetDays),
    targetDays,
    complete: elapsed >= targetDays,
  };
}

/** Le check du jour est-il déjà fait ? (todayKey présent dans dailyChecks). */
export function checkedToday(
  dailyChecks: string[],
  now: number = Date.now(),
): boolean {
  return dailyChecks.includes(todayKey(now));
}

/**
 * Jours manqués = jours PLEINEMENT écoulés (aujourd'hui exclu, capé à
 * targetDays) moins le nombre de checks posés. TZ-robuste : ne dérive aucune
 * date depuis warmupStartedAt (1 check/jour étant imposé serveur, le compte de
 * checks suffit). Clampé à 0.
 */
export function missedDays(
  warmupStartedAt: number,
  dailyChecks: string[],
  targetDays: number,
  now: number = Date.now(),
): number {
  const fullDays = Math.min(daysElapsed(warmupStartedAt, now), targetDays);
  return Math.max(0, fullDays - dailyChecks.length);
}

/** Dernier check posé (date "YYYY-MM-DD") ou null. */
export function lastCheck(dailyChecks: string[]): string | null {
  if (dailyChecks.length === 0) return null;
  return [...dailyChecks].sort().at(-1) ?? null;
}
