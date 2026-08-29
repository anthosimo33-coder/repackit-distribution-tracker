/**
 * COOLDOWN d'un combo de script — la DURÉE, et d'où elle vient.
 *
 * Module PUR (aucun import Convex) : importable par `convex/`, par `lib/` et par
 * le client, comme `convex/hookAvailability.ts` et `convex/graduation.ts`. Il n'y
 * a donc AUCUNE réplique A6 à tenir ici — une seule définition, lue par les trois
 * côtés. C'est délibéré : la durée est un nombre, et deux copies d'un nombre
 * finissent toujours par diverger.
 *
 * ── Ce que le cooldown est, et ce qu'il n'est pas ────────────────────────────
 * Un `comboKey` programmé (ou publié) à moins de N jours d'une date visée n'est
 * pas réattribuable à cette date — même sur un autre compte, même chez une autre
 * créatrice. Passé ce délai il redevient piochable.
 *
 * Ce n'est PAS l'exclusion à vie, qui vit ailleurs (par créatrice × plateforme,
 * cf `lib/script-combo-uniqueness.ts`) et n'est pas concernée par ce réglage :
 * les deux protections se CUMULENT, elles ne se remplacent pas.
 *
 * ── Pourquoi c'est un réglage de PROJET et non une constante ─────────────────
 * Même raisonnement que `projects.warmupTargetDays` : c'est une règle ÉDITORIALE
 * (« à quelle fréquence tolère-t-on de revoir le même script sur le réseau »),
 * pas une constante technique. Elle se règle à l'usage, sans PR, et elle n'a
 * aucune raison d'être la même d'un projet à l'autre.
 *
 * Le réglage agit sur les tirages À VENIR uniquement : les combos déjà attribués
 * sont figés sur leur assignation et ne sont jamais rejugés.
 */

/**
 * Durée de dernier recours, en jours, quand le projet n'en définit pas.
 *
 * 1 jour = « pas deux fois le même script le même jour sur le réseau ». C'est le
 * plancher utile : la valeur précédente (4) vidait le catalogue bien plus vite
 * qu'elle ne protégeait quoi que ce soit — quatre jours de fenêtre coûtent
 * environ quatre fois plus de combos par jour planifié.
 */
export const COMBO_COOLDOWN_DAYS_FALLBACK = 1;

/**
 * 0 est une valeur LÉGITIME : elle désactive le cooldown (la fenêtre devient
 * vide, `Math.abs(écart) < 0` n'est jamais vrai). L'unicité à vie par créatrice
 * continue de s'appliquer — désactiver le cooldown ne rouvre jamais la porte au
 * « même script deux fois chez la même personne ».
 */
export const COMBO_COOLDOWN_DAYS_MIN = 0;
export const COMBO_COOLDOWN_DAYS_MAX = 30;

const DAY_MS = 86_400_000;

/** La forme minimale d'un projet dont on veut lire la durée. */
export type ProjectComboCooldown = {
  comboCooldownDays?: number | null;
};

/**
 * Durée EFFECTIVE du projet, en jours — unique porte d'entrée vers le défaut.
 *
 * `undefined`/`null` ⇒ ce projet ne définit pas de durée et retombe sur le
 * dernier recours. `0` est une valeur DÉFINIE (cooldown désactivé) et n'est
 * donc jamais confondue avec l'absence : c'est tout l'intérêt de ne pas écrire
 * `project.comboCooldownDays || FALLBACK`.
 */
export function comboCooldownDaysOf(project: ProjectComboCooldown): number {
  const d = project.comboCooldownDays;
  return typeof d === "number" ? d : COMBO_COOLDOWN_DAYS_FALLBACK;
}

/** La même durée en millisecondes (fenêtre passée à `hookAvailabilityFor`). */
export function comboCooldownMsOf(project: ProjectComboCooldown): number {
  return comboCooldownDaysOf(project) * DAY_MS;
}

/**
 * Valide une durée saisie par l'admin. `null` = « ce projet ne définit rien »
 * (retour au défaut), et c'est une saisie valide, pas une erreur.
 */
export function assertValidComboCooldownDays(
  days: number | null,
): number | undefined {
  if (days === null) return undefined;
  if (
    !Number.isInteger(days) ||
    days < COMBO_COOLDOWN_DAYS_MIN ||
    days > COMBO_COOLDOWN_DAYS_MAX
  ) {
    throw new Error(
      `Durée de cooldown invalide : un entier entre ${COMBO_COOLDOWN_DAYS_MIN} et ${COMBO_COOLDOWN_DAYS_MAX} jours.`,
    );
  }
  return days;
}
