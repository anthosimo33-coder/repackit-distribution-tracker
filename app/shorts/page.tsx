"use client";

import { Suspense } from "react";
import Link from "next/link";
import { TrackerListSection } from "@/components/tracker/TrackerListSection";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { NewFormatButton } from "@/components/nouveau/NewFormatButton";
import { LibraryIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Page Shorts (Batch B).
 *
 * Calque /carrousels avec mediaType="short". Bouton "Nouveau Short"
 * déclenche le modal NouveauModal pré-sélectionné short. Bouton "Bibliothèque
 * sources" → sous-route /shorts/sources (anti-shadowban : matrice sourceId).
 */
export default function ShortsPage() {
  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Shorts
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href="/shorts/sources"
            className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}
          >
            <LibraryIcon className="size-4" />
            Bibliothèque sources
          </Link>
          <NewFormatButton format="short" />
        </div>
      </header>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <TrackerListSection mediaType="short" />
      </Suspense>
    </div>
  );
}
