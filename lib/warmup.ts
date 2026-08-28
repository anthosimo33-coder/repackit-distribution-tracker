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
 * Barème de DERNIER RECOURS, quand un projet n'a pas fixé le sien.
 *
 * ⚠️ Ce n'est PLUS « le barème de l'app ». La durée de warmup est une règle
 * PRODUIT qui diffère d'un projet à l'autre : Snytch chauffe 3 jours sur TikTok
 * comme sur Instagram, RepackIt 7/14/7. Le 2026-06-23, le commit d1265cb a porté
 * TikTok et YouTube de 3 à 7 pour TOUT LE MONDE — une décision RepackIt qui a
 * silencieusement changé la règle de Snytch, et fait attendre ses créatrices
 * quatre jours de trop par compte pendant deux mois. C'est ce que le champ
 * `projects.warmupTargetDays` empêche de reproduire.
 *
 * La durée reste FIGÉE sur warmupProtocol.targetDays au DÉMARRAGE du warmup :
 * changer un barème n'affecte que les warmups À VENIR, jamais ceux en cours.
 */
export const WARMUP_TARGET_DAYS_FALLBACK = {
  youtube: 7,
  tiktok: 7,
  instagram: 14,
} as const;

export type WarmupPlatformKey = keyof typeof WARMUP_TARGET_DAYS_FALLBACK;
export type Plateforme = "TikTok" | "Instagram" | "YouTube";

/** Barème d'un projet : les trois plateformes, en jours. */
export type WarmupTargetDays = Record<WarmupPlatformKey, number>;

/**
 * Barème EFFECTIF d'un projet : le sien s'il en a un, le dernier recours sinon.
 * Unique porte d'entrée vers le défaut — c'est ce qui rend l'oubli impossible.
 */
export function warmupTargetDaysOf(project: {
  warmupTargetDays?: Partial<WarmupTargetDays> | null;
}): WarmupTargetDays {
  const p = project.warmupTargetDays ?? {};
  return {
    tiktok: p.tiktok ?? WARMUP_TARGET_DAYS_FALLBACK.tiktok,
    instagram: p.instagram ?? WARMUP_TARGET_DAYS_FALLBACK.instagram,
    youtube: p.youtube ?? WARMUP_TARGET_DAYS_FALLBACK.youtube,
  };
}

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

/**
 * Durée par défaut (jours) pour la plateforme DANS CE PROJET — pré-remplit
 * targetDays au démarrage d'un warmup.
 *
 * ⚠️ `days` est OBLIGATOIRE, et c'est le cœur du correctif. Avec un paramètre
 * optionnel replié sur un barème global, un site d'écriture oublié aurait
 * continué à figer 7 EN SILENCE : pas d'erreur, pas de test rouge, juste des
 * créatrices qui attendent. Obligatoire, un oubli casse le typecheck.
 */
export function defaultTargetDays(
  plateforme: Plateforme,
  days: WarmupTargetDays,
): number {
  return days[platformKey(plateforme)];
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
 * Durée de warmup EFFECTIVE d'un compte.
 *
 * La valeur FIGÉE au démarrage (`warmupProtocol.targetDays`) fait foi : c'est
 * elle que le décompte suit, et changer le barème d'un projet ne doit pas
 * déplacer la cible d'un warmup déjà commencé.
 *
 * `days` ne sert donc QUE de repli, pour un compte sans protocole — un cas que
 * les cinq chemins d'écriture rendent impossible en warmup. Il est malgré tout
 * OBLIGATOIRE : c'est ce qui interdit à un appelant de retomber en douce sur un
 * barème global qui n'est pas celui de son projet.
 */
export function effectiveTargetDays(
  c: WarmupCompteLike,
  days: WarmupTargetDays,
): number {
  return c.warmupProtocol?.targetDays ?? defaultTargetDays(c.plateforme, days);
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
export function isWarmupComplete(
  c: WarmupCompteLike,
  days: WarmupTargetDays,
): boolean {
  return checksCompleted(c) >= effectiveTargetDays(c, days);
}

/**
 * Compte DISPONIBLE pour publier (chantier C). shadowban / archived →
 * indisponible. Coercion legacy du status identique à
 * lib/compte-status.getEffectiveStatus / convex/comptes.effectiveStatus.
 *
 * Réplique EXACTE de convex/warmup.isAccountAvailable (A6). Deux régimes :
 *   - LENIENT (défaut) : "actif" OU warmup TERMINÉ. Régime historique, conservé
 *     hors Snytch (gating RepackIt inchangé).
 *   - STRICT (opts.strict) : "actif" UNIQUEMENT — le passage actif par l'admin
 *     devient un vrai gate. Réservé au projet Snytch côté serveur.
 */
export function isAccountAvailable(
  c: WarmupCompteLike & { status?: CompteStatusLike; actif?: boolean },
  days: WarmupTargetDays,
  opts?: { strict?: boolean },
): boolean {
  const status = c.status ?? (c.actif === false ? "archived" : "actif");
  if (status === "actif") return true;
  if (status === "warmup") return opts?.strict ? false : isWarmupComplete(c, days);
  return false;
}

/**
 * Check DÛ aujourd'hui ? = warmup non terminé ET pas encore coché aujourd'hui
 * (jour UTC courant). Un jour manqué ne disparaît pas : tant que le warmup n'est
 * pas terminé, il reste un check à faire chaque jour jusqu'à atteindre N.
 */
export function mustCheckToday(
  c: WarmupCompteLike,
  days: WarmupTargetDays,
  now: number = Date.now(),
): boolean {
  if (isWarmupComplete(c, days)) return false;
  return !checkedToday(c.warmupProtocol?.dailyChecks ?? [], now);
}
