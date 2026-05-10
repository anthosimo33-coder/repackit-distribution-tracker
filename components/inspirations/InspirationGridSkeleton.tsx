"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Batch H — skeleton extracted pour réutilisation page.tsx + futurs callers.
 * Garde le même grid CSS que InspirationGrid pour zero CLS au swap.
 */
export function InspirationGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
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
  );
}
