/**
 * FILTRE DE RECHERCHE DES SÉLECTEURS LONGS (pays, fuseaux).
 *
 * ⚠️ IL REMPLACE LE FILTRE PAR DÉFAUT DE `cmdk`, qui est un match par
 * SOUS-SÉQUENCE : taper « Serb » y remonte « Îles Vierges britanniques »
 * (s…e…r…b dans l'ordre, dispersés). Sur trois entrées c'est amusant ; sur 250
 * pays, ça noie la bonne réponse sous des voisines absurdes et fait douter de
 * la recherche.
 *
 * Ici la règle est celle qu'on attend d'une liste de noms : le texte cherché
 * doit être une SOUS-CHAÎNE. Le score n'ordonne que la pertinence — un début de
 * mot avant un milieu de mot.
 *
 * Les ACCENTS sont ignorés des deux côtés : « etats » doit trouver
 * « États-Unis », sinon le champ punit qui tape vite.
 */

/** Minuscules, sans accents, espaces normalisés. */
export function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Score d'une entrée pour une recherche, au contrat de `cmdk` : 0 = exclue,
 * plus grand = plus haut.
 *
 *   1    — un MOT de l'entrée commence par le texte cherché ;
 *   0.5  — l'entrée le contient ailleurs ;
 *   0    — sinon.
 *
 * Une recherche vide garde tout (le sélecteur s'ouvre sur sa liste entière).
 */
export function scoreRecherche(valeur: string, recherche: string): number {
  const q = normaliser(recherche);
  if (q === "") return 1;
  const v = normaliser(valeur);
  const i = v.indexOf(q);
  if (i === -1) return 0;
  // Début de l'entrée, ou début d'un mot : c'est ce que la personne visait.
  if (i === 0 || /[\s\-—(/]/.test(v[i - 1])) return 1;
  return 0.5;
}
