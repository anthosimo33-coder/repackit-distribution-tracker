"use client";

import { useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangleIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import { handleWarning } from "@/convex/handleHygiene";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * FILE DE VALIDATION des comptes déclarés par un clippeur.
 *
 * L'admin valide (le compte passe actif, ce qui POSE l'ancre de phase et démarre
 * son compteur de jours) ou refuse avec un motif.
 *
 * L'audit de pseudo est rendu en AVERTISSEMENT, jamais en blocage : « snytchfan »
 * n'est pas « snytch_officiel », et c'est un jugement humain. Rien dans cet écran
 * n'empêche de valider un compte signalé.
 *
 * La section disparaît quand la file est vide — un bloc « aucun compte à valider »
 * permanent en tête d'écran serait du bruit sur la page la plus consultée.
 */
export function ComptesAValiderSection() {
  const showError = useConvexError();
  const loc = useIntlLocale();
  const tr = useTranslations("admin.accounts.ComptesAValiderSection");
  const tWarn = useTranslations("admin.accounts.handleWarning");
  const file = useProjectQuery(api.comptes.listComptesAValider, {});
  const updateCompte = useProjectMutation(api.comptes.updateCompte);
  const refuseCompte = useProjectMutation(api.comptes.refuseCompte);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refusing, setRefusing] = useState<{
    id: Id<"comptes">;
    handle: string;
  } | null>(null);
  const [motif, setMotif] = useState("");

  if (file === undefined || file.length === 0) return null;

  async function valider(id: Id<"comptes">, handle: string) {
    setBusyId(id);
    try {
      // Réutilise la mutation existante : c'est ELLE qui pose l'ancre de phase
      // au premier passage en actif. La file n'invente aucune écriture.
      await updateCompte({ id, status: "actif" });
      toast.success(tr("valideSonCompteurDePhase", { handle: handle }));
    } catch (e) {
      toast.error(showError(e, tr("validationImpossible")));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmerRefus() {
    if (!refusing) return;
    setBusyId(refusing.id);
    try {
      await refuseCompte({ id: refusing.id, reason: motif });
      toast.success(tr("refuse", { handle: refusing.handle }));
      setRefusing(null);
      setMotif("");
    } catch (e) {
      toast.error(showError(e, tr("refusImpossible")));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          {tr("comptesAValider")}
        </h2>
        <Badge variant="secondary">{file.length}</Badge>
      </div>
      <Card>
        <CardContent className="divide-y divide-slate-100 p-0">
          {file.map((c) => {
            const avertissement = handleWarning(c.audit);
            return (
              <div
                key={c._id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{c.handle}</span>
                    <Badge variant="outline">{c.plateforme}</Badge>
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
                      >
                        <ExternalLinkIcon className="size-3" />
                        {tr("voirLeCompte")}
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {tr("declareLe", { clipperName: c.clipperName, date: formatDate(c.declaredAt, loc) })}
                  </p>
                  {avertissement !== null && (
                    <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                      <span className="min-w-0">
                        {tWarn(avertissement.key, { mot: avertissement.mot })}
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    disabled={busyId === c._id}
                    onClick={() => valider(c._id, c.handle)}
                  >
                    {busyId === c._id && (
                      <Loader2Icon className="size-4 animate-spin" />
                    )}
                    {tr("valider")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === c._id}
                    onClick={() => {
                      setRefusing({ id: c._id, handle: c.handle });
                      setMotif("");
                    }}
                  >
                    {tr("refuser")}
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog
        open={refusing !== null}
        onOpenChange={(o) => !o && setRefusing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("refuser2", { handle: refusing?.handle ?? "" })}</DialogTitle>
            <DialogDescription>
              {tr("leCompteEstArchiveEt")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motif-refus">{tr("motif")}</Label>
            <Textarea
              id="motif-refus"
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              placeholder={tr("lePseudoAnnonceLaMarque")}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefusing(null)}>
              {tr("annuler")}
            </Button>
            <Button
              onClick={confirmerRefus}
              disabled={motif.trim().length === 0 || busyId !== null}
            >
              {tr("refuserLeCompte")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
