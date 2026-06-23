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
 *
 * ⚠️ Chantier B — la PROGRESSION se compte en NOMBRE DE CHECKS RÉELLEMENT POSÉS
 * (dailyChecks.length), PAS en jours calendaires. Un compte n'est "chaud"
 * (isWarmupComplete) qu'après N checks effectifs ; rater un jour ne fait JAMAIS
 * avancer le compteur, la fin du warmup se décale d'autant. `daysElapsed` /
 * `missedDays` restent calendaires mais servent uniquement à la COMPLIANCE admin
 * (jours manqués), jamais à la complétion.
 */

/**
 * Durée de warmup (jours) par plateforme. Clés en minuscules (canonique).
 * TikTok/YouTube portés à 7 (était 3) ; Instagram reste 14. La durée est FIGÉE
 * sur warmupProtocol.targetDays au DÉMARRAGE du warmup (declareCompte /
 * createCompte / restartWarmup), donc changer ce barème n'affecte QUE les
 * nouveaux warmups — les warmups en cours conservent leur targetDays figé.
 */
export const WARMUP_TARGET_DAYS = {
  youtube: 7,
  tiktok: 7,
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
  /** Jour courant 1-indexé = prochain check à faire, clampé à targetDays. */
  day: number;
  targetDays: number;
  /** true quand assez de checks réels ont été posés (warmup à valider/terminé). */
  complete: boolean;
}

/**
 * Progression « Jour X / N » fondée sur les CHECKS RÉELS (chantier B, ≠ calendaire) :
 * `checksDone` = nb de jours distincts cochés (dailyChecks.length). day = prochain
 * check à faire (checksDone + 1, plafonné à targetDays) ; complete dès que
 * checksDone atteint targetDays. Rater un jour calendaire n'avance PAS checksDone.
 */
export function warmupProgress(
  checksDone: number,
  targetDays: number,
): WarmupProgress {
  return {
    day: Math.min(checksDone + 1, targetDays),
    targetDays,
    complete: checksDone >= targetDays,
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

// ─── Chantier B — modèle "compteur de checks réels" (fonctions PURES) ─────────

type CompteStatusLike = "warmup" | "actif" | "shadowban" | "archived";
type WarmupProtocolLike =
  | { targetDays?: number; dailyChecks?: string[] }
  | null
  | undefined;

/** Forme minimale d'un compte pour les helpers de warmup (chantier B/C). */
export interface WarmupCompteLike {
  plateforme: Plateforme;
  warmupProtocol?: WarmupProtocolLike;
}

/**
 * Durée de warmup EFFECTIVE : surcharge admin (warmupProtocol.targetDays) sinon
 * barème plateforme. Source unique des durées — lib/compte-status délègue ici.
 */
export function effectiveTargetDays(c: WarmupCompteLike): number {
  return c.warmupProtocol?.targetDays ?? defaultTargetDays(c.plateforme);
}

/** Nb de checks distincts réellement posés = PROGRESSION réelle du warmup. */
export function checksCompleted(c: WarmupCompteLike): number {
  return c.warmupProtocol?.dailyChecks?.length ?? 0;
}

/**
 * Warmup TERMINÉ = N checks réels atteints (checksCompleted ≥ durée effective).
 * PUR et indépendant du calendrier : rater un jour ne le fait jamais basculer à
 * true. Réutilisé par le chantier C (multi-plateforme).
 */
export function isWarmupComplete(c: WarmupCompteLike): boolean {
  return checksCompleted(c) >= effectiveTargetDays(c);
}

/**
 * Compte DISPONIBLE pour publier (chantier C) : "actif" (warmup déjà validé) OU
 * en warmup dont le warmup est terminé (assez de checks). shadowban / archived →
 * indisponible. Coercion legacy du status identique à
 * lib/compte-status.getEffectiveStatus / convex/comptes.effectiveStatus.
 */
export function isAccountAvailable(
  c: WarmupCompteLike & { status?: CompteStatusLike; actif?: boolean },
): boolean {
  const status = c.status ?? (c.actif === false ? "archived" : "actif");
  if (status === "actif") return true;
  if (status === "warmup") return isWarmupComplete(c);
  return false;
}

/**
 * Check DÛ aujourd'hui ? = warmup non terminé ET pas encore coché aujourd'hui
 * (jour UTC courant). Un jour manqué ne disparaît pas : tant que le warmup n'est
 * pas terminé, il reste un check à faire chaque jour jusqu'à atteindre N.
 */
export function mustCheckToday(
  c: WarmupCompteLike,
  now: number = Date.now(),
): boolean {
  if (isWarmupComplete(c)) return false;
  return !checkedToday(c.warmupProtocol?.dailyChecks ?? [], now);
}
