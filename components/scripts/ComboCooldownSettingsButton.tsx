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
import { ComboCooldownSettingsCard } from "./ComboCooldownSettingsCard";

/**
 * Réglage du cooldown de combo, ouvert depuis l'écran /scripts.
 *
 * Même arrangement que `WarmupSettingsButton` et pour la même raison : le dépôt
 * n'a pas de route « réglages du projet », et en créer une pour un champ ferait
 * un écran qu'on ne retrouverait pas. Le panneau vit là où les scripts se
 * regardent.
 */
export function ComboCooldownSettingsButton() {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline" data-testid="combo-cooldown-button">
            <SlidersHorizontalIcon className="mr-2 size-4" />
            Cooldown
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b border-slate-100 p-4">
          <SheetTitle>Cooldown des scripts — ce projet</SheetTitle>
          <SheetDescription>
            À quel écart un même script peut repartir sur un autre compte.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <ComboCooldownSettingsCard />
        </div>
      </SheetContent>
    </Sheet>
  );
}
