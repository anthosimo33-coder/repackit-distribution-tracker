"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeftIcon } from "lucide-react";
import { CreatorDetailView } from "@/components/creators/CreatorDetailView";

/**
 * P1 Créateurs — fiche détaillée. Le créateur est résolu serveur via
 * api.creators.getCreator (scopé admin + projet). null = introuvable ou hors
 * projet → retour à la liste.
 *
 * DEUX LECTURES depuis le découpage financier : l'identité par `getCreator`, la
 * rémunération par `getCreatorPayTerms` (bloc `creators.pay_terms`). Elles sont
 * appelées ICI plutôt que dans la vue, et le squelette attend LES DEUX : sans ça
 * les champs d'argent s'afficheraient vides une fraction de seconde avant de se
 * remplir. L'admin ne doit rien remarquer du découpage — un clignotement serait
 * déjà un changement visible.
 */
export default function CreatorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const projectPath = useProjectPath();
  const creator = useProjectQuery(api.creators.getCreator, {
    id: id as Id<"creators">,
  });
  const payTerms = useProjectQuery(api.creators.getCreatorPayTerms, {
    id: id as Id<"creators">,
  });

  useEffect(() => {
    if (creator === null) router.replace(projectPath("/createurs"));
  }, [creator, router, projectPath]);

  return (
    <div className="space-y-6">
      <Link
        href={projectPath("/createurs")}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />
        Retour aux créateurs
      </Link>

      {creator === undefined || payTerms === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : creator === null ? null : (
        <CreatorDetailView creator={creator} payTerms={payTerms} />
      )}
    </div>
  );
}
