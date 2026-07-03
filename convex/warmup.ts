/**
 * P5 — Réplique SERVEUR des helpers warmup (règle A6 : convex/ ne peut pas
 * importer lib/). Doit rester en phase avec lib/warmup.ts (mêmes valeurs, même
 * sémantique UTC). Les tests de référence vivent côté lib (lib/warmup.test.ts).
 *
 * Pas de `export const meta`/fonction Convex ici : module de pures fonctions
 * importé par convex/comptes.ts.
 */

// TikTok/YouTube portés à 7 (était 3) ; Instagram reste 14. Réplique de
// lib/warmup.WARMUP_TARGET_DAYS (A6). Durée figée au démarrage du warmup →
// changement non rétroactif sur les warmups en cours.
export const WARMUP_TARGET_DAYS = {
  youtube: 7,
  tiktok: 7,
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

// ─── Chantier B — progression par CHECKS RÉELS (réplique de lib/warmup) ───────

type WarmupCompteLike = {
  plateforme: Plateforme;
  warmupProtocol?: { targetDays?: number; dailyChecks?: string[] } | null;
};

/** Durée effective : surcharge protocole sinon barème plateforme. */
export function effectiveTargetDays(c: WarmupCompteLike): number {
  return c.warmupProtocol?.targetDays ?? defaultTargetDays(c.plateforme);
}

/** Nb de checks distincts réellement posés. */
export function checksCompleted(c: WarmupCompteLike): number {
  return c.warmupProtocol?.dailyChecks?.length ?? 0;
}

/** Warmup terminé = N checks réels atteints (≠ calendaire). */
export function isWarmupComplete(c: WarmupCompteLike): boolean {
  return checksCompleted(c) >= effectiveTargetDays(c);
}

/** Check dû aujourd'hui : warmup non terminé ET pas coché aujourd'hui (UTC). */
export function mustCheckToday(c: WarmupCompteLike, now: number): boolean {
  if (isWarmupComplete(c)) return false;
  return !checkedToday(c.warmupProtocol?.dailyChecks ?? [], now);
}

type CompteStatusLike = "warmup" | "actif" | "shadowban" | "archived";

/**
 * Compte DISPONIBLE pour publier (réplique de lib/warmup.isAccountAvailable,
 * chantier C). shadowban / archived → toujours indisponible. Coercion legacy du
 * status identique à convex/comptes.effectiveStatus.
 *
 * Deux régimes selon `opts.strict` :
 *   - LENIENT (défaut) : "actif" OU warmup TERMINÉ (assez de checks). Régime
 *     historique, conservé pour les projets hors Snytch (ne PAS changer le
 *     gating RepackIt).
 *   - STRICT : "actif" UNIQUEMENT. Un warmup terminé mais pas encore validé par
 *     l'admin n'est PAS disponible → le passage "actif" devient un VRAI gate.
 *     Passé strict:true uniquement pour le projet Snytch (cf isSnytchProject).
 */
export function isAccountAvailable(
  c: WarmupCompteLike & { status?: CompteStatusLike; actif?: boolean },
  opts?: { strict?: boolean },
): boolean {
  const status = c.status ?? (c.actif === false ? "archived" : "actif");
  if (status === "actif") return true;
  if (status === "warmup") return opts?.strict ? false : isWarmupComplete(c);
  return false;
}
