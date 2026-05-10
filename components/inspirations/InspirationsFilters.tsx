"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { FilterMultiSelect } from "@/components/filters/FilterMultiSelect";
import { ALL_PLATFORMS } from "@/lib/format-config";
import {
  type InspirationFilters,
  isDefaultFilters,
  DEFAULT_FILTERS,
} from "@/lib/inspiration-filters";
import type { InspirationType, Plateforme } from "@/lib/inspiration-url";

const TYPE_OPTIONS = [
  { value: "video", label: "Vidéo" },
  { value: "account", label: "Compte" },
];

const PLATFORM_OPTIONS = ALL_PLATFORMS.map((p) => ({ value: p, label: p }));

/**
 * Batch G — panneau de filtres /inspirations. Tous les Sets vides = "tous"
 * (cohérent FilterMultiSelect). Search avec debounce 300ms via ref + setTimeout
 * (évite trigger Convex à chaque keystroke). Reset = bouton qui ramène
 * DEFAULT_FILTERS.
 *
 * Tags : options agrégées dynamiquement depuis les inspirations courantes
 * (reflective facet — limite la pollution si beaucoup de tags). useMemo
 * dérive la liste unique triée alpha.
 */
export function InspirationsFilters({
  filters,
  onFiltersChange,
  folders,
  inspirations,
}: {
  filters: InspirationFilters;
  onFiltersChange: (next: InspirationFilters) => void;
  folders: Doc<"folders">[];
  inspirations: Doc<"inspirations">[];
}) {
  const [searchInput, setSearchInput] = useState(filters.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track la dernière valeur committée par nous (debounce) pour distinguer
  // les changements externes (URL deeplink, reset programmatique) de
  // l'écho de notre propre commit. Permet de sync l'input local quand
  // filters.search change externalement sans casser le debounce typing.
  const lastCommittedRef = useRef(filters.search);

  useEffect(() => {
    if (filters.search === lastCommittedRef.current) return;
    lastCommittedRef.current = filters.search;
    setSearchInput(filters.search);
  }, [filters.search]);

  function commitSearch(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      lastCommittedRef.current = value;
      onFiltersChange({ ...filters, search: value });
    }, 300);
  }

  function handleSearchChange(value: string) {
    setSearchInput(value);
    commitSearch(value);
  }

  function reset() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    lastCommittedRef.current = "";
    setSearchInput("");
    onFiltersChange(DEFAULT_FILTERS);
  }

  const folderOptions = useMemo(
    () => folders.map((f) => ({ value: f._id, label: f.name })),
    [folders],
  );

  const tagOptions = useMemo(() => {
    const all = new Set<string>();
    for (const i of inspirations) {
      for (const t of i.tags) all.add(t);
    }
    return Array.from(all)
      .sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" }),
      )
      .map((t) => ({ value: t, label: t }));
  }, [inspirations]);

  const isDefault = isDefaultFilters(filters);

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterMultiSelect
          label="Dossier"
          selectedValues={filters.folderIds as Set<string>}
          onChange={(next) =>
            onFiltersChange({
              ...filters,
              folderIds: next as Set<Id<"folders">>,
            })
          }
          options={folderOptions}
        />
        <FilterMultiSelect
          label="Plateforme"
          selectedValues={filters.plateformes as Set<string>}
          onChange={(next) =>
            onFiltersChange({
              ...filters,
              plateformes: next as Set<Plateforme>,
            })
          }
          options={PLATFORM_OPTIONS}
        />
        <FilterMultiSelect
          label="Type"
          selectedValues={filters.types as Set<string>}
          onChange={(next) =>
            onFiltersChange({
              ...filters,
              types: next as Set<InspirationType>,
            })
          }
          options={TYPE_OPTIONS}
        />
        <FilterMultiSelect
          label="Tags"
          selectedValues={filters.tags}
          onChange={(next) => onFiltersChange({ ...filters, tags: next })}
          options={tagOptions}
          allLabel={tagOptions.length === 0 ? "Aucun tag" : "Tous"}
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="inspirations-search" className="text-xs">
            Recherche
          </Label>
          <Input
            id="inspirations-search"
            type="search"
            placeholder="Titre, notes, URL…"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2 sm:justify-start">
          <Label htmlFor="filter-favorite" className="cursor-pointer text-sm">
            Favoris seulement
          </Label>
          <Switch
            id="filter-favorite"
            checked={filters.isFavorite}
            onCheckedChange={(v) =>
              onFiltersChange({ ...filters, isFavorite: v })
            }
          />
        </div>
        {!isDefault && (
          <Button variant="ghost" onClick={reset}>
            Réinitialiser
          </Button>
        )}
      </div>
    </div>
  );
}
