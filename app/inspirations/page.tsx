"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { InspirationsHeader } from "@/components/inspirations/InspirationsHeader";
import { InspirationsFilters } from "@/components/inspirations/InspirationsFilters";
import { InspirationGrid } from "@/components/inspirations/InspirationGrid";
import { InspirationsList } from "@/components/inspirations/InspirationsList";
import { InspirationsEmptyState } from "@/components/inspirations/InspirationsEmptyState";
import { InspirationGridSkeleton } from "@/components/inspirations/InspirationGridSkeleton";
import { InspirationsListSkeleton } from "@/components/inspirations/InspirationsListSkeleton";
import { InspirationDialog } from "@/components/inspirations/InspirationDialog";
import { FolderManagerSection } from "@/components/inspirations/FolderManagerSection";
import { Skeleton } from "@/components/ui/skeleton";
import type { FolderRef } from "@/components/inspirations/InspirationCard";
import {
  DEFAULT_FILTERS,
  FILTER_PARAM_KEYS,
  filtersToQueryArgs,
  filtersToSearchParams,
  searchParamsToFilters,
  activeFilterCount,
  type InspirationFilters,
} from "@/lib/inspiration-filters";

const FILTER_KEYS_SET = new Set<string>(FILTER_PARAM_KEYS);

/**
 * Batch F → G → H — pilier VEILLE. Page principale unifiée :
 *  - ?view=folders → FolderManagerSection (CRUD admin)
 *  - ?view=list    → InspirationsList (vue tableau)
 *  - default/grid  → InspirationGrid (vue cards)
 *
 * Filtres + vue sérialisés en URL params pour deeplinks (Batch H).
 *
 * Stratégie URL params : useState local pour `filters` (source réactive
 * immédiate, pas de stale closure dans le debounce de search). Hydration
 * UNE FOIS quand les queries résolvent — re-valide URL contre les
 * folderIds/tags actuels. Sync filters → URL via useEffect après
 * hydration. Comparaison filter-params-only évite les writes inutiles.
 *
 * Rationale vs URL-as-source-of-truth pattern : router.replace est async,
 * donc filters dérivé via useMemo peut être stale momentanément entre
 * setFilters et la propagation searchParams. Dans le debounce de
 * InspirationsFilters (300ms), `{...filters, search: value}` capturerait
 * alors les anciens filters dans la closure → query Convex avec mauvais
 * args. useState garantit la cohérence du rendu synchronously.
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
      <InspirationGridSkeleton />
    </div>
  );
}

function InspirationsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const viewParam = searchParams.get("view");
  const isFoldersView = viewParam === "folders";
  const isListView = viewParam === "list";
  const view: "grid" | "list" = isListView ? "list" : "grid";

  const allInspirations = useQuery(api.inspirations.listInspirations, {});
  const folders = useQuery(api.folders.listFolders, {});

  const validFolderIds = useMemo(
    () => new Set<string>((folders ?? []).map((f) => f._id)),
    [folders],
  );
  const validTags = useMemo(() => {
    const s = new Set<string>();
    for (const i of allInspirations ?? []) {
      for (const t of i.tags) s.add(t);
    }
    return s;
  }, [allInspirations]);

  const tagSuggestions = useMemo(
    () =>
      Array.from(validTags).sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" }),
      ),
    [validTags],
  );

  const [filters, setFilters] = useState<InspirationFilters>(DEFAULT_FILTERS);
  // Auto-open panneau filtres si l'URL au mount contient des filter params
  // (cas deeplink). Évite que le user ouvre une URL filtrée et ne voit pas
  // ses critères actifs.
  const [showFilters, setShowFilters] = useState(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return FILTER_PARAM_KEYS.some((k) => params.has(k));
  });

  const hydratedRef = useRef(false);

  // Hydrate filters depuis URL une fois les 2 queries résolues. Strip
  // silencieux des folderIds/tags stales (deletion dans autre tab, etc.).
  // L'eslint-disable est ciblé : c'est une hydratation one-shot (gated par
  // hydratedRef), pas un set-state-in-effect cascadant.
  useEffect(() => {
    if (hydratedRef.current) return;
    if (folders === undefined || allInspirations === undefined) return;
    hydratedRef.current = true;
    const fromUrl = searchParamsToFilters(
      searchParams,
      validFolderIds,
      validTags,
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, allInspirations]);

  // Sync filters → URL après hydration. Compare filter params actuels vs
  // nouveaux pour éviter writes inutiles. Préserve view + autres params.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const newFilterParams = filtersToSearchParams(filters);
    const currentFilterParams = new URLSearchParams();
    for (const k of FILTER_PARAM_KEYS) {
      const v = searchParams.get(k);
      if (v) currentFilterParams.set(k, v);
    }
    if (newFilterParams.toString() === currentFilterParams.toString()) return;

    const merged = new URLSearchParams();
    for (const [k, v] of searchParams.entries()) {
      if (!FILTER_KEYS_SET.has(k)) merged.set(k, v);
    }
    for (const [k, v] of newFilterParams.entries()) merged.set(k, v);
    const qs = merged.toString();
    router.replace(qs ? `/inspirations?${qs}` : "/inspirations");
  }, [filters, searchParams, router]);

  const queryArgs = useMemo(() => filtersToQueryArgs(filters), [filters]);
  const inspirations = useQuery(api.inspirations.listInspirations, queryArgs);

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

  function navigate(nextView: "folders" | null) {
    const params = new URLSearchParams(searchParams);
    if (nextView) params.set("view", nextView);
    else params.delete("view");
    const qs = params.toString();
    router.replace(qs ? `/inspirations?${qs}` : "/inspirations");
  }

  function handleViewChange(next: "grid" | "list") {
    const params = new URLSearchParams(searchParams);
    if (next === "grid") params.delete("view");
    else params.set("view", "list");
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
        view={view}
        onViewChange={handleViewChange}
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
        view === "list" ? (
          <InspirationsListSkeleton />
        ) : (
          <InspirationGridSkeleton />
        )
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
      ) : view === "list" ? (
        <InspirationsList
          inspirations={inspirations}
          folderMap={folderMap}
          onCardClick={openEditDialog}
        />
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
        tagSuggestions={tagSuggestions}
      />
    </div>
  );
}
