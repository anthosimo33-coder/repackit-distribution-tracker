"use client";

import { useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

/**
 * Confirmation RENFORCÉE de suppression d'un créateur (opération la plus
 * destructrice). Partagée par la liste créateurs et la fiche détaillée :
 *  - récap supprimé vs conservé (compteurs réels via getCreatorDeletionImpact) ;
 *  - saisie du NOM EXACT requise pour activer le bouton (pattern GitHub) ;
 *  - bouton destructif + état de chargement, fermeture bloquée pendant la mutation.
 * `onDeleted` permet à l'appelant de rediriger (depuis la fiche → liste).
 */
export function DeleteCreatorDialog({
  creatorId,
  creatorName,
  open,
  onOpenChange,
  onDeleted,
}: {
  creatorId: Id<"creators">;
  creatorName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const impact = useProjectQuery(
    api.creators.getCreatorDeletionImpact,
    open ? { id: creatorId } : "skip",
  );
  const deleteCreator = useProjectMutation(api.creators.deleteCreator);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const confirmed = typed.trim() === creatorName.trim();

  function handleOpenChange(next: boolean) {
    if (busy) return; // fermeture bloquée pendant la mutation
    if (!next) setTyped("");
    onOpenChange(next);
  }

  async function handleDelete() {
    if (!confirmed) return;
    setBusy(true);
    try {
      const r = await deleteCreator({ id: creatorId });
      if (r.alreadyGone) {
        toast.success("Créateur déjà supprimé.");
      } else {
        const d = r.deleted;
        toast.success(
          `${r.name} supprimé — ${d.comptes} compte${d.comptes > 1 ? "s" : ""}, ${d.assignments} mission${d.assignments > 1 ? "s" : ""} en cours. Historique conservé.`,
        );
      }
      setTyped("");
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec de la suppression du créateur"));
    } finally {
      setBusy(false);
    }
  }

  // Compteurs (impact) — non bloquant : si encore en chargement, on n'affiche pas
  // le détail mais la saisie reste possible.
  const willDelete =
    impact !== undefined && impact !== null
      ? `${impact.comptes} compte${impact.comptes > 1 ? "s" : ""} et ${impact.deletableAssignments} mission${impact.deletableAssignments > 1 ? "s" : ""} en cours`
      : null;
  const willKeep =
    impact !== undefined && impact !== null
      ? `${impact.publications} publication${impact.publications > 1 ? "s" : ""} et l'historique de paiement (${impact.payments})`
      : null;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer {creatorName} ?</AlertDialogTitle>
          <AlertDialogDescription>
            {willDelete ? (
              <>
                <span className="font-medium text-foreground">{willDelete}</span>{" "}
                seront définitivement supprimés (combos libérés). Les{" "}
                <span className="font-medium text-foreground">{willKeep}</span>{" "}
                seront conservés sous le nom «&nbsp;{creatorName}&nbsp;». Action
                irréversible.
              </>
            ) : (
              <>
                Les comptes et missions en cours de ce créateur seront
                définitivement supprimés ; ses publications et son historique de
                paiement seront conservés sous son nom. Action irréversible.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-creator-name">
            Tape «&nbsp;<span className="font-semibold">{creatorName}</span>
            &nbsp;» pour confirmer
          </Label>
          <Input
            id="confirm-creator-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={creatorName}
            autoComplete="off"
            disabled={busy}
            aria-label="Nom du créateur à confirmer"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!confirmed || busy}
            onClick={(e) => {
              // Fermeture gérée manuellement (succès) pour l'état de chargement.
              e.preventDefault();
              void handleDelete();
            }}
          >
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Supprimer définitivement
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
