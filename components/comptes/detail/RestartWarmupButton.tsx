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
import { useTranslations } from "next-intl";

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
  const tr = useTranslations("admin.accounts.RestartWarmupButton");
  const restart = useProjectMutation(api.comptes.restartWarmup);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const days = getWarmupDuration(plateforme);

  async function onConfirm() {
    setBusy(true);
    try {
      await restart({ id: compteId });
      toast.success(tr("warmupRelanceEchauffementRepartiPour", { days: days }));
      setOpen(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, tr("echecDeLaRelanceDu")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <RotateCcwIcon className="mr-2 size-4" />
        {tr("relancerLeWarmup")}
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tr("relancerLeWarmupDeCe")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tr("ilRepasseraEnEchauffementPour", { days: days })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{tr("annuler")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void onConfirm();
              }}
              disabled={busy}
            >
              {busy && <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />}
              {tr("confirmer")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
