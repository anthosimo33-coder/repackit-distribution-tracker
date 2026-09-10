/**
 * QUEL BARÈME LA MODALE D'ASSIGNATION PROPOSE — et lequel part vraiment pour
 * chaque créatrice.
 *
 * Deux règles, séparées parce qu'elles répondent à deux questions différentes :
 * ce que le manager VOIT dans le sélecteur, et ce qui est ENVOYÉ créatrice par
 * créatrice. En masse les deux divergent volontairement — un seul champ à
 * l'écran, un barème différent par créatrice à l'envoi.
 */

/**
 * « Barème de chaque créatrice » — valeur de sélecteur, JAMAIS envoyée au
 * serveur : elle est résolue par `pricingForCreator` juste avant l'appel.
 */
export const PER_CREATOR = "__per_creator__";

/**
 * Le barème AFFICHÉ. `null` = aucun (le sélecteur dit « choisis un barème »).
 *
 * L'ordre des règles est la fonctionnalité :
 *  1. `touched` — le manager a choisi ; son choix tient, y compris s'il change
 *     ensuite de créatrice. Une reprise automatique après un choix explicite
 *     reviendrait à défaire son geste sous ses yeux.
 *  2. masse — « celui de chacune », le seul défaut correct quand le lot mélange
 *     des grilles (pays, deals) ; en imposer une paierait la plupart au tarif
 *     de quelqu'un d'autre.
 *  3. unitaire — la grille de la créatrice sélectionnée, telle que la paie la
 *     lira (résolution serveur : sa grille perso, sinon le défaut du projet).
 */
export function displayedPricingChoice(o: {
  touched: boolean;
  chosen: string | null;
  mode: "single" | "bulk";
  creatorPricingId: string | null;
}): string | null {
  if (o.touched) return o.chosen;
  return o.mode === "bulk" ? PER_CREATOR : o.creatorPricingId;
}

/**
 * Le barème ENVOYÉ pour une créatrice donnée. `null` = rien à envoyer : elle n'a
 * pas de grille, et l'assignation doit être refusée AVANT l'appel (sinon le
 * serveur rejette une par une, au milieu d'un lot déjà à moitié créé).
 */
export function pricingForCreator(
  choice: string | null,
  creatorPricingId: string | null,
): string | null {
  return choice === PER_CREATOR ? creatorPricingId : choice;
}
