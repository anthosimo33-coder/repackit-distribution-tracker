"use client";

import { Suspense } from "react";
import { TrackerListSection } from "@/components/tracker/TrackerListSection";
import { Skeleton } from "@/components/ui/skeleton";
import { NewFormatButton } from "@/components/nouveau/NewFormatButton";

/**
 * Page Carrousels (Batch B).
 *
 * Wrapper mince autour de TrackerListSection avec mediaType implicite.
 * Le bouton "Nouveau Carrousel" déclenche le modal NouveauModal pré-
 * sélectionné carousel (Batch C — via ?nouveau=open&format=carousel).
 */
export default function CarrouselsPage() {
  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Carrousels
        </h1>
        <NewFormatButton format="carousel" />
      </header>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <TrackerListSection mediaType="carousel" />
      </Suspense>
    </div>
  );
}
