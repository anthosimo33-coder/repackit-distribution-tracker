/**
 * Types et constantes partagés pour les filtres tracker.
 *
 * Le shape ici DOIT correspondre exactement aux 7 useState du tracker
 * (search/plateforme/compte/statut/mecanique/format/verdict) ET au schéma
 * Convex `filterPresets.filters`. Toute évolution force à bumper
 * schemaVersion + updater les 3 endroits de manière synchrone.
 */

export type TrackerFilters = {
  search: string;
  plateforme: string;
  compte: string;
  statut: string;
  mecanique: string;
  format: string;
  verdict: string;
};

export type TrackerSort = {
  key: "date" | "saveRate";
  dir: "asc" | "desc";
};

export const FILTER_ALL = "all";

export const DEFAULT_FILTERS: TrackerFilters = {
  search: "",
  plateforme: FILTER_ALL,
  compte: FILTER_ALL,
  statut: FILTER_ALL,
  mecanique: FILTER_ALL,
  format: FILTER_ALL,
  verdict: FILTER_ALL,
};

export const DEFAULT_SORT: TrackerSort = {
  key: "date",
  dir: "desc",
};

/**
 * Comparaison field-by-field pour éviter les pièges de JSON.stringify
 * (ordre de clés non garanti après round-trip Convex). Maintenue
 * synchronisée avec le shape de TrackerFilters.
 */
export function filtersEqual(
  a: TrackerFilters,
  b: TrackerFilters,
): boolean {
  return (
    a.search === b.search &&
    a.plateforme === b.plateforme &&
    a.compte === b.compte &&
    a.statut === b.statut &&
    a.mecanique === b.mecanique &&
    a.format === b.format &&
    a.verdict === b.verdict
  );
}

export function sortsEqual(a: TrackerSort, b: TrackerSort): boolean {
  return a.key === b.key && a.dir === b.dir;
}

export function isDefaultFilters(f: TrackerFilters): boolean {
  return filtersEqual(f, DEFAULT_FILTERS);
}
