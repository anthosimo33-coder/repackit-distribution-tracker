/**
 * BONUS PAR VIDÉO FRANCHI APRÈS LE PAIEMENT DE SON CYCLE — où va ce qui reste dû.
 *
 * Une vidéo appartient au cycle de sa PUBLICATION (`cycleIndexOf`), et son bonus
 * par vidéo est gelé au paiement de ce cycle (`video_bonus` ∈ FROZEN_AT_PAYMENT).
 * Rien n'empêche de payer un cycle dès sa fin : ses dernières vidéos sont alors
 * gelées à quelques heures de vie. Cas réel (17/10/2026) : un reel de Juliette
 * publié 1 h 20 avant la fin de son cycle, cycle payé le lendemain sur 5 750 vues
 * (sous le seuil de 10 000), 56 124 vues une semaine plus tard — 40 € perdus.
 *
 * LA RÈGLE, la même que celle du contrat pour les primes de paliers (art. 7.2,
 * « versées à la clôture du cycle suivant ») : l'écart entre le bonus que la
 * vidéo vaut aujourd'hui et ce qui lui a déjà été versé est un COMPLÉMENT, porté
 * par le premier cycle NON PAYÉ qui suit le sien, et gelé à son tour au paiement
 * de ce cycle. Ce qui est payé ne bouge jamais ; un écart ultérieur repasse dans
 * le cycle d'après.
 *
 * ⚠️ LE PREMIER CYCLE NON PAYÉ, PAS « LE CYCLE EN COURS ». Celui qui contient
 * maintenant glisse avec le temps : le jour où l'on solde le cycle clos, le
 * complément aurait déjà sauté dans le suivant — et ainsi de suite, sans jamais
 * être payé. Le premier cycle non payé, lui, reste le même jusqu'à son paiement.
 *
 * ⚠️ LA BORNE : LA FENÊTRE DE PAIE DE LA VIDÉO. Le report ne rattrape que ce qui
 * a GRANDI après un paiement, pendant que la vidéo gagnait encore des vues
 * payables (fenêtre J+30, cf convex/payWindow). Dès qu'un cycle qui la portait a
 * été payé APRÈS la fin de sa fenêtre, son bonus était définitif à ce paiement :
 * elle est RÉGLÉE pour de bon. Sans cette borne, la grille étant lue en direct,
 * attacher ou relever une grille sur un barème rouvrirait toutes ses vidéos déjà
 * payées — exactement ce que la règle « cycles payés figés » interdit.
 *
 * Module PUR (aucun import `_generated`) → testable depuis `lib/` en UNE seule
 * définition, même patron que `convex/settledCycles.ts` et `convex/payWindow.ts`.
 */

import { cyclePeriodKey, cycleWindow, CYCLE_LENGTH_MS } from "./payCycle";

/** Ce qu'on lit d'une row `payments` — rien d'autre n'entre dans la décision. */
export type CarryRow = {
  /** Clé de période : cycle ("YYYY-MM-DD") ou legacy mensuelle ("YYYY-MM"). */
  period: string;
  status: "accruing" | "scheduled" | "paid";
  paidAt?: number;
  lineItems: readonly { assignmentId?: string; kind: string; amount: number }[];
};

/** Les paiements d'UNE créatrice, lus du point de vue du bonus par vidéo. */
export type VideoBonusLedger = {
  /**
   * Instant du paiement du cycle `k` ; `null` s'il n'est pas payé. Un cycle payé
   * SANS date (row d'avant `paidAt`) rend +∞ : on ne sait pas quand il a été
   * réglé, donc on ne rouvre rien sur sa foi.
   */
  paidAtOfCycle: (k: number) => number | null;
  /** Σ des lignes `video_bonus` déjà GELÉES pour cette vidéo, tous cycles payés confondus. */
  paidOf: (assignmentId: string) => number;
  /** Au moins un cycle payé ? (sinon tout se calcule en direct, comme avant) */
  anyPaid: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Le grand livre d'une créatrice. L'appariement d'une row à un cycle passe par
 * l'INDEX recalculé depuis l'ancre (`cyclePeriodKey` tronque au jour) : une row
 * mensuelle legacy ("2026-08") n'a pas la forme d'une clé de cycle et ne peut
 * jamais en apparier un. Ses lignes `video_bonus`, elles, comptent dans
 * `paidOf` : un montant versé reste versé, quel que soit le découpage.
 */
export function videoBonusLedger(
  firstPostAt: number,
  rows: readonly CarryRow[],
): VideoBonusLedger {
  const paidAtByCycle = new Map<number, number>();
  const paid = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== "paid") continue;
    for (const li of r.lineItems) {
      if (li.kind !== "video_bonus" || li.assignmentId === undefined) continue;
      paid.set(li.assignmentId, (paid.get(li.assignmentId) ?? 0) + Math.max(0, li.amount));
    }
    const parsed = Date.parse(r.period);
    if (Number.isNaN(parsed)) continue;
    // La clé est le JOUR (UTC) du début de cycle : elle précède le vrai début
    // d'au plus un jour, l'arrondi retombe donc sur le bon index.
    const k = Math.round((parsed - firstPostAt) / CYCLE_LENGTH_MS);
    if (k < 0 || cyclePeriodKey(cycleWindow(firstPostAt, k).cycleStart) !== r.period) {
      continue;
    }
    paidAtByCycle.set(k, r.paidAt ?? Number.POSITIVE_INFINITY);
  }
  return {
    paidAtOfCycle: (k) => paidAtByCycle.get(k) ?? null,
    paidOf: (id) => round2(paid.get(id) ?? 0),
    anyPaid: paidAtByCycle.size > 0,
  };
}

/**
 * Le cycle qui PORTE le reste éventuel d'une vidéo : le premier cycle non payé
 * après le sien. `null` si son propre cycle n'est pas payé — elle se calcule
 * alors chez elle, en direct, exactement comme avant.
 */
export function videoBonusCarrier(
  ledger: VideoBonusLedger,
  homeCycle: number,
): number | null {
  if (ledger.paidAtOfCycle(homeCycle) === null) return null;
  let k = homeCycle + 1;
  while (ledger.paidAtOfCycle(k) !== null) k += 1;
  return k;
}

/**
 * La vidéo est-elle RÉGLÉE pour de bon — plus aucun complément à attendre ?
 *
 * Oui dès qu'un des cycles qui l'ont portée a été payé APRÈS la fin de sa
 * fenêtre de paie (`payBaseCutoffAt`, cf convex/payWindow `payCutoffAt`) : son
 * cycle de publication, ou l'un des cycles payés qui le suivent sans trou. À cet
 * instant ses vues payables ne bougeaient plus, et le cycle payé alors portait
 * tout ce qui restait dû — le grand livre est complet pour elle.
 *
 * Inutile de vérifier QUI la portait à chaque paiement : tant qu'on n'a rien
 * réglé, tous les paiements vus jusque-là sont antérieurs à la borne, donc le
 * premier qui la dépasse est le plus tardif de la série — celui qui la portait.
 *
 * `payBaseCutoffAt` nul = aucun post rémunéré : aucune vue payable, rien à
 * attendre. Cycle de publication non payé ⇒ `false` (elle vit chez elle).
 */
export function videoBonusIsSettled(
  ledger: VideoBonusLedger,
  homeCycle: number,
  payBaseCutoffAt: number | null,
): boolean {
  if (ledger.paidAtOfCycle(homeCycle) === null) return false;
  if (payBaseCutoffAt === null) return true;
  for (let k = homeCycle; ; k++) {
    const p = ledger.paidAtOfCycle(k);
    if (p === null) return false;
    if (p >= payBaseCutoffAt) return true;
  }
}

/**
 * Coût d'une vidéo AU TITRE DE SON BONUS pour les écrans d'analyse (Rentabilité,
 * onglet Pays, Vue d'ensemble), qui découpent au mois de PUBLICATION :
 *  - cycle pas encore payé (`settled` nul) : le bonus du jour, comme avant ;
 *  - réglée pour de bon : ce qui lui a été versé, et rien d'autre ;
 *  - payée mais encore OUVERTE : le plus haut des deux — ce qu'elle aura touché
 *    une fois le complément versé au cycle suivant. Compté ici, sur SA vidéo, et
 *    nulle part ailleurs : le cycle qui porte le complément ne passe pas par les
 *    mois.
 */
export function videoBonusCostOf(
  live: number,
  settled: { paid: number; open: boolean } | null,
): number {
  if (settled === null) return live;
  return settled.open ? Math.max(settled.paid, live) : settled.paid;
}
