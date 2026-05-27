"use client";

import { BookOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { WarmupGuideAccordion } from "./WarmupGuideAccordion";

/**
 * Bouton « Guide warmup » du header /comptes. Ouvre un Sheet latéral contenant
 * le WarmupGuideAccordion.
 *
 * Choix Sheet (vs Dialog) : le guide est du contenu de référence long et
 * scrollable (7 sections) ; un panneau latéral donne plus de hauteur de lecture
 * et un ressenti moins bloquant qu'un Dialog centré (qui plafonnerait la
 * hauteur). Cohérent avec le pattern modal du repo.
 */
export function WarmupGuideButton() {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline">
            <BookOpenIcon className="mr-2 size-4" />
            Guide warmup
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b border-slate-100 p-4">
          <SheetTitle>Guide warmup — TikTok, Instagram, YouTube</SheetTitle>
          <SheetDescription>
            Procédure de chauffe par plateforme, consultable sans quitter le
            tracker.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <WarmupGuideAccordion />
        </div>
      </SheetContent>
    </Sheet>
  );
}
