/**
 * Filtre PAYS CIBLÉ — options et prédicat, partagés par l'écran Comptes (un
 * compte = un pays) et l'onglet Assignments (une assignation = les pays des
 * comptes qu'elle vise). Pur, testé (Vitest).
 *
 * Les libellés (« 🇫🇷 France ») ne sont PAS produits ici : ils dépendent de la
 * langue du lecteur, l'écran les pose avec `countryLabel`.
 */

/**
 * Valeur SENTINELLE des éléments sans pays. Aucun code ISO ne peut la heurter :
 * la sélection reste une simple liste de chaînes.
 */
export const NO_COUNTRY = "__sans_pays__";

export interface CountryOption {
  /** Code ISO en majuscules, ou `NO_COUNTRY`. */
  value: string;
  /** Nombre d'ÉLÉMENTS (comptes, assignations) portant ce pays. */
  count: number;
}

/** Codes distincts d'un élément, normalisés ; vide = « sans pays ». */
function codesDe(codes: readonly (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const c of codes) {
    const cc = c?.trim().toUpperCase();
    if (cc) out.add(cc);
  }
  return out;
}

/**
 * Options depuis les ÉLÉMENTS présents — un pays que personne ne vise n'a rien
 * à filtrer et n'apparaît pas. Tri par effectif décroissant (le marché qui pèse
 * en tête), départage par code pour un ordre stable. L'entrée « sans pays »
 * vient en dernier, et seulement si un élément est concerné.
 *
 * Un élément à deux pays (assignation qui vise un compte FR et un compte US)
 * compte une fois dans CHACUN : l'effectif dit « combien de lignes restent si je
 * coche ce pays », pas une répartition qui sommerait au total.
 */
export function buildCountryOptions(
  elements: readonly (readonly (string | null | undefined)[])[],
): CountryOption[] {
  const parCode = new Map<string, number>();
  let sansPays = 0;
  for (const codes of elements) {
    const set = codesDe(codes);
    if (set.size === 0) sansPays += 1;
    for (const c of set) parCode.set(c, (parCode.get(c) ?? 0) + 1);
  }
  const out: CountryOption[] = [...parCode.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  if (sansPays > 0) out.push({ value: NO_COUNTRY, count: sansPays });
  return out;
}

/**
 * Un élément passe-t-il le filtre ? Sélection vide = aucun filtre, même
 * sémantique que les autres filtres multiples de l'app. Un élément passe dès
 * qu'UN de ses pays est coché.
 */
export function matchesCountryFilter(
  codes: readonly (string | null | undefined)[],
  selected: ReadonlySet<string>,
): boolean {
  if (selected.size === 0) return true;
  const set = codesDe(codes);
  if (set.size === 0) return selected.has(NO_COUNTRY);
  for (const c of set) if (selected.has(c)) return true;
  return false;
}
