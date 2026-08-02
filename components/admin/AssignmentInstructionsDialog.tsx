"use client";

import { useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

// Aligné sur INSTRUCTIONS_MAX_LENGTH (convex/assignments.ts) — le serveur tronque
// de toute façon ; ici on borne la saisie et on affiche le compteur.
const INSTRUCTIONS_MAX = 1000;

/**
 * Édition des INSTRUCTIONS libres d'un assignment existant (ajout / modif /
 * effacement). Consigne PROPRE À CETTE assignation (deux créatrices d'un même
 * script peuvent en recevoir de différentes). Vide → efface (aucun bloc côté
 * créatrice). Même patron que AssignmentOverlayDialog, mais multi-ligne.
 */
export function AssignmentInstructionsDialog({
  open,
  onOpenChange,
  assignmentId,
  creatorName,
  currentInstructions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assignmentId: Id<"assignments">;
  creatorName: string;
  currentInstructions: string | undefined;
}) {
  const setInstructions = useProjectMutation(
    api.assignments.setAssignmentInstructions,
  );
  const [text, setText] = useState(currentInstructions ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    setSubmitting(true);
    try {
      await setInstructions({
        id: assignmentId,
        instructions: text.trim() || undefined,
      });
      toast.success(text.trim() ? "Instructions enregistrées" : "Instructions retirées");
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Instructions pour {creatorName}</DialogTitle>
          <DialogDescription>
            Consigne libre affichée dans le brief de {creatorName} (ex. « filme en
            extérieur », « accent sur le hook les 2 premières secondes »). Propre à
            cette assignation. Laisse vide pour n&apos;afficher aucun bloc.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="instructions-edit">Instructions (optionnel)</Label>
          <Textarea
            id="instructions-edit"
            autoFocus
            rows={5}
            maxLength={INSTRUCTIONS_MAX}
            placeholder="Ex : reprends la vidéo modèle mais plus court, mets le produit à la fin."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-xs text-slate-500">
            {text.trim().length}/{INSTRUCTIONS_MAX} — visible par la créatrice dans
            son brief, distinct du script.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
