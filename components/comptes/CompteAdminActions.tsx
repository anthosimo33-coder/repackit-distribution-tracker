"use client";

import { useState } from "react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { getEffectiveStatus } from "@/lib/compte-status";
import { CompteReassignDialog } from "@/components/comptes/CompteReassignDialog";
import type { Compte } from "@/components/comptes/CompteDialog";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatNumber } from "@/lib/format";
import { useConvexError } from "@/lib/use-convex-error";


/**
 * Chantier D — actions ADMIN sur un compte (créateur ou interne) : Modifier
 * (callback → CompteDialog), Réassigner (propriétaire/gestionnaire/mode),
 * Archiver/Réactiver (archiveCompte/unarchiveCompte), Supprimer. Partagé entre
 * la table /comptes, la fiche compte et la fiche créateur.
 *
 * SUPPRESSION — jamais de clic sec : la confirmation charge getCompteUsage et
 * récapitule le handle + ce qui est rattaché. Compte VIERGE → suppression
 * franche. Compte AVEC HISTORIQUE → suppression refusée (garde serveur
 * deleteCompte, la publication est rapprochée par HANDLE et deviendrait
 * intraçable) et l'archivage est proposé À LA PLACE, dans le même dialog.
 */
export function CompteAdminActions({
  compte,
  onEdit,
  onDeleted,
}: {
  compte: Compte;
  onEdit: () => void;
  /** Appelé après une suppression réussie (la fiche détail doit repartir). */
  onDeleted?: () => void;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.common.CompteAdminActions");
  const loc = useIntlLocale();
  const archive = useProjectMutation(api.comptes.archiveCompte);
  const unarchive = useProjectMutation(api.comptes.unarchiveCompte);
  const deleteCompte = useProjectMutation(api.comptes.deleteCompte);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isArchived = getEffectiveStatus(compte) === "archived";

  // Références RÉELLES du compte (autorité serveur, re-vérifiée par la mutation).
  // Chargée seulement quand la confirmation est ouverte.
  const usage = useProjectQuery(
    api.comptes.getCompteUsage,
    confirmOpen ? { id: compte._id } : "skip",
  );

  async function toggleArchive() {
    try {
      if (isArchived) {
        await unarchive({ id: compte._id });
        toast.success(tr("reactive", { handle: compte.handle }));
      } else {
        await archive({ id: compte._id });
        toast.success(tr("archive", { handle: compte.handle }));
      }
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    }
  }

  async function confirmDelete() {
    setSubmitting(true);
    try {
      await deleteCompte({ id: compte._id });
      toast.success(tr("supprime", { handle: compte.handle }));
      setConfirmOpen(false);
      onDeleted?.();
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setSubmitting(false);
    }
  }

  /** Archivage depuis le dialog de suppression (compte avec historique). */
  async function archiveInstead() {
    setSubmitting(true);
    try {
      await archive({ id: compte._id });
      toast.success(tr("archiveHistoriqueConserve", { handle: compte.handle }));
      setConfirmOpen(false);
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0"
              // ⚠️ Label GÉNÉRIQUE, sans le handle : le nom accessible du bouton
              // remonte sur la <TableCell> qui le contient, et un
              // getByRole("cell", { name: "@handle" }) (match par sous-chaîne)
              // matcherait alors DEUX cellules — strict mode violation dans les
              // ~10 specs qui repèrent une ligne par sa cellule handle. Les
              // specs scopent déjà par ligne : "Actions" suffit à désambiguïser.
              aria-label={tr("actions")}
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>{tr("modifier")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setReassignOpen(true)}>
            {tr("reassigner")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={toggleArchive}>
            {isArchived ? tr("reactiver") : tr("archiver")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setConfirmOpen(true)}
            className="text-rose-600 focus:text-rose-700"
          >
            {tr("supprimer")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CompteReassignDialog
        compte={compte}
        open={reassignOpen}
        onOpenChange={setReassignOpen}
      />

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => !submitting && setConfirmOpen(o)}
      >
        <DialogContent data-testid="compte-delete-dialog">
          <DialogHeader>
            <DialogTitle>{tr("supprimer2", { handle: compte.handle })}</DialogTitle>
            <DialogDescription>
              {usage === undefined
                ? tr("verificationDesDonneesRattachees")
                : usage.inUse
                  ? tr("ceCompteAUnHistorique")
                  : tr("actionIrreversible")}
            </DialogDescription>
          </DialogHeader>

          {usage === undefined ? (
            <Skeleton className="h-20 w-full" />
          ) : usage.inUse ? (
            <div className="min-w-0 space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-medium">
                {tr("rattacheA", { handle: compte.handle })}{" "}
                {[
                  usage.publications > 0 &&
                    tr("usagePublications", {
                      count: usage.publications,
                      views: formatNumber(usage.views, loc),
                    }),
                  usage.assignments > 0 &&
                    tr("usageMissions", { count: usage.assignments }),
                  usage.payments > 0 && tr("ligneDePaie", { payments: usage.payments }),
                ]
                  .filter(Boolean)
                  .join(", ")}
                .
              </p>
              <p className="text-xs">
                {tr("supprimerLaFicheRendraitCes")}{" "}
                {isArchived
                  ? tr("ceCompteEstDejaArchive")
                  : tr("archiveLeIlSortDes")}
              </p>
            </div>
          ) : (
            <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {tr("estViergeAucunePublicationAucune", { handle: compte.handle })}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              {tr("annuler")}
            </Button>
            {usage !== undefined && usage.inUse ? (
              !isArchived && (
                <Button onClick={archiveInstead} disabled={submitting}>
                  {submitting && (
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                  )}
                  {tr("archiverALaPlace")}
                </Button>
              )
            ) : (
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={submitting || usage === undefined}
              >
                {submitting && (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                )}
                {tr("supprimer3")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
