/**
 * Cycle de paiement J+30 GLISSANT — RÉPLIQUE SERVEUR de lib/pay-cycle (règle A6 :
 * un module convex/ ne peut pas importer lib/). DOIT rester identique (mêmes
 * valeurs, même sémantique). Les tests de référence vivent côté lib
 * (lib/pay-cycle.test.ts). Pas de fonction Convex ici : pures fonctions importées
 * par convex/payments.ts + convex/pricing.ts.
 */

const DAY_MS = 86_400_000;

/** Durée d'un cycle (30 j glissants). */
export const CYCLE_LENGTH_MS = 30 * DAY_MS;

export type PayCycle = {
  cycleIndex: number;
  cycleStart: number;
  cycleEnd: number;
};

/** Fenêtre [start, end) d'un cycle d'index donné. */
export function cycleWindow(firstPostAt: number, cycleIndex: number): PayCycle {
  const cycleStart = firstPostAt + cycleIndex * CYCLE_LENGTH_MS;
  return { cycleIndex, cycleStart, cycleEnd: cycleStart + CYCLE_LENGTH_MS };
}

/** Cycle contenant `now` (borné à ≥ 0 si `now` < firstPostAt). */
export function calcCycle(firstPostAt: number, now: number): PayCycle {
  return cycleWindow(firstPostAt, cycleIndexOf(firstPostAt, now));
}

/** Index (0-based) du cycle contenant `ts`. */
export function cycleIndexOf(firstPostAt: number, ts: number): number {
  return Math.floor(Math.max(0, ts - firstPostAt) / CYCLE_LENGTH_MS);
}

/** Clé de période STABLE d'un cycle = date de début ISO "YYYY-MM-DD" (UTC). */
export function cyclePeriodKey(cycleStart: number): string {
  return new Date(cycleStart).toISOString().slice(0, 10);
}

/**
 * ANCRE DE CYCLE d'un créateur — la date depuis laquelle ses cycles se comptent.
 *
 * `firstPostAt`, et RIEN D'AUTRE : les cycles J+30 regroupent des publications,
 * ils démarrent donc au premier post publié. C'est l'expression historique,
 * exactement celle d'avant le chantier talent/clippeur.
 *
 * ⚠️ `payStartAt` ne participe PLUS. Elle l'a fait le temps où le forfait talent
 * était en cycles de 30 jours ; il est désormais au MOIS CALENDAIRE (arbitrage
 * B3 — 30 jours fixes produisaient 12,17 échéances par an) et vit dans
 * `convex/talentPay.ts`, un chemin de lecture séparé. Un talent n'a donc plus
 * aucun cycle : il ne publie jamais, `firstPostAt` reste vide chez lui, et
 * `cyclePaymentsForCreator` rend `[]`.
 *
 * La fonction est CONSERVÉE plutôt qu'inlinée : elle nomme la notion et garde un
 * seul endroit à relire le jour où l'ancre changerait encore.
 *
 * `undefined` = aucun post publié → aucun cycle.
 */
export function payAnchorOf(creator: {
  firstPostAt?: number;
}): number | undefined {
  return creator.firstPostAt;
}
