"use client";

import { useState } from "react";
import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { useMyGuide, useMyGuideModules } from "@/components/portal/creator-data";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GuideMarkdown } from "@/components/ui/GuideMarkdown";
import { BookOpenIcon, ChevronDownIcon, LanguagesIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

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
 *
 * BILINGUE — le serveur sert le jeu de modules de la langue du lecteur et se
 * replie sur le français (cf convex/guideModuleLocale.ts). Quand le repli a
 * lieu, un BANDEAU le dit, dans la langue du lecteur. Il disparaît de lui-même
 * le jour où un module existe dans sa langue : rien à lever à la main.
 */
export default function GuideScreen() {
  const tg = useTranslations("portal.guide");
  const projectId = useCreatorProjectId();
  const guide = useMyGuideModules(projectId);
  const modules = guide?.modules;
  const legacy = useMyGuide(projectId);

  // REPLI : la langue servie n'est pas celle demandée — il n'y a pas de jeu
  // dans la langue du lecteur. Le bandeau ne s'affiche QUE s'il surplombe du
  // contenu français réel : au-dessus de l'état vide (« le guide arrive
  // bientôt », déjà rendu en anglais) il annoncerait un guide français qui
  // n'existe pas. Le legacy mono-bloc, lui, EST du français : il compte.
  const fellBack =
    guide !== undefined && guide.servedLocale !== guide.requestedLocale;
  const hasFrenchContent =
    (modules !== undefined && modules.length > 0) ||
    (legacy !== undefined && legacy.content.trim().length > 0);

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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tg("title")}</h1>
        <p className="text-sm text-slate-500">{tg("subtitle")}</p>
      </header>

      {fellBack && hasFrenchContent && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
        >
          <LanguagesIcon aria-hidden className="size-4 shrink-0 text-slate-400" />
          {tg("fallbackNotice")}
        </p>
      )}

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
            <p className="text-base font-medium text-slate-900">{tg("soonTitle")}</p>
            <p className="text-sm text-slate-500">{tg("soonBody")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
