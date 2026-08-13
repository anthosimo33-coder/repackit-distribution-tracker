/**
 * Brief talent — libellé des vidéos d'exemple.
 *
 * À la création d'un brief depuis l'app (`TalentSettingsCard`), chaque exemple
 * était estampillé du titre « Exemple ». Ce n'est pas une saisie d'admin : c'est
 * un PLACEHOLDER écrit en dur, qui s'affichait sous chaque lecteur et n'apprenait
 * rien que la vignette ne dise déjà.
 *
 * Le formulaire ne l'écrit plus. Ce module sert aux briefs DÉJÀ EN BASE, qui le
 * portent : l'écran talent le masque au rendu. Un titre réellement saisi, lui,
 * reste affiché — c'est pourquoi on reconnaît le placeholder au lieu de retirer
 * la légende pour tout le monde.
 *
 * ⚠️ Le jour où plus aucun brief ne porte ce titre, ce module peut disparaître.
 */
export const PLACEHOLDER_EXAMPLE_TITLE = "Exemple";

/** Ce titre est-il le placeholder historique (donc à ne pas afficher) ? */
export function isPlaceholderExampleTitle(
  title: string | null | undefined,
): boolean {
  return (title ?? "").trim() === PLACEHOLDER_EXAMPLE_TITLE;
}
