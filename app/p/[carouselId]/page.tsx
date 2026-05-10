"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Catch-all /p/[carouselId] (Batch B).
 *
 * Résout le mediaType d'un carouselId via Convex puis redirige vers la
 * bonne page format. Trois cas :
 *   - mediaType = carousel → /carrousels?carouselId=X
 *   - mediaType = short    → /shorts?carouselId=X
 *   - introuvable          → /dashboard
 *
 * Implémentation Client Component (vs Server) car Convex queries serveur
 * exigent une auth complexe via ConvexHttpClient + node-fetch ; un
 * Client Component avec useQuery + router.replace fait le job en 1 hop UI
 * (skeleton bref pendant la résolution). Le redirect 308 de /tracker?
 * carouselId=X vers /p/X dans next.config.ts donne un total de 2 hops
 * acceptables pour un deeplink legacy.
 */
export default function CarouselIdResolver({
  params,
}: {
  params: Promise<{ carouselId: string }>;
}) {
  const { carouselId } = use(params);
  const router = useRouter();
  const resolved = useQuery(api.publications.getByCarouselId, { carouselId });

  useEffect(() => {
    if (resolved === undefined) return;
    if (resolved === null) {
      router.replace("/dashboard");
      return;
    }
    const route =
      resolved.mediaType === "carousel" ? "/carrousels" : "/shorts";
    router.replace(`${route}?carouselId=${carouselId}`);
  }, [resolved, carouselId, router]);

  return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
