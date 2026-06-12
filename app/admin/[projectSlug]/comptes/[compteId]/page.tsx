"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import { CompteDetailView } from "@/components/comptes/detail/CompteDetailView";
import { CompteDetailSkeleton } from "@/components/comptes/detail/CompteDetailSkeleton";

/**
 * Vue détail d'un compte : calendrier des publications, stats agrégées et
 * liste par format.
 *
 * Client Component (vs Server) — pattern du repo (cf app/p/[carouselId]) : les
 * queries Convex se font via useQuery côté client. Le compte est résolu
 * client-side depuis listComptes (déjà chargée ailleurs → cache chaud), sans
 * query getCompte dédiée. Compte introuvable → redirect /comptes.
 */
export default function CompteDetailPage({
  params,
}: {
  params: Promise<{ compteId: string }>;
}) {
  const { compteId } = use(params);
  const router = useRouter();
  const projectPath = useProjectPath();
  const comptes = useProjectQuery(api.comptes.listComptes, {});
  const compte = comptes?.find((c) => c._id === compteId);

  useEffect(() => {
    if (comptes !== undefined && compte === undefined) {
      router.replace(projectPath("/comptes"));
    }
  }, [comptes, compte, router, projectPath]);

  if (comptes === undefined) return <CompteDetailSkeleton />;
  if (compte === undefined) return null; // redirection en cours

  return <CompteDetailView compte={compte} />;
}
