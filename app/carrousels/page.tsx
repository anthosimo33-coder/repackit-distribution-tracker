"use client";

import Link from "next/link";
import { Suspense } from "react";
import { TrackerListSection } from "@/components/tracker/TrackerListSection";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PlusIcon } from "lucide-react";

/**
 * Page Carrousels (Batch B).
 *
 * Wrapper mince autour de TrackerListSection avec mediaType implicite.
 * Le bouton "Nouveau Carrousel" pointe vers /nouveau (legacy) — au Batch C
 * il déclenchera l'ouverture du modal multi-étapes pré-sélectionné carousel.
 */
export default function CarrouselsPage() {
  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Carrousels
        </h1>
        <Link
          href="/nouveau"
          className={cn(buttonVariants({ size: "sm" }))}
        >
          <PlusIcon />
          Nouveau Carrousel
        </Link>
      </header>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <TrackerListSection mediaType="carousel" />
      </Suspense>
    </div>
  );
}
