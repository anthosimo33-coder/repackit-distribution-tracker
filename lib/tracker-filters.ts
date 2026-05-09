/**
 * Types et constantes partagés pour les filtres tracker.
 *
 * Le shape ici DOIT correspondre exactement aux useState du tracker ET au
 * schéma Convex `filterPresets.filters`. Toute évolution force à bumper
 * schemaVersion + updater les 3 endroits de manière synchrone.
 *
 * v2 : compte/mecanique/format/verdict passent en string[] (multi-select).
 *      Set vide = "tous". Plateforme/statut restent single-select.
 * v3 (Batch 2 Modif 7) : ajout du filtre top-level mediaType (single).
 *      Les presets v2 sont strippés silencieusement au load (cf
 *      app/tracker/page.tsx, schemaVersion === 3).
 */

export type TrackerFilters = {
  search: string;
  plateforme: string;
  statut: string;
  compte: string[];
  mecanique: string[];
  format: string[];
  verdict: string[];
  // Batch 2 Modif 7 (v3) — single-select : "all" = aucun filtre,
  // "carousel" / "short" = restriction. Mappé via mediaTypeFilterToValue
  // côté tracker.
  mediaType: string;
};

// Batch 2 Modif 4b — tri étendu sur 6 axes côté tracker. TrackerSort
// élargi en parallèle pour rester TS-cohérent. Le validator Convex côté
// serveur (convex/filterPresets.ts sortValidator) reste strict 2 valeurs
// pour les presets v2 — un user qui trie par likes/vues/etc. et tente de
// sauver un preset reçoit un ConvexError explicite. Modif 7 (étape 5)
// bumpera v3 et alignera le validator.
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
  mediaType: FILTER_ALL,
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
    a.mediaType === b.mediaType &&
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
    f.mediaType === DEFAULT_FILTERS.mediaType &&
    f.compte.length === 0 &&
    f.mecanique.length === 0 &&
    f.format.length === 0 &&
    f.verdict.length === 0
  );
}
