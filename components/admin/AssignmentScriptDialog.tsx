"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";

/**
 * Lecture seule du SCRIPT MONTÉ d'un assignment de script. Affiche
 * l'`assembledScript` FIGÉ (texte autonome déjà livré au créateur, rendu sans
 * titres markdown — cf refonte #44) : on NE le re-dérive PAS des briques. En
 * en-tête : le combo (Tier · Flux · CTA), le créateur et les plateformes cibles.
 */
export function AssignmentScriptDialog({
  open,
  onOpenChange,
  script,
  comboSummary,
  creatorName,
  platforms,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  script: string;
  comboSummary: string | null;
  creatorName: string;
  platforms: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Script monté — {creatorName}</DialogTitle>
          <DialogDescription>
            {comboSummary ?? "Script de la vidéo"}
            {platforms.length > 0 ? ` · ${platforms.join(", ")}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <SimpleMarkdown content={script} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
