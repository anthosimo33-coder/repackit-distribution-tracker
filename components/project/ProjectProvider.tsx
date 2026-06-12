"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

/**
 * P2 Multi-tenant — contexte du projet courant.
 *
 * ⚠️ TODO(P3) : provisoire. Le projet est résolu via api.projects
 * .getCurrentProject (membership de l'utilisateur). Quand le sélecteur de
 * projet arrivera (P3), ce provider lira le projet choisi (URL/segment) au
 * lieu du « projet par défaut ».
 *
 * Le rendu des enfants est GATÉ tant que le projet n'est pas résolu : à
 * l'intérieur de l'arbre, useProjectId() renvoie donc TOUJOURS un Id valide,
 * et les call sites passent projectId sans logique de skip.
 */
type ProjectContextValue = {
  projectId: Id<"projects">;
  project: Doc<"projects">;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const project = useQuery(api.projects.getCurrentProject, {});

  if (project === undefined) {
    return <FullPageLoader />;
  }

  if (project === null) {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-sm font-medium text-slate-900">
            Aucun projet accessible
          </p>
          <p className="text-sm text-slate-500">
            Ton compte n&apos;est rattaché à aucun projet. Demande à un
            administrateur de t&apos;ajouter à un projet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ProjectContext.Provider value={{ projectId: project._id, project }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProject must be used within ProjectProvider");
  }
  return ctx;
}

/** Raccourci : l'Id du projet courant (toujours défini sous ProjectProvider). */
export function useProjectId(): Id<"projects"> {
  return useProject().projectId;
}

function FullPageLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-slate-400" />
    </div>
  );
}
