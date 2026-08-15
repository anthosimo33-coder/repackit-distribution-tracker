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
 * `payStartAt` (talents, posée à l'activation) l'emporte sur `firstPostAt`
 * (partenaires et clippeurs, posée au premier post publié). Un talent ne publie
 * jamais : sans cette bascule il n'aurait aucun cycle et serait invisible de la
 * paie.
 *
 * ⚠️ POUR UN PARTENAIRE, L'EXPRESSION DÉGÉNÈRE EXACTEMENT EN CELLE D'AVANT.
 * `payStartAt` n'est posée QUE sur une fiche de talent (cf schema + updateCreator)
 * : chez un partenaire elle est absente, donc `?? firstPostAt` rend la valeur
 * historique, au bit près. Le chemin partenaire est inchangé PAR CONSTRUCTION, pas
 * par relecture — c'est ce qui protège des cycles déjà payés qu'une ancre
 * antérieure au premier post recalerait tous.
 *
 * `undefined` = aucune ancre → aucun cycle (talent pas encore activé, partenaire
 * qui n'a jamais publié).
 */
export function payAnchorOf(creator: {
  payStartAt?: number;
  firstPostAt?: number;
}): number | undefined {
  return creator.payStartAt ?? creator.firstPostAt;
}
