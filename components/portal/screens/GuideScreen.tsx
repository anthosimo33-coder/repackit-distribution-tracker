"use client";

import { useState } from "react";
import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { useMyGuide, useMyGuideModules } from "@/components/portal/creator-data";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GuideMarkdown } from "@/components/ui/GuideMarkdown";
import { BookOpenIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * « Comment ça marche » — écran RÉUTILISÉ par le portail créateur normal ET le
 * mode admin « voir l'espace d'un créateur » (lecture seule). Affiche les
 * MODULES `published` du projet (système v2, édité par l'admin) en ACCORDÉONS
 * repliables : on voit la liste des titres, on déplie/replie chaque module au
 * clic. État LOCAL (useState), tous repliés au départ, ouverture INDÉPENDANTE
 * (plusieurs modules ouverts possibles). Le contenu déplié = GuideMarkdown
 * inchangé.
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

  // État d'ouverture LOCAL (session d'affichage), tous repliés au départ.
  // Set = ouverture indépendante (déplier un module n'en referme aucun autre).
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : modules.length > 0 ? (
        <div className="space-y-3">
          {modules.map((m) => {
            const id = String(m._id);
            const open = openIds.has(id);
            return (
              <Card key={m._id} className="gap-0 py-0">
                <h2>
                  <button
                    type="button"
                    id={`guide-h-${id}`}
                    aria-expanded={open}
                    aria-controls={`guide-p-${id}`}
                    onClick={() => toggle(id)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/50"
                  >
                    <span className="text-base font-semibold text-slate-900">
                      {m.title}
                    </span>
                    <ChevronDownIcon
                      aria-hidden
                      className={cn(
                        "size-5 shrink-0 text-slate-400 transition-transform duration-200",
                        open && "rotate-180",
                      )}
                    />
                  </button>
                </h2>
                {open && (
                  <div
                    id={`guide-p-${id}`}
                    role="region"
                    aria-labelledby={`guide-h-${id}`}
                    className="border-t border-slate-100 px-5 py-5 duration-200 animate-in fade-in-0 slide-in-from-top-1"
                  >
                    <GuideMarkdown content={m.contentMarkdown} />
                  </div>
                )}
              </Card>
            );
          })}
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
