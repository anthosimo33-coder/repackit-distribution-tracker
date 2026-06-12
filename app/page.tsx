"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { projectPath } from "@/lib/project-path";

/**
 * P3 Multi-tenant — `/` résout le projet par défaut de l'utilisateur (premier
 * projet via membership, fallback repackit pour un superadmin sans membership —
 * cf api.projects.getCurrentProject) puis redirige vers son dashboard scopé
 * `/admin/<slug>/dashboard`. Rendu sous <Authenticated> (AppShell), donc hors
 * ProjectProvider : on utilise useQuery brut (pas de projet implicite ici).
 */
export default function RootRedirectPage() {
  const router = useRouter();
  const project = useQuery(api.projects.getCurrentProject, {});

  useEffect(() => {
    if (project) {
      router.replace(projectPath(project.slug, "/dashboard"));
    }
  }, [project, router]);

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
    <div className="flex h-screen items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-slate-400" />
    </div>
  );
}
