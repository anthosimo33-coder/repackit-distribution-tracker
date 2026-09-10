/**
 * Recherche TEXTE de la vue Assignments.
 *
 * Pourquoi ce module existe : les filtres de la page sont tous CATÉGORIELS
 * (créatrice, campagne, statut). Pour retrouver UNE ligne parmi 478 il fallait
 * donc connaître d'avance sa créatrice ET sa campagne, puis parcourir à l'œil.
 * Sur téléphone, où l'écran montre trois cartes à la fois, ça revient à ne pas
 * pouvoir chercher du tout.
 *
 * Trois règles, chacune avec sa raison :
 *
 *  1. Le champ cherche dans ce qui est AFFICHÉ sur la ligne — nom de créatrice,
 *     campagne ou format, résumé de combo, @handle des comptes ciblés. Pas dans
 *     le script monté : on chercherait alors des mots qu'on ne voit nulle part,
 *     et une même phrase de hook renverrait cinquante lignes identiques.
 *  2. Comparaison SANS accents ni casse. « angelica » doit trouver « Angélica »,
 *     et l'admin tape au clavier français sans réfléchir aux accents.
 *  3. Plusieurs mots = ET, dans n'importe quel ordre et n'importe quel champ :
 *     « lauret retard » n'a pas à être écrit dans l'ordre du rendu. Un terme
 *     doit matcher au moins un champ ; tous les termes doivent matcher.
 */

/** Une assignation, vue par la recherche (sous-ensemble de listAssignments). */
export interface AssignmentSearchable {
  creatorName?: string | null;
  scriptCampaignName?: string | null;
  formatName?: string | null;
  comboSummary?: string | null;
  targets?: { platform?: string | null; accountHandle?: string | null }[];
}

/**
 * Forme comparable d'une chaîne : minuscules, accents retirés, espaces
 * normalisés. `NFD` sépare la lettre de son diacritique, la plage
 * `\u0300-\u036f` (Combining Diacritical Marks) retire ensuite les diacritiques
 * seuls — « é » devient « e » sans table de correspondance à maintenir.
 *
 * Les diacritiques sont écrits en ÉCHAPPEMENTS et non en caractères littéraux :
 * un caractère combinant collé au crochet d'une classe est invisible à la
 * relecture et disparaît au premier copier-coller malheureux.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Découpe la saisie en termes (espaces multiples tolérés). */
export function searchTerms(query: string): string[] {
  const n = normalizeForSearch(query);
  return n.length === 0 ? [] : n.split(/\s+/);
}

/** Les champs d'une ligne où la recherche a le droit de chercher. */
function haystack(a: AssignmentSearchable): string {
  const parts = [
    a.creatorName,
    a.scriptCampaignName,
    a.formatName,
    a.comboSummary,
    ...(a.targets ?? []).flatMap((t) => [t.accountHandle, t.platform]),
  ];
  return normalizeForSearch(
    parts.filter((p): p is string => typeof p === "string").join(" "),
  );
}

/**
 * Vrai si la ligne matche TOUS les termes. Une requête vide ne filtre rien —
 * même sémantique que les autres filtres de la page (vide = tous).
 */
export function matchesSearch(
  a: AssignmentSearchable,
  terms: string[],
): boolean {
  if (terms.length === 0) return true;
  const h = haystack(a);
  return terms.every((t) => h.includes(t));
}
