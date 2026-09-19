"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { WarmupSettingsCard } from "./WarmupSettingsCard";
import { AccountValidationSettingsCard } from "./AccountValidationSettingsCard";
import { usePermissions } from "@/components/project/use-permissions";
import { useTranslations } from "next-intl";

/**
 * Réglage des durées de warmup, ouvert depuis l'écran /comptes.
 *
 * PAS DE PAGE DÉDIÉE, délibérément : le dépôt n'a aucune route « réglages du
 * projet », et en créer une pour trois champs ferait un écran qu'on ne
 * retrouverait pas. Le panneau vit là où le warmup se regarde, à côté du guide,
 * et suit le même pattern (Sheet latéral).
 */
export function WarmupSettingsButton() {
  const tr = useTranslations("admin.accounts.WarmupSettingsButton");
  // Réglage de PROJET (durée de chauffe) : le manager pilote les comptes,
  // il ne fixe pas la règle qui s'applique à toutes les créatrices.
  const droits = usePermissions();
  if (!droits.has("project.settings")) return null;
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline">
            <SlidersHorizontalIcon className="mr-2 size-4" />
            {tr("dureesDeWarmup")}
          </Button>
        }
      />
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b border-slate-100 p-4">
          <SheetTitle>{tr("dureesDeWarmupCeProjet")}</SheetTitle>
          <SheetDescription>
            {tr("combienDeChecksAvantQu")}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <WarmupSettingsCard />
          {/* Même panneau : la validation est l'étape qui SUIT la chauffe, et
              le dépôt n'a pas de route « réglages du projet » (cf plus haut). */}
          <AccountValidationSettingsCard />
        </div>
      </SheetContent>
    </Sheet>
  );
}
