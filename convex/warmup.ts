/**
 * P5 — Réplique SERVEUR des helpers warmup (règle A6 : convex/ ne peut pas
 * importer lib/). Doit rester en phase avec lib/warmup.ts (mêmes valeurs, même
 * sémantique UTC). Les tests de référence vivent côté lib (lib/warmup.test.ts).
 *
 * Pas de `export const meta`/fonction Convex ici : module de pures fonctions
 * importé par convex/comptes.ts.
 */

export const WARMUP_TARGET_DAYS = {
  youtube: 3,
  tiktok: 3,
  instagram: 14,
} as const;

type Plateforme = "TikTok" | "Instagram" | "YouTube";

export function defaultTargetDays(plateforme: Plateforme): number {
  switch (plateforme) {
    case "TikTok":
      return WARMUP_TARGET_DAYS.tiktok;
    case "Instagram":
      return WARMUP_TARGET_DAYS.instagram;
    case "YouTube":
      return WARMUP_TARGET_DAYS.youtube;
  }
}

/** Clé de jour "YYYY-MM-DD" en UTC (cf lib/warmup.todayKey). */
export function todayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Le check du jour est-il déjà posé ? */
export function checkedToday(dailyChecks: string[], now: number): boolean {
  return dailyChecks.includes(todayKey(now));
}
