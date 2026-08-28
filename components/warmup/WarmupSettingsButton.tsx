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

/**
 * Réglage des durées de warmup, ouvert depuis l'écran /comptes.
 *
 * PAS DE PAGE DÉDIÉE, délibérément : le dépôt n'a aucune route « réglages du
 * projet », et en créer une pour trois champs ferait un écran qu'on ne
 * retrouverait pas. Le panneau vit là où le warmup se regarde, à côté du guide,
 * et suit le même pattern (Sheet latéral).
 */
export function WarmupSettingsButton() {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline">
            <SlidersHorizontalIcon className="mr-2 size-4" />
            Durées de warmup
          </Button>
        }
      />
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b border-slate-100 p-4">
          <SheetTitle>Durées de warmup — ce projet</SheetTitle>
          <SheetDescription>
            Combien de checks avant qu&apos;un compte sorte de chauffe.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <WarmupSettingsCard />
        </div>
      </SheetContent>
    </Sheet>
  );
}
