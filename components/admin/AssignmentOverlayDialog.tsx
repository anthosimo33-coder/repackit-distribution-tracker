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

const OVERLAY_MAX = 200;

/**
 * Édition du texte OVERLAY d'un assignment existant (ajout / modif / effacement).
 * Vide → efface l'overlay (aucun encart côté créateur). Le champ est aussi
 * saisissable à la création (Assign*Dialog) ; ici c'est l'édition après coup.
 */
export function AssignmentOverlayDialog({
  open,
  onOpenChange,
  assignmentId,
  creatorName,
  currentOverlayText,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assignmentId: Id<"assignments">;
  creatorName: string;
  currentOverlayText: string | undefined;
}) {
  const setOverlay = useProjectMutation(
    api.assignments.setAssignmentOverlayText,
  );
  const [text, setText] = useState(currentOverlayText ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    setSubmitting(true);
    try {
      await setOverlay({
        id: assignmentId,
        overlayText: text.trim() || undefined,
      });
      toast.success(
        text.trim() ? "Texte overlay enregistré" : "Texte overlay retiré",
      );
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
          <DialogTitle>Texte à incruster en haut de la vidéo</DialogTitle>
          <DialogDescription>
            Consigne pour {creatorName} — overlay permanent affiché au-dessus du
            hook. Laisse vide pour ne rien incruster.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="overlay-edit">Texte overlay (optionnel)</Label>
          <Textarea
            id="overlay-edit"
            autoFocus
            rows={3}
            maxLength={OVERLAY_MAX}
            placeholder="Ex : Réservé aux 100 premiers"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-xs text-slate-500">
            {text.trim().length}/{OVERLAY_MAX} — apparaît en haut de la vidéo,
            au-dessus du hook côté créateur.
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
