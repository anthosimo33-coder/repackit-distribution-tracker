import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton de la table /shorts/sources (5 lignes). */
export function ShortSourcesSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
