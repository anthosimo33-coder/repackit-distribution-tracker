"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { InspirationsHeader } from "@/components/inspirations/InspirationsHeader";
import { InspirationGrid } from "@/components/inspirations/InspirationGrid";
import { InspirationsEmptyState } from "@/components/inspirations/InspirationsEmptyState";
import { InspirationDialog } from "@/components/inspirations/InspirationDialog";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Batch F — pilier VEILLE / Inspirations. Foundation : grid only, modal
 * création, pas de filtres, pas de toggle list. Édition + filtres + admin
 * folders viennent en Batch G.
 *
 * `dialogKey` force un remount du Dialog au close, garantissant un reset
 * propre du state interne (pattern utilisé par NouveauModalController dans
 * SidebarLayout). Évite la duplication de logique cleanup côté Dialog.
 */
export default function InspirationsPage() {
  const inspirations = useQuery(api.inspirations.listInspirations, {});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);

  function openCreateDialog() {
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6">
      <InspirationsHeader onCreate={openCreateDialog} />

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
        <InspirationsEmptyState onCreate={openCreateDialog} />
      ) : (
        <InspirationGrid inspirations={inspirations} />
      )}

      <InspirationDialog
        key={dialogKey}
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
      />
    </div>
  );
}
