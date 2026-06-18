"use client";

import { useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontalIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { getEffectiveStatus } from "@/lib/compte-status";
import type { Compte } from "@/components/comptes/CompteDialog";

/**
 * Chantier D — actions ADMIN sur un compte (créateur ou interne) : Modifier
 * (callback → CompteDialog), Archiver/Réactiver (archiveCompte/unarchiveCompte),
 * Supprimer (SSI vierge — `compte.inUse === false` ; sinon item désactivé
 * « archive-le »). Le serveur re-vérifie (deleteCompte → compteUsage). Partagé
 * entre la table /comptes et la fiche créateur.
 */
export function CompteAdminActions({
  compte,
  onEdit,
}: {
  compte: Compte;
  onEdit: () => void;
}) {
  const archive = useProjectMutation(api.comptes.archiveCompte);
  const unarchive = useProjectMutation(api.comptes.unarchiveCompte);
  const deleteCompte = useProjectMutation(api.comptes.deleteCompte);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isArchived = getEffectiveStatus(compte) === "archived";

  async function toggleArchive() {
    try {
      if (isArchived) {
        await unarchive({ id: compte._id });
        toast.success(`${compte.handle} réactivé`);
      } else {
        await archive({ id: compte._id });
        toast.success(`${compte.handle} archivé`);
      }
    } catch (e) {
      toast.error(convexErrorMessage(e, "Erreur"));
    }
  }

  async function confirmDelete() {
    setSubmitting(true);
    try {
      await deleteCompte({ id: compte._id });
      toast.success(`${compte.handle} supprimé`);
      setConfirmOpen(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Erreur"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className="size-8 p-0">
              <MoreHorizontalIcon className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>Modifier</DropdownMenuItem>
          <DropdownMenuItem onClick={toggleArchive}>
            {isArchived ? "Réactiver" : "Archiver"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {compte.inUse ? (
            <DropdownMenuItem disabled className="text-slate-400">
              Supprimer — compte utilisé, archive-le
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() => setConfirmOpen(true)}
              className="text-rose-600 focus:text-rose-700"
            >
              Supprimer
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => !submitting && setConfirmOpen(o)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer définitivement {compte.handle} ?</DialogTitle>
            <DialogDescription>
              Action irréversible. Ce compte est vierge (aucune publication,
              assignment ou paiement) — il sera supprimé définitivement.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={submitting}
            >
              {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
