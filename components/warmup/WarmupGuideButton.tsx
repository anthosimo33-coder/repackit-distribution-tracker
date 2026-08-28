"use client";

import { BookOpenIcon } from "lucide-react";
import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GuideMarkdown } from "@/components/ui/GuideMarkdown";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * Bouton « Guide warmup » de l'écran comptes — admin comme créateur.
 *
 * IL OUVRE MAINTENANT LE MODULE DU GUIDE, plus un second document. Le protocole
 * warmup vivait en double : un module « Warmup » dans le guide (résumé, en base,
 * par projet) et cet accordéon (protocole complet, en catalogue, GLOBAL). Les
 * deux se sont contredits sur la durée, les plateformes et l'ordre de supprimer
 * ou non une vidéo qui flope. Fusionnés, il n'en reste qu'un — éditable en
 * ligne, par projet, dans la langue du lecteur.
 *
 * Ce qu'on garde du panneau : la lecture SANS QUITTER le tracker. C'est là que
 * la créatrice en a besoin, pas dans un onglet qu'elle ouvre une fois.
 *
 * Ce qu'on perd, et c'est assumé : les 7 sections repliables. Le module est un
 * document markdown qu'on parcourt. La table des signaux devient une liste à
 * puces — le parser du guide ne connaît pas les tableaux.
 */
export function WarmupGuideButton({
  projectId,
  admin = false,
}: {
  /** Portail créateur : l'id de SON projet. Admin : le projet courant. */
  projectId: Id<"projects">;
  admin?: boolean;
}) {
  const twg = useTranslations("warmupGuide");
  const locale = useLocale();
  const data = useQuery(
    admin
      ? api.guideModules.getWarmupModuleForAdmin
      : api.guideModules.getMyWarmupModule,
    { projectId, locale },
  );

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline">
            <BookOpenIcon className="mr-2 size-4" />
            {twg("button")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b border-slate-100 p-4">
          <SheetTitle>{data?.module?.title ?? twg("dialogTitle")}</SheetTitle>
          <SheetDescription>{twg("dialogDesc")}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {data === undefined ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : data.module === null ? (
            <p className="text-sm text-slate-500">{twg("empty")}</p>
          ) : (
            <>
              {data.servedLocale !== data.requestedLocale && (
                <p className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {twg("fallbackNotice")}
                </p>
              )}
              <GuideMarkdown content={data.module.contentMarkdown} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
