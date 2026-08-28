/**
 * P5 — Réplique SERVEUR des helpers warmup (règle A6 : convex/ ne peut pas
 * importer lib/). Doit rester en phase avec lib/warmup.ts (mêmes valeurs, même
 * sémantique UTC). Les tests de référence vivent côté lib (lib/warmup.test.ts).
 *
 * Pas de `export const meta`/fonction Convex ici : module de pures fonctions
 * importé par convex/comptes.ts.
 */

// Réplique de lib/warmup (A6). Barème de DERNIER RECOURS : la durée de warmup
// est une règle PRODUIT par projet (projects.warmupTargetDays), pas une
// constante de l'app. Durée figée au démarrage du warmup → changement non
// rétroactif sur les warmups en cours.
export const WARMUP_TARGET_DAYS_FALLBACK = {
  youtube: 7,
  tiktok: 7,
  instagram: 14,
} as const;

type Plateforme = "TikTok" | "Instagram" | "YouTube";

export type WarmupTargetDays = {
  tiktok: number;
  instagram: number;
  youtube: number;
};

/**
 * Barème effectif d'un projet — unique porte d'entrée vers le défaut.
 *
 * Repli CHAMP PAR CHAMP : un projet ne définit que les plateformes de son
 * périmètre (Snytch ne fait pas de YouTube), les autres retombent sur le
 * dernier recours. Donner une valeur à une plateforme hors périmètre
 * affirmerait une règle qui n'existe pas.
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

/**
 * Durée par défaut de la plateforme DANS CE PROJET.
 *
 * ⚠️ `days` est OBLIGATOIRE : un site d'écriture oublié doit casser le
 * typecheck, pas figer 7 en silence (cf lib/warmup, même contrat).
 */
export function defaultTargetDays(
  plateforme: Plateforme,
  days: WarmupTargetDays,
): number {
  switch (plateforme) {
    case "TikTok":
      return days.tiktok;
    case "Instagram":
      return days.instagram;
    case "YouTube":
      return days.youtube;
  }
}

/** Clé de jour "YYYY-MM-DD" en UTC (cf lib/warmup.todayKey). */
export function todayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

/** Jours pleins écoulés depuis le début du warmup (réplique de lib/warmup.daysElapsed). */
export function daysElapsed(warmupStartedAt: number, now: number): number {
  return Math.floor((now - warmupStartedAt) / DAY_MS);
}

/**
 * Jours manqués — RÉPLIQUE de lib/warmup.missedDays (A6). Jours pleinement
 * écoulés (aujourd'hui exclu, capé à targetDays) moins les checks posés,
 * clampé à 0. TZ-robuste : ne dérive aucune date depuis warmupStartedAt.
 *
 * Parité verrouillée par lib/ops-digest.test.ts, qui compare les deux versions
 * à travers isWarmupLate.
 */
export function missedDays(
  warmupStartedAt: number,
  dailyChecks: string[],
  targetDays: number,
  now: number,
): number {
  const fullDays = Math.min(daysElapsed(warmupStartedAt, now), targetDays);
  return Math.max(0, fullDays - dailyChecks.length);
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
export function effectiveTargetDays(
  c: WarmupCompteLike,
  days: WarmupTargetDays,
): number {
  return c.warmupProtocol?.targetDays ?? defaultTargetDays(c.plateforme, days);
}

/** Nb de checks distincts réellement posés. */
export function checksCompleted(c: WarmupCompteLike): number {
  return c.warmupProtocol?.dailyChecks?.length ?? 0;
}

/** Warmup terminé = N checks réels atteints (≠ calendaire). */
export function isWarmupComplete(
  c: WarmupCompteLike,
  days: WarmupTargetDays,
): boolean {
  return checksCompleted(c) >= effectiveTargetDays(c, days);
}

/** Check dû aujourd'hui : warmup non terminé ET pas coché aujourd'hui (UTC). */
export function mustCheckToday(
  c: WarmupCompteLike,
  days: WarmupTargetDays,
  now: number,
): boolean {
  if (isWarmupComplete(c, days)) return false;
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
  days: WarmupTargetDays,
  opts?: { strict?: boolean },
): boolean {
  const status = c.status ?? (c.actif === false ? "archived" : "actif");
  if (status === "actif") return true;
  if (status === "warmup")
    return opts?.strict ? false : isWarmupComplete(c, days);
  return false;
}
