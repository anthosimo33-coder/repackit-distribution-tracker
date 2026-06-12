"use client";

import { use, useEffect } from "react";
import { useRouter, notFound } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { projectPath } from "@/lib/project-path";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Catch-all `/p/[carouselId]` — deeplink legacy CROSS-PROJET (Batch B + P3).
 *
 * Cible des vieux liens partagés (`/p/C012`, `/tracker?carouselId=C012`). Rendu
 * HORS ProjectProvider (top-level, sous <Authenticated>) : il ne connaît pas de
 * projet courant. Il cherche le carouselId dans TOUS les projets accessibles à
 * l'utilisateur (api.publications.resolveCarouselForUser) puis redirige vers la
 * route scopée du bon projet :
 *   - carousel       → /admin/<slug>/carrousels?carouselId=X
 *   - short          → /admin/<slug>/shorts?carouselId=X
 *   - screenrecorder → /admin/<slug>/screenrecorder?carouselId=X
 *   - introuvable / inaccessible → 404 propre (notFound()).
 */
export default function CarouselIdResolver({
  params,
}: {
  params: Promise<{ carouselId: string }>;
}) {
  const { carouselId } = use(params);
  const router = useRouter();
  const resolved = useQuery(api.publications.resolveCarouselForUser, {
    carouselId,
  });

  useEffect(() => {
    if (!resolved) return;
    const segment =
      resolved.mediaType === "carousel"
        ? "/carrousels"
        : resolved.mediaType === "screenrecorder"
          ? "/screenrecorder"
          : "/shorts";
    router.replace(
      projectPath(resolved.projectSlug, `${segment}?carouselId=${carouselId}`),
    );
  }, [resolved, carouselId, router]);

  // Introuvable / inaccessible → 404 propre. notFound() doit être appelé
  // pendant le rendu (pas dans un effet) pour déclencher la boundary not-found.
  if (resolved === null) {
    notFound();
  }

  return (
    <div className="container mx-auto space-y-3 px-6 py-8">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
