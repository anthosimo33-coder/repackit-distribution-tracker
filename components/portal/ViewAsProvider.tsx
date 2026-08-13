"use client";

import Link from "next/link";
import { Loader2Icon, ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProject, useProjectPath } from "@/components/project/ProjectProvider";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { resolveCreatorKind } from "@/convex/roles";
import {
  CreatorProjectContext,
  type CreatorProject,
} from "@/components/portal/CreatorProjectProvider";
import { ViewAsContextProvider } from "@/components/portal/ViewAsContext";
import { viewAsBase } from "@/lib/view-as";

/**
 * Admin « voir l'espace d'un créateur » (LECTURE SEULE) — provider de données du
 * mode view-as. Monté SOUS ProjectProvider (qui résout le projet par slug et gate
 * l'accès admin/superadmin côté client ; la vraie barrière reste serveur).
 *
 * Il résout le créateur ciblé via api.creators.getCreator (adminQuery : renvoie
 * null si la fiche n'est pas dans le projet de l'admin → DÉFENSE EN PROFONDEUR,
 * en plus de la vérif serveur de chaque query view-as). Puis il alimente :
 *   - CreatorProjectContext avec un projet UNIQUE synthétique (branding du projet
 *     + nom du créateur ciblé) → les écrans portail réutilisés fonctionnent sans
 *     modification (useCreatorProject / useCreatorProjectId) ;
 *   - ViewAsContext (creatorId + nom + base path) → indirection des données et
 *     rendu lecture seule.
 */
export function ViewAsProvider({
  creatorId,
  children,
}: {
  creatorId: Id<"creators">;
  children: ReactNode;
}) {
  const { project } = useProject();
  const projectPath = useProjectPath();
  const creator = useProjectQuery(api.creators.getCreator, { id: creatorId });

  if (creator === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-slate-400" />
      </div>
    );
  }

  // Fiche hors projet (ou introuvable) → aucune donnée, retour à la liste. Le
  // scoping serveur empêche déjà toute fuite ; ceci n'est que l'UX du cas refusé.
  if (creator === null) {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-sm font-medium text-slate-900">
            Créateur introuvable
          </p>
          <p className="text-sm text-slate-500">
            Ce créateur n&apos;existe pas dans ce projet.
          </p>
          <Link
            href={projectPath("/createurs")}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700"
          >
            <ArrowLeftIcon className="size-4" />
            Retour aux créateurs
          </Link>
        </div>
      </div>
    );
  }

  const current: CreatorProject = {
    projectId: project._id,
    slug: project.slug,
    name: project.name,
    accentColor: project.accentColor,
    logoUrl: project.logoUrl ?? null,
    payoutDay: project.payoutDay,
    creatorName: creator.name,
    payCurrency: project.payCurrency ?? null,
  };

  return (
    <CreatorProjectContext.Provider
      value={{ current, projects: [current], setProjectId: () => {} }}
    >
      <ViewAsContextProvider
        value={{
          creatorId,
          creatorName: creator.name,
          creatorKind: resolveCreatorKind(creator.kind),
          basePath: viewAsBase(project.slug, creatorId),
        }}
      >
        {children}
      </ViewAsContextProvider>
    </CreatorProjectContext.Provider>
  );
}
