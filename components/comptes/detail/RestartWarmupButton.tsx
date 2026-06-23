"use client";

import { useState } from "react";
import { RotateCcwIcon, Loader2Icon } from "lucide-react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getWarmupDuration, type Plateforme } from "@/lib/compte-status";
import { convexErrorMessage } from "@/lib/convex-error";
import { toast } from "sonner";

/**
 * Bouton admin « Relancer le warmup » + confirmation (AlertDialog). Remet le
 * compte en échauffement pour la durée plateforme courante (7 j TikTok/YouTube,
 * 14 j Instagram) via api.comptes.restartWarmup — compteur de checks remis à
 * zéro. Pas destructif (aucune publication/assignment supprimé) mais ça change
 * l'état publiable du compte (warmup-gated) → confirmation justifiée. Le N
 * annoncé dérive du même barème que le serveur (getWarmupDuration).
 */
export function RestartWarmupButton({
  compteId,
  plateforme,
}: {
  compteId: Id<"comptes">;
  plateforme: Plateforme;
}) {
  const restart = useProjectMutation(api.comptes.restartWarmup);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const days = getWarmupDuration(plateforme);

  async function onConfirm() {
    setBusy(true);
    try {
      await restart({ id: compteId });
      toast.success(`Warmup relancé — échauffement reparti pour ${days} jours.`);
      setOpen(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la relance du warmup"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <RotateCcwIcon className="mr-2 size-4" />
        Relancer le warmup
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Relancer le warmup de ce compte ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Il repassera en échauffement pour {days} jours et le créateur ne
              pourra plus y publier jusqu&apos;à la fin du warmup. Les
              publications et assignments existants ne sont pas supprimés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void onConfirm();
              }}
              disabled={busy}
            >
              {busy && <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />}
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
