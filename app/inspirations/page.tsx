"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InspirationsHeader } from "@/components/inspirations/InspirationsHeader";
import { InspirationsFilters } from "@/components/inspirations/InspirationsFilters";
import { InspirationGrid } from "@/components/inspirations/InspirationGrid";
import { InspirationsEmptyState } from "@/components/inspirations/InspirationsEmptyState";
import { InspirationDialog } from "@/components/inspirations/InspirationDialog";
import { FolderManagerSection } from "@/components/inspirations/FolderManagerSection";
import { Skeleton } from "@/components/ui/skeleton";
import type { FolderRef } from "@/components/inspirations/InspirationCard";
import {
  DEFAULT_FILTERS,
  filtersToQueryArgs,
  activeFilterCount,
  type InspirationFilters,
} from "@/lib/inspiration-filters";

/**
 * Batch F → G — pilier VEILLE. Page principale + bascule ?view=folders.
 *
 * Mode "inspirations" (default) : header + filtres collapsable + grid + dialog
 * Mode "folders" (?view=folders) : FolderManagerSection CRUD
 *
 * Filtres en local state (decision tranchée #3 — URL params en Batch H si
 * besoin). Pattern dialogKey pour reset clean state au close.
 *
 * Wrapper Suspense pour useSearchParams (Next 16 le suspend).
 */
export default function InspirationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InspirationsPageInner />
    </Suspense>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6">
      <Skeleton className="h-12 w-full" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square w-full" />
        ))}
      </div>
    </div>
  );
}

function InspirationsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view");
  const isFoldersView = view === "folders";

  const [filters, setFilters] = useState<InspirationFilters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const queryArgs = useMemo(() => filtersToQueryArgs(filters), [filters]);
  const inspirations = useQuery(api.inspirations.listInspirations, queryArgs);
  // Unfiltered fetch utilisé pour 2 choses : alimenter les options du
  // filtre Tags (sinon ils disparaissent quand on filtre par autre chose)
  // et calculer le count "X inspirations" même quand un filtre est appliqué
  // (sur la facet courante on a déjà inspirations.length).
  const allInspirations = useQuery(api.inspirations.listInspirations, {});
  const folders = useQuery(api.folders.listFolders, {});

  const folderMap = useMemo<Map<Id<"folders">, FolderRef>>(() => {
    const m = new Map<Id<"folders">, FolderRef>();
    for (const f of folders ?? []) {
      m.set(f._id, { _id: f._id, name: f.name, color: f.color });
    }
    return m;
  }, [folders]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<Id<"inspirations"> | null>(null);
  const [dialogKey, setDialogKey] = useState(0);

  function openCreateDialog() {
    setDialogMode("create");
    setEditingId(null);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  function openEditDialog(id: Id<"inspirations">) {
    setDialogMode("edit");
    setEditingId(id);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  function navigate(view: "folders" | null) {
    const params = new URLSearchParams(searchParams);
    if (view) params.set("view", view);
    else params.delete("view");
    const qs = params.toString();
    router.replace(qs ? `/inspirations?${qs}` : "/inspirations");
  }

  if (isFoldersView) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6">
        <FolderManagerSection onBack={() => navigate(null)} />
      </div>
    );
  }

  const filterCount = activeFilterCount(filters);
  const hasAnyInspiration =
    allInspirations !== undefined && allInspirations.length > 0;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6">
      <InspirationsHeader
        onCreate={openCreateDialog}
        onToggleFilters={() => setShowFilters((v) => !v)}
        onOpenFolders={() => navigate("folders")}
        filtersOpen={showFilters}
        activeFilterCount={filterCount}
      />

      {showFilters && (
        <InspirationsFilters
          filters={filters}
          onFiltersChange={setFilters}
          folders={folders ?? []}
          inspirations={allInspirations ?? []}
        />
      )}

      {inspirations === undefined ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white"
            >
              <Skeleton className="aspect-square w-full" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : inspirations.length === 0 ? (
        hasAnyInspiration ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
            <p className="text-sm font-medium text-slate-900">
              Aucune inspiration ne correspond à ces filtres.
            </p>
            <p className="text-sm text-slate-500">
              Essaie de réinitialiser ou d&apos;élargir tes critères.
            </p>
          </div>
        ) : (
          <InspirationsEmptyState onCreate={openCreateDialog} />
        )
      ) : (
        <InspirationGrid
          inspirations={inspirations}
          folderMap={folderMap}
          onCardClick={openEditDialog}
        />
      )}

      <InspirationDialog
        key={dialogKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        inspirationId={editingId ?? undefined}
      />
    </div>
  );
}
