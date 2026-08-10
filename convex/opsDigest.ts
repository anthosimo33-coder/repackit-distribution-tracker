import { missedDays } from "./warmup";

/**
 * PRÉDICATS du digest opérationnel — RÉPLIQUE SERVEUR de `lib/ops-digest.ts`
 * (règle A6 : un module `convex/` ne peut pas importer `lib/`). DOIT rester
 * STRICTEMENT ÉQUIVALENT.
 *
 * Trois notions lues à DEUX endroits — le dashboard admin (client) et le digest
 * quotidien (cron serveur) : missions en retard, cycles de paie, comptes en
 * warmup à la traîne. C'est le vrai risque du chantier — deux versions du même
 * calcul qui divergent avec le temps, chacune ayant l'air juste sur son écran.
 * La parité est verrouillée par `lib/ops-digest.test.ts`, qui importe LES DEUX
 * versions et les compare sur les mêmes jeux de données.
 *
 * Module PUR (aucun import `_generated`). Seule différence admise avec le
 * jumeau : l'origine de `missedDays` (réplique convex/warmup vs lib/warmup —
 * deux répliques que ce même test apparie).
 */

const DAY_MS = 86_400_000;

/**
 * Statuts où la balle est dans le camp de la CRÉATRICE et où la deadline de
 * PRODUCTION court encore.
 *
 * `video_rejected` en est volontairement absent : un refus qui stagne est une
 * situation distincte (la créatrice a un retour à traiter, pas une vidéo à
 * produire), et le dashboard lui réserve déjà sa propre file. L'inclure ici
 * ferait compter deux fois la même mission.
 */
export const PRODUCTION_STATUSES = ["todo", "in_progress"] as const;

export type MissionLike = { status: string; dueDate: number };

/** Deadline de PRODUCTION dépassée, balle au créateur. */
export function isOverdueMission(a: MissionLike, now: number): boolean {
  return (
    (PRODUCTION_STATUSES as readonly string[]).includes(a.status) &&
    a.dueDate < now
  );
}

/** Jours PLEINS de retard sur une échéance (0 si pas en retard). */
export function missionDaysLate(a: MissionLike, now: number): number {
  return Math.max(0, Math.floor((now - a.dueDate) / DAY_MS));
}

export type CycleLike = { status: string; cycleEnd: number; totalDue: number };

/**
 * Cycle NON PAYÉ qui doit de l'argent — la notion du dashboard (« Dû »), qui
 * inclut le cycle EN COURS puisque le montant s'accumule déjà.
 */
export function isCycleUnpaid(c: CycleLike): boolean {
  return c.status !== "paid" && c.totalDue > 0;
}

/**
 * Cycle À PAYER — la notion du DIGEST : non payé, devant de l'argent, ET
 * refermé. Plus étroite que `isCycleUnpaid` à dessein : le cycle en cours n'est
 * pas actionnable, et le faire remonter chaque matin transformerait le digest en
 * bruit quotidien permanent. Les deux notions coexistent nommément plutôt qu'un
 * écart tacite entre l'écran et le message.
 */
export function isCycleDue(c: CycleLike, now: number): boolean {
  return isCycleUnpaid(c) && c.cycleEnd < now;
}

export type WarmupCompteLike = {
  /** Statut EFFECTIF déjà résolu par l'appelant (coercion legacy comprise). */
  effectiveStatus: string;
  warmupStartedAt?: number;
  dailyChecks: string[];
  /** Durée EFFECTIVE (surcharge protocole sinon barème plateforme). */
  targetDays: number;
};

/** Nombre de jours de check manqués sur un compte en warmup. */
export function warmupMissedDays(c: WarmupCompteLike, now: number): number {
  if (c.effectiveStatus !== "warmup" || c.warmupStartedAt === undefined) return 0;
  return missedDays(c.warmupStartedAt, c.dailyChecks, c.targetDays, now);
}

/** Compte en warmup ayant manqué au moins un jour de check. */
export function isWarmupLate(c: WarmupCompteLike, now: number): boolean {
  return warmupMissedDays(c, now) > 0;
}
