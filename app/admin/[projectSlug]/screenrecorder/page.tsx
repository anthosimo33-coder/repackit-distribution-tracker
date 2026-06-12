"use client";

import { Suspense } from "react";
import { TrackerListSection } from "@/components/tracker/TrackerListSection";
import { Skeleton } from "@/components/ui/skeleton";
import { NewFormatButton } from "@/components/nouveau/NewFormatButton";

/**
 * Page ScreenRecorders (Batch D).
 *
 * Calque /shorts avec mediaType="screenrecorder". Le tracker affiche en
 * plus la colonne image (thumbnail) et la colonne titre (cf
 * SCREENRECORDER_COLUMNS dans TrackerListSection). Bouton "Nouveau
 * ScreenRecorder" pré-sélectionne le modal Nouveau.
 */
export default function ScreenRecorderPage() {
  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          ScreenRecorders
        </h1>
        <NewFormatButton format="screenrecorder" />
      </header>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <TrackerListSection mediaType="screenrecorder" />
      </Suspense>
    </div>
  );
}
