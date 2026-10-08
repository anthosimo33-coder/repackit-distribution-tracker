/**
 * CHANGER LE BARÈME DE VIDÉOS DÉJÀ ATTRIBUÉES — la partie PURE : quelles vidéos
 * d'une créatrice sont concernées, et pourquoi une vidéo ne l'est pas.
 *
 * Module sans lecture de base (testé par lib/pricing-reassign.test.ts) : le cœur
 * qui lit et écrit est convex/pricingReassign.ts.
 *
 * LE JOUR D'UNE VIDÉO, celui qu'on compare à « à partir du » :
 *   - publiée : le jour (Paris) de sa publication — c'est lui qui la range dans
 *     un cycle de paie ;
 *   - pas publiée : son jour PRÉVU ;
 *   - ni l'un ni l'autre : aujourd'hui — elle ne sortira pas plus tôt.
 *
 * CE QUI N'EST JAMAIS TOUCHÉ (la vidéo est listée, avec la raison) :
 *   - `cycle_paye` : son cycle de paie est payé — le montant y est gelé ;
 *   - `defi` : vidéo de défi, payée par le barème DÉDIÉ du défi ;
 *   - `hors_bareme` : pas de barème (ancien modèle, clip) — elle n'est pas payée
 *     par un barème, en poser un la ferait payer deux fois ;
 *   - `deja` : elle est déjà exactement sur ces termes.
 * Une mission abandonnée n'est pas listée du tout.
 */

import type { Doc } from "./_generated/dataModel";
import type { PricingSnapshot } from "./pricing";
import { cycleIndexOf, cyclePeriodKey, cycleWindow } from "./payCycle";
import { plannedDayKey, representativePostedAt } from "./calendarStatus";
import { parisDayOf } from "./managerCpm";

export type RefusBareme = "cycle_paye" | "defi" | "hors_bareme" | "deja";

export type VideoClassee = {
  a: Doc<"assignments">;
  /** Le jour comparé à la plage demandée, AAAA-MM-JJ (Paris). */
  jour: string;
  publiee: boolean;
  /**
   * Le cycle de paie (ancre `firstPostAt`) où la vidéo est payée : celui de sa
   * publication, ou — pas encore publiée — le cycle en cours, le plus tôt où
   * elle puisse sortir. `null` sans ancre : la créatrice n'a jamais publié.
   */
  cycle: { start: number; end: number } | null;
  refus: RefusBareme | null;
};

/**
 * Deux snapshots portent-ils les mêmes termes ? TOUS les champs lus par la paie,
 * devise et condition de vues comprises (cf payoutGroupKey) : deux snapshots qui
 * ne diffèrent que par l'un d'eux ne sont pas le même barème.
 */
export function memeSnapshot(a: PricingSnapshot, b: PricingSnapshot): boolean {
  return (
    a.pricingId === b.pricingId &&
    a.montantFixe === b.montantFixe &&
    a.nbVideosCible === b.nbVideosCible &&
    a.tauxCPM === b.tauxCPM &&
    (a.seuilVuesFixe ?? 0) === (b.seuilVuesFixe ?? 0) &&
    a.seuilBonusVues === b.seuilBonusVues &&
    a.montantBonus === b.montantBonus &&
    (a.currency ?? null) === (b.currency ?? null)
  );
}

/** Le jour d'une vidéo (cf en-tête) et si elle est publiée. */
export function jourDeLaVideo(
  a: Doc<"assignments">,
  aujourdhui: string,
): { jour: string; publiee: boolean } {
  const publieeLe = representativePostedAt(a);
  if (publieeLe !== null) return { jour: parisDayOf(publieeLe), publiee: true };
  if (a.postDate != null) return { jour: plannedDayKey(a.postDate), publiee: false };
  return { jour: aujourdhui, publiee: false };
}

/** Les paiements PAYÉS d'une créatrice, sous la forme que lit `cycleDeLaVideo`. */
export type Payes = {
  /** Clés de période (`cyclePeriodKey`) — même résolution que `assignmentCycleIsPaid`. */
  periodes: ReadonlySet<string>;
  /**
   * Vidéos citées par une ligne d'un paiement payé (ceinture : un paiement gelé
   * sur une autre période que celle recalculée garde ses vidéos).
   */
  assignments: ReadonlySet<string>;
};

/**
 * Le cycle de paie d'une vidéo (ancre `firstPostAt`) : celui de sa publication,
 * ou — pas encore publiée — le cycle en cours, le plus tôt où elle puisse
 * sortir. `null` sans ancre (la créatrice n'a jamais publié). Et s'il est payé.
 */
export function cycleDeLaVideo(
  a: Doc<"assignments">,
  firstPostAt: number | undefined,
  payes: Payes,
  now: number,
): { cycle: { start: number; end: number } | null; paye: boolean } {
  const ts = representativePostedAt(a) ?? now;
  const w = firstPostAt === undefined ? null : cycleWindow(firstPostAt, cycleIndexOf(firstPostAt, ts));
  const cycle = w === null ? null : { start: w.cycleStart, end: w.cycleEnd };
  return {
    cycle,
    paye: payes.assignments.has(a._id) || (cycle !== null && payes.periodes.has(cyclePeriodKey(cycle.start))),
  };
}

/**
 * Les vidéos d'UNE créatrice dont le jour tombe dans [du, au] (au absent = sans
 * fin), classées par jour, chacune avec sa raison d'être laissée ou `null`.
 */
export function classerVideos(input: {
  assignments: readonly Doc<"assignments">[];
  du: string;
  au: string | null;
  aujourdhui: string;
  now: number;
  firstPostAt: number | undefined;
  payes: Payes;
  cible: PricingSnapshot;
}): VideoClassee[] {
  const { du, au, aujourdhui, now, cible } = input;
  const lignes: { ligne: VideoClassee; tri: number }[] = [];
  for (const a of input.assignments) {
    if (a.status === "cancelled") continue;
    const { jour, publiee } = jourDeLaVideo(a, aujourdhui);
    if (jour < du || (au !== null && jour > au)) continue;
    const { cycle, paye } = cycleDeLaVideo(a, input.firstPostAt, input.payes, now);
    const refus: RefusBareme | null =
      a.challengeId !== undefined
        ? "defi"
        : a.pricingSnapshot === undefined
          ? "hors_bareme"
          : paye
            ? "cycle_paye"
            : memeSnapshot(a.pricingSnapshot, cible)
              ? "deja"
              : null;
    lignes.push({ ligne: { a, jour, publiee, cycle, refus }, tri: representativePostedAt(a) ?? a.postDate ?? now });
  }
  return lignes
    .sort((x, y) => x.ligne.jour.localeCompare(y.ligne.jour) || x.tri - y.tri)
    .map((x) => x.ligne);
}

/** Un jour AAAA-MM-JJ qui existe (le 31/02 n'existe pas). */
export function jourValide(jour: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(jour);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === jour;
}
