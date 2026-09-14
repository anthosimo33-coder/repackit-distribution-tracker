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
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

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
  const showError = useConvexError();
  const tr = useTranslations("admin.creators.DeleteCreatorDialog");
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
        toast.success(tr("createurDejaSupprime"));
      } else {
        const d = r.deleted;
        toast.success(
          tr("supprimeCompteMissionEnCours", { name: r.name, comptes: d.comptes, assignments: d.assignments }),
        );
      }
      setTyped("");
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      toast.error(showError(e, tr("echecDeLaSuppressionDu")));
    } finally {
      setBusy(false);
    }
  }

  // Compteurs (impact) — non bloquant : si encore en chargement, on n'affiche pas
  // le détail mais la saisie reste possible.
  // Le contrat n'apparaît QUE s'il y en a un : la phrase de confirmation ne doit
  // pas s'allonger d'un « 0 contrat » sur l'immense majorité des fiches — mais
  // quand un PDF signé est sur le point de partir, on ne le tait pas.
  const willDelete =
    impact !== undefined && impact !== null
      ? `${impact.comptes} compte${impact.comptes > 1 ? "s" : ""} et ${impact.deletableAssignments} mission${impact.deletableAssignments > 1 ? "s" : ""} en cours${
          impact.contracts > 0
            ? `, ${impact.contracts} contrat${impact.contracts > 1 ? "s" : ""}`
            : ""
        }`
      : null;
  const willKeep =
    impact !== undefined && impact !== null
      ? `${impact.publications} publication${impact.publications > 1 ? "s" : ""} et l'historique de paiement (${impact.payments})`
      : null;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tr("supprimer", { creatorName: creatorName })}</AlertDialogTitle>
          <AlertDialogDescription>
            {willDelete ? (
              <>
                <span className="font-medium text-foreground">{willDelete}</span>{" "}{tr("serontDefinitivementSupprimesCombosLiber")}{" "}
                <span className="font-medium text-foreground">{willKeep}</span>{" "}{tr("serontConservesSousLeNom", { creatorName: creatorName })}
              </>
            ) : (
              <>
                {tr("lesComptesEtMissionsEn")}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-creator-name">
            {tr("tape")}{" "}<span className="font-semibold">{creatorName}</span>{" "}{tr("pourConfirmer")}
          </Label>
          <Input
            id="confirm-creator-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={creatorName}
            autoComplete="off"
            disabled={busy}
            aria-label={tr("nomDuCreateurAConfirmer")}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{tr("annuler")}</AlertDialogCancel>
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
            {tr("supprimerDefinitivement")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
