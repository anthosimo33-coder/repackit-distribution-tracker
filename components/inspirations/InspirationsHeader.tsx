"use client";

import { Button } from "@/components/ui/button";
import { FolderIcon, PlusIcon, SlidersHorizontalIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Batch F → G — header de la page /inspirations. Étendu avec 2 boutons
 * supplémentaires : Filtres (toggle panneau) + Dossiers (navigation vers
 * ?view=folders).
 */
export function InspirationsHeader({
  onCreate,
  onToggleFilters,
  onOpenFolders,
  filtersOpen,
  activeFilterCount,
}: {
  onCreate: () => void;
  onToggleFilters: () => void;
  onOpenFolders: () => void;
  filtersOpen: boolean;
  activeFilterCount: number;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Inspirations
        </h1>
        <p className="text-sm text-slate-500">
          Bibliothèque de vidéos et comptes qui t&apos;inspirent.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={onToggleFilters}
          aria-expanded={filtersOpen}
          className={cn(filtersOpen && "bg-slate-100")}
        >
          <SlidersHorizontalIcon className="size-4" />
          Filtres
          {activeFilterCount > 0 && (
            <span className="ml-1 rounded-full bg-slate-900 px-1.5 py-0.5 text-xs font-semibold text-white">
              {activeFilterCount}
            </span>
          )}
        </Button>
        <Button variant="outline" onClick={onOpenFolders}>
          <FolderIcon className="size-4" />
          Dossiers
        </Button>
        <Button onClick={onCreate}>
          <PlusIcon className="size-4" />
          Nouvelle inspiration
        </Button>
      </div>
    </div>
  );
}
