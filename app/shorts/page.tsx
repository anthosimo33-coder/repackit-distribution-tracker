"use client";

import { Suspense } from "react";
import { TrackerListSection } from "@/components/tracker/TrackerListSection";
import { Skeleton } from "@/components/ui/skeleton";
import { NewFormatButton } from "@/components/nouveau/NewFormatButton";

/**
 * Page Shorts (Batch B).
 *
 * Calque /carrousels avec mediaType="short". Bouton "Nouveau Short"
 * déclenche le modal NouveauModal pré-sélectionné short.
 */
export default function ShortsPage() {
  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Shorts
        </h1>
        <NewFormatButton format="short" />
      </header>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <TrackerListSection mediaType="short" />
      </Suspense>
    </div>
  );
}
