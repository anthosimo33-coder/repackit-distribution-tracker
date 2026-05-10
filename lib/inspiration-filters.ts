import type { Id } from "@/convex/_generated/dataModel";
import type {
  InspirationType,
  Plateforme,
} from "./inspiration-url";
import { ALL_PLATFORMS } from "./format-config";

/**
 * Batch G → H — état local des filtres /inspirations. Sets vides = "tous"
 * (pas de filtre actif). Sérialisé en URL params dans Batch H pour
 * deeplinks via filtersToSearchParams / searchParamsToFilters.
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

/**
 * Batch H — clés URL utilisées pour sérialiser les filtres. Listées en
 * constante pour permettre un cleanup propre côté page.tsx (preserve ?view=
 * et autres params hors-filtre).
 */
export const FILTER_PARAM_KEYS = [
  "folders",
  "plateformes",
  "types",
  "favorites",
  "q",
  "tags",
] as const;

const VALID_TYPES: ReadonlySet<InspirationType> = new Set<InspirationType>([
  "video",
  "account",
]);
const VALID_PLATEFORMES: ReadonlySet<Plateforme> = new Set<Plateforme>(
  ALL_PLATFORMS,
);

/**
 * Batch H — encode l'état des filtres en URLSearchParams compatible
 * router.replace. CSV pour les sets, "1" pour le bool favorites, "q" pour
 * la search. Sets vides + search vide + isFavorite false → absents.
 */
export function filtersToSearchParams(
  f: InspirationFilters,
): URLSearchParams {
  const p = new URLSearchParams();
  if (f.folderIds.size > 0) p.set("folders", Array.from(f.folderIds).join(","));
  if (f.plateformes.size > 0)
    p.set("plateformes", Array.from(f.plateformes).join(","));
  if (f.types.size > 0) p.set("types", Array.from(f.types).join(","));
  if (f.isFavorite) p.set("favorites", "1");
  const trimmedSearch = f.search.trim();
  if (trimmedSearch.length > 0) p.set("q", trimmedSearch);
  if (f.tags.size > 0) p.set("tags", Array.from(f.tags).join(","));
  return p;
}

/**
 * Batch H — parse URL search params vers InspirationFilters avec
 * validation. Les folderIds qui n'existent plus en DB sont strippés
 * silencieusement (cas typique : ouverture d'un deeplink après suppression
 * d'un dossier dans une autre tab). Idem pour les tags qui n'existent plus.
 *
 * Les plateformes/types invalides sont rejetés. La search est trim mais pas
 * lowercase (cohérent avec le serveur qui lowercase au compare).
 *
 * validFolderIds et validTags peuvent être vides si la query Convex n'a pas
 * encore résolu ; dans ce cas tout est strippé (filters revalidés une fois
 * les données arrivées via useEffect côté page).
 */
export function searchParamsToFilters(
  params: URLSearchParams | ReadonlyURLSearchParams,
  validFolderIds: ReadonlySet<string>,
  validTags: ReadonlySet<string>,
): InspirationFilters {
  function csv(key: string): string[] {
    const raw = params.get(key);
    if (!raw) return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  const folderIds = new Set<Id<"folders">>();
  for (const id of csv("folders")) {
    if (validFolderIds.has(id)) folderIds.add(id as Id<"folders">);
  }

  const plateformes = new Set<Plateforme>();
  for (const p of csv("plateformes")) {
    if (VALID_PLATEFORMES.has(p as Plateforme)) {
      plateformes.add(p as Plateforme);
    }
  }

  const types = new Set<InspirationType>();
  for (const t of csv("types")) {
    if (VALID_TYPES.has(t as InspirationType)) {
      types.add(t as InspirationType);
    }
  }

  const tags = new Set<string>();
  for (const t of csv("tags")) {
    const normalized = t.toLowerCase();
    if (validTags.has(normalized)) tags.add(normalized);
  }

  const isFavorite = params.get("favorites") === "1";
  const search = (params.get("q") ?? "").trim();

  return {
    folderIds,
    plateformes,
    types,
    isFavorite,
    search,
    tags,
  };
}

// Type compat pour Next.js useSearchParams (ReadonlyURLSearchParams).
type ReadonlyURLSearchParams = {
  get(key: string): string | null;
};
