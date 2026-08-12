/**
 * COMPTE EN CHAUFFE SANS TALENT APPARIÉ — le signal qui doit arriver À TEMPS.
 *
 * Module PUR (aucun import `_generated`) → une seule définition, consommée par le
 * digest (serveur) ET par le dashboard admin (client). Même patron que
 * `convex/accountPhase.ts`.
 *
 * ─── POURQUOI PENDANT, ET PAS APRÈS ──────────────────────────────────────────
 * Un compte tourne trois jours de chauffe. Si aucun talent n'est apparié à son
 * clippeur d'ici la sortie, le compte sort sans rien à publier et les trois jours
 * sont perdus — on ne les rattrape pas, on recommence.
 *
 * Le signal se déclenche donc PENDANT la chauffe, seul moment où apparier sert
 * encore à quelque chose. Un signal « ce compte est sorti de chauffe sans talent »
 * serait un constat de dégât, pas une alerte.
 *
 * ⚠️ Ne concerne QUE les comptes de clippeur. La phase est dérivée d'une date
 * (`accountPhase`), modèle qui ne s'applique pas aux partenaires (arbitrage D3) :
 * l'appelant filtre la population AVANT d'arriver ici.
 */

import { accountPhaseAt, type AccountPhase } from "./accountPhase";

const DAY_MS = 86_400_000;

/** Premier jour de la phase qui SUIT la chauffe — cf PHASE_TABLE (`warmup`, J4). */
const FIRST_DAY_AFTER_CHAUFFE = 4;

export interface ChauffeInput {
  /** Ancre de phase du compte. Absent = pas encore validé → aucun signal. */
  validatedAt: number | null | undefined;
  /** Nombre de talents appariés au clippeur PROPRIÉTAIRE du compte. */
  talentCount: number;
}

/**
 * Ce compte est-il en train de brûler sa chauffe ?
 *
 * Un compte NON VALIDÉ ne signale rien : son parcours n'a pas commencé, il est
 * dans la file de validation et c'est cette file qui porte l'action.
 */
export function isChauffeSansTalent(
  input: ChauffeInput,
  at: number,
): boolean {
  if (input.talentCount > 0) return false;
  return accountPhaseAt(input.validatedAt, at) === "chauffe";
}

/**
 * Date de SORTIE de chauffe (instant où commence le premier jour hors chauffe),
 * pour l'écrire en clair : « en chauffe jusqu'au 13 août ». `null` hors chauffe.
 *
 * C'est la SOURCE des deux affichages : le compte à rebours en dérive plutôt que
 * de recalculer sa propre borne. Une première version les calculait séparément et
 * elles divergeaient d'un jour — l'écran aurait annoncé « 1 jour restant » à côté
 * d'une date à deux jours. Le test de cohérence les tient désormais ensemble.
 */
export function sortieDeChauffeAt(
  validatedAt: number | null | undefined,
  at: number,
): number | null {
  if (accountPhaseAt(validatedAt, at) !== "chauffe") return null;
  return (validatedAt as number) + (FIRST_DAY_AFTER_CHAUFFE - 1) * DAY_MS;
}

/**
 * Jours ENTIERS avant la sortie de chauffe, DÉRIVÉ de `sortieDeChauffeAt`.
 *
 * Rend `null` si le compte n'est pas en chauffe : afficher « 0 jour restant » sur
 * un compte déjà sorti se lirait comme une urgence alors que c'est un constat.
 */
export function joursAvantSortieDeChauffe(
  validatedAt: number | null | undefined,
  at: number,
): number | null {
  const sortie = sortieDeChauffeAt(validatedAt, at);
  if (sortie === null) return null;
  return Math.max(0, Math.ceil((sortie - at) / DAY_MS));
}

/** Phase lisible d'un compte de clippeur, ou `null` (non validé / non clippeur). */
export function phaseOfClipperAccount(
  validatedAt: number | null | undefined,
  at: number,
): AccountPhase | null {
  return accountPhaseAt(validatedAt, at);
}
