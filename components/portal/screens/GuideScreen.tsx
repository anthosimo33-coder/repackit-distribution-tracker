"use client";

import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { useMyGuide, useMyGuideModules } from "@/components/portal/creator-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GuideMarkdown } from "@/components/ui/GuideMarkdown";
import { BookOpenIcon } from "lucide-react";

/**
 * « Comment ça marche » — écran RÉUTILISÉ par le portail créateur normal ET le
 * mode admin « voir l'espace d'un créateur » (lecture seule). Affiche les
 * MODULES `published` du projet (système v2, édité par l'admin), rendus
 * proprement (markdown → contenu lisible, mobile-friendly).
 *
 * Transition : tant qu'aucun module n'est publié, on retombe sur l'ancien guide
 * mono-bloc (projectGuide, via useMyGuide) → le contenu existant n'est jamais
 * perdu et la page n'est jamais vide. Les deux hooks gèrent l'indirection
 * view-as (creator-data) : même rendu en mode « voir l'espace d'un créateur ».
 */
export default function GuideScreen() {
  const projectId = useCreatorProjectId();
  const modules = useMyGuideModules(projectId);
  const legacy = useMyGuide(projectId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Comment ça marche
        </h1>
        <p className="text-sm text-slate-500">
          Le guide de ton espace créateur.
        </p>
      </header>

      {modules === undefined ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : modules.length > 0 ? (
        <div className="space-y-4">
          {modules.map((m) => (
            <Card key={m._id}>
              <CardHeader>
                <CardTitle className="text-lg">{m.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <GuideMarkdown content={m.contentMarkdown} />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : legacy === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : legacy.content.trim().length > 0 ? (
        // Fallback : ancien guide mono-bloc tant qu'aucun module n'est publié.
        <Card>
          <CardContent className="py-6">
            <GuideMarkdown content={legacy.content} />
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
          <BookOpenIcon className="size-12 text-slate-300" strokeWidth={1.5} />
          <div className="space-y-1">
            <p className="text-base font-medium text-slate-900">
              Le guide arrive bientôt
            </p>
            <p className="text-sm text-slate-500">
              Le contenu de ton espace est en cours de préparation.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
