"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { Button } from "@/components/ui/button";
import { RepeatIcon } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { ReplayScriptLauncher } from "@/components/admin/ReplayScriptLauncher";

/**
 * Lecture seule du SCRIPT MONTÉ d'un assignment de script. Affiche
 * l'`assembledScript` FIGÉ (texte autonome déjà livré au créateur, rendu sans
 * titres markdown — cf refonte #44) : on NE le re-dérive PAS des briques. En
 * en-tête : le combo (Tier · Flux · CTA), le créateur et les plateformes cibles,
 * plus « Rejouer ce script » (endroit ÉVIDENT du rejeu : on lit le script, on
 * décide de le rejouer) → ouvre la modale d'assignation pré-remplie.
 */
export function AssignmentScriptDialog({
  open,
  onOpenChange,
  assignmentId,
  script,
  comboSummary,
  creatorName,
  platforms,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assignmentId: Id<"assignments">;
  script: string;
  comboSummary: string | null;
  creatorName: string;
  platforms: string[];
}) {
  const [replayOpen, setReplayOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Script monté — {creatorName}</DialogTitle>
          <DialogDescription>
            {comboSummary ?? "Script de la vidéo"}
            {platforms.length > 0 ? ` · ${platforms.join(", ")}` : ""}
          </DialogDescription>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-fit gap-1.5"
            onClick={() => setReplayOpen(true)}
          >
            <RepeatIcon className="size-4" />
            Rejouer ce script
          </Button>
        </DialogHeader>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <SimpleMarkdown content={script} />
        </div>

        {/* Rejeu depuis le script monté : modale d'assignation pré-remplie avec
            le combo de CETTE assignation (lignage replayedFrom = assignmentId). */}
        <ReplayScriptLauncher
          source={replayOpen ? { assignmentId } : null}
          onClose={() => setReplayOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
