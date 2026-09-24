"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { deletionConfirmed } from "@/convex/projectLifecycleRules";
import { projectPath } from "@/lib/project-path";
import { useProject } from "@/components/project/ProjectProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatNumber } from "@/lib/format";
import { useConvexError } from "@/lib/use-convex-error";

type Compteur = { n: number; plus: boolean };

/**
 * SUPPRIMER LE PROJET COURANT (superadmin) — irréversible.
 *
 * Deux freins, parce qu'un clic de trop effacerait des mois de paie : l'écran
 * DIT ce qui part (créatrices, publications, paiements…), et le bouton ne
 * s'active qu'une fois le nom du projet retapé à l'identique. Le serveur refait
 * la même comparaison (`deletionConfirmed`) : l'écran ne fait que la montrer.
 */
export function DeleteProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && <Confirmation onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Confirmation({ onClose }: { onClose: () => void }) {
  const tr = useTranslations("admin.common.DeleteProjectDialog");
  const loc = useIntlLocale();
  const showError = useConvexError();
  const router = useRouter();
  const { project } = useProject();
  const impact = useQuery(api.projectLifecycle.getProjectDeletionImpact, {
    projectId: project._id,
  });
  const projets = useQuery(api.projects.listMyProjects, {});
  const deleteProject = useMutation(api.projectLifecycle.deleteProject);
  const [saisie, setSaisie] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const confirme = deletionConfirmed(project.name, saisie);
  const nombre = (c: Compteur) =>
    c.plus ? `${formatNumber(c.n, loc)}+` : formatNumber(c.n, loc);

  async function supprimer() {
    setError(null);
    setSubmitting(true);
    // Où aller ensuite : un autre projet, choisi AVANT que celui-ci disparaisse
    // de la liste.
    const suivant = projets?.find((p) => p._id !== project._id);
    try {
      await deleteProject({ projectId: project._id, confirmation: saisie });
      toast.success(tr("projetSupprime", { name: project.name }));
      onClose();
      router.replace(suivant ? projectPath(suivant.slug, "/dashboard") : "/");
    } catch (err) {
      setError(showError(err, tr("suppressionImpossible")));
      setSubmitting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-rose-700">
          <TriangleAlertIcon className="size-5" />
          {tr("supprimerLeProjet", { name: project.name })}
        </DialogTitle>
        <DialogDescription>{tr("irreversible")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        {impact === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : impact === null ? null : impact.protege ? (
          <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            {tr("projetProtege", { name: impact.name })}
          </p>
        ) : (
          <>
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2.5 text-sm text-rose-900">
              <p className="font-medium">{tr("serontEffaces")}</p>
              <ul
                data-testid="impact-suppression"
                className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums"
              >
                <li>{tr("creatrices", { n: nombre(impact.compteurs.creatrices) })}</li>
                <li>{tr("comptes", { n: nombre(impact.compteurs.comptes) })}</li>
                <li>{tr("assignations", { n: nombre(impact.compteurs.assignations) })}</li>
                <li>{tr("publications", { n: nombre(impact.compteurs.publications) })}</li>
                <li>{tr("paiements", { n: nombre(impact.compteurs.paiements) })}</li>
                <li>{tr("membres", { n: nombre(impact.compteurs.membres) })}</li>
              </ul>
              <p className="mt-2 text-xs text-rose-800/80">{tr("etLeReste")}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="delete-project-confirm">
                {tr("tapeLeNom", { name: project.name })}
              </Label>
              <Input
                id="delete-project-confirm"
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-rose-600">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {tr("annuler")}
        </Button>
        {impact && !impact.protege && (
          <Button
            type="button"
            variant="destructive"
            disabled={!confirme || submitting}
            onClick={supprimer}
          >
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            {tr("supprimerDefinitivement")}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
