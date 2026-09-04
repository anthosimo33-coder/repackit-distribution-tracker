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
  // Les droits de la personne connectée décident si la SECONDE lecture a lieu.
  // Sans ce garde-fou, un manager sans `creators.pay_terms` déclencherait une
  // query qui lève, et l'écran entier tomberait — pour un droit manquant, pas
  // pour une erreur. Un écran amputé vaut mieux qu'un écran cassé.
  const perms = useProjectQuery(api.projects.getMyPermissions, {});
  const canSeePayTerms = perms?.permissions.includes("creators.pay_terms");
  const payTerms = useProjectQuery(
    api.creators.getCreatorPayTerms,
    canSeePayTerms ? { id: id as Id<"creators"> } : "skip",
  );

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

      {creator === undefined ||
      perms === undefined ||
      (canSeePayTerms && payTerms === undefined) ? (
        <Skeleton className="h-96 w-full" />
      ) : creator === null ? null : (
        <CreatorDetailView
          creator={creator}
          // `null` a DEUX sens ici, et un seul intéresse l'écran : soit la fiche
          // n'a pas de conditions (impossible, la query rend un objet), soit la
          // personne n'a pas le droit de les voir. `canSeePayTerms` tranche.
          payTerms={canSeePayTerms ? (payTerms ?? null) : null}
          canEditPayTerms={canSeePayTerms === true}
        />
      )}
    </div>
  );
}
