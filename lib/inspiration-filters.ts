import type { Id } from "@/convex/_generated/dataModel";
import type {
  InspirationType,
  Plateforme,
} from "./inspiration-url";

/**
 * Batch G — état local des filtres /inspirations. URL params côté Batch H
 * si besoin (decision tranchée #3). Sets vides = "tous" (pas de filtre)
 * cohérent avec FilterMultiSelect sémantique.
 */
export type InspirationFilters = {
  folderIds: Set<Id<"folders">>;
  plateformes: Set<Plateforme>;
  types: Set<InspirationType>;
  isFavorite: boolean;
  search: string;
  tags: Set<string>;
};

export const DEFAULT_FILTERS: InspirationFilters = {
  folderIds: new Set(),
  plateformes: new Set(),
  types: new Set(),
  isFavorite: false,
  search: "",
  tags: new Set(),
};

export function isDefaultFilters(f: InspirationFilters): boolean {
  return (
    f.folderIds.size === 0 &&
    f.plateformes.size === 0 &&
    f.types.size === 0 &&
    !f.isFavorite &&
    f.search.length === 0 &&
    f.tags.size === 0
  );
}

export function activeFilterCount(f: InspirationFilters): number {
  let n = 0;
  if (f.folderIds.size > 0) n++;
  if (f.plateformes.size > 0) n++;
  if (f.types.size > 0) n++;
  if (f.isFavorite) n++;
  if (f.search.trim().length > 0) n++;
  if (f.tags.size > 0) n++;
  return n;
}

/**
 * Convertit l'état local en args attendus par api.inspirations.listInspirations.
 * Sets vides + search vide + isFavorite false → args omis (champ undefined =
 * pas de filtre côté serveur).
 */
export function filtersToQueryArgs(f: InspirationFilters): {
  folderIds?: Id<"folders">[];
  plateformes?: Plateforme[];
  types?: InspirationType[];
  isFavorite?: boolean;
  search?: string;
  tags?: string[];
} {
  const args: {
    folderIds?: Id<"folders">[];
    plateformes?: Plateforme[];
    types?: InspirationType[];
    isFavorite?: boolean;
    search?: string;
    tags?: string[];
  } = {};
  if (f.folderIds.size > 0) args.folderIds = Array.from(f.folderIds);
  if (f.plateformes.size > 0) args.plateformes = Array.from(f.plateformes);
  if (f.types.size > 0) args.types = Array.from(f.types);
  if (f.isFavorite) args.isFavorite = true;
  const trimmedSearch = f.search.trim();
  if (trimmedSearch.length > 0) args.search = trimmedSearch;
  if (f.tags.size > 0) args.tags = Array.from(f.tags);
  return args;
}
