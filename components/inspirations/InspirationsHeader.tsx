"use client";

import { Button } from "@/components/ui/button";
import { FolderIcon, PlusIcon, SlidersHorizontalIcon } from "lucide-react";
import { ViewToggle } from "./ViewToggle";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * Batch F → G → H — header de la page /inspirations. Étendu avec ViewToggle
 * Grid/List (masqué en mode folders), badge count filtres, et bouton
 * Dossiers qui navigue vers ?view=folders.
 */
export function InspirationsHeader({
  onCreate,
  onToggleFilters,
  onOpenFolders,
  filtersOpen,
  activeFilterCount,
  view,
  onViewChange,
}: {
  onCreate: () => void;
  onToggleFilters: () => void;
  onOpenFolders: () => void;
  filtersOpen: boolean;
  activeFilterCount: number;
  view: "grid" | "list";
  onViewChange: (next: "grid" | "list") => void;
}) {
  const tr = useTranslations("admin.library.InspirationsHeader");
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {tr("inspirations")}
        </h1>
        <p className="text-sm text-slate-500">
          {tr("bibliothequeDeVideosEtComptes")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ViewToggle value={view} onChange={onViewChange} />
        <Button
          variant="outline"
          onClick={onToggleFilters}
          aria-expanded={filtersOpen}
          className={cn(filtersOpen && "bg-slate-100")}
        >
          <SlidersHorizontalIcon className="size-4" />
          {tr("filtres")}
          {activeFilterCount > 0 && (
            <span className="ml-1 rounded-full bg-slate-900 px-1.5 py-0.5 text-xs font-semibold text-white">
              {activeFilterCount}
            </span>
          )}
        </Button>
        <Button variant="outline" onClick={onOpenFolders}>
          <FolderIcon className="size-4" />
          {tr("dossiers")}
        </Button>
        <Button onClick={onCreate}>
          <PlusIcon className="size-4" />
          {tr("nouvelleInspiration")}
        </Button>
      </div>
    </div>
  );
}
