"use client";

import Link from "next/link";
import { Suspense } from "react";
import { TrackerListSection } from "@/components/tracker/TrackerListSection";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PlusIcon } from "lucide-react";

/**
 * Page Shorts (Batch B).
 *
 * Calque /carrousels avec mediaType="short". Le bouton "Nouveau Short"
 * pointe vers /nouveau (legacy) — sera modal au Batch C.
 */
export default function ShortsPage() {
  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Shorts
        </h1>
        <Link
          href="/nouveau"
          className={cn(buttonVariants({ size: "sm" }))}
        >
          <PlusIcon />
          Nouveau Short
        </Link>
      </header>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <TrackerListSection mediaType="short" />
      </Suspense>
    </div>
  );
}
