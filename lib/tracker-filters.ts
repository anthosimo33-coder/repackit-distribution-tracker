/**
 * Types et constantes partagés pour les filtres tracker.
 *
 * Le shape ici DOIT correspondre exactement aux useState de TrackerListSection
 * ET au schéma Convex `filterPresets.filters`. Toute évolution force à bumper
 * schemaVersion + updater les 3 endroits de manière synchrone.
 *
 * v2 : compte/mecanique/format/verdict passent en string[] (multi-select).
 *      Set vide = "tous". Plateforme/statut restent single-select.
 * v3 (Batch 2 Modif 7) : ajout du filtre top-level mediaType (single).
 *      Les presets v2 sont strippés silencieusement au load.
 * v4 (Batch B) : split tracker en pages /carrousels et /shorts. Le champ
 *      filters.mediaType disparaît (devient implicite par la page courante).
 *      Le scope par format remonte en mediaTypeScope au top du preset.
 *      Les presets v3 sont strippés silencieusement au load.
 */

export type TrackerFilters = {
  search: string;
  plateforme: string;
  statut: string;
  compte: string[];
  mecanique: string[];
  format: string[];
  verdict: string[];
};

// TrackerSort.key étendu sur 6 axes (Batch 2 Modif 4b). Inchangé en v4.
export type TrackerSort = {
  key: "date" | "saveRate" | "vues" | "likes" | "comments" | "subsGained";
  dir: "asc" | "desc";
};

export const FILTER_ALL = "all";

export const DEFAULT_FILTERS: TrackerFilters = {
  search: "",
  plateforme: FILTER_ALL,
  statut: FILTER_ALL,
  compte: [],
  mecanique: [],
  format: [],
  verdict: [],
};

export const DEFAULT_SORT: TrackerSort = {
  key: "date",
  dir: "desc",
};

/**
 * Comparaison field-by-field pour éviter les pièges de JSON.stringify
 * (ordre de clés non garanti après round-trip Convex). Les 4 arrays sont
 * comparés order-insensitive (tri puis equals) pour qu'un preset ["A","B"]
 * matche un état courant ["B","A"].
 */
export function filtersEqual(
  a: TrackerFilters,
  b: TrackerFilters,
): boolean {
  return (
    a.search === b.search &&
    a.plateforme === b.plateforme &&
    a.statut === b.statut &&
    arraysEqualSorted(a.compte, b.compte) &&
    arraysEqualSorted(a.mecanique, b.mecanique) &&
    arraysEqualSorted(a.format, b.format) &&
    arraysEqualSorted(a.verdict, b.verdict)
  );
}

function arraysEqualSorted(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

export function sortsEqual(a: TrackerSort, b: TrackerSort): boolean {
  return a.key === b.key && a.dir === b.dir;
}

export function isDefaultFilters(f: TrackerFilters): boolean {
  return (
    f.search === DEFAULT_FILTERS.search &&
    f.plateforme === DEFAULT_FILTERS.plateforme &&
    f.statut === DEFAULT_FILTERS.statut &&
    f.compte.length === 0 &&
    f.mecanique.length === 0 &&
    f.format.length === 0 &&
    f.verdict.length === 0
  );
}
