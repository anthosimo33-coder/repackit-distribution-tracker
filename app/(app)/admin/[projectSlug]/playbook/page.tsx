"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BookOpenCheckIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { usePermissions } from "@/components/project/use-permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatutFiche } from "@/components/playbook/StatutFiche";
import { ADocumenter } from "@/components/playbook/ADocumenter";
import { useConvexError } from "@/lib/use-convex-error";
import { formatDate, formatNumber } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { MAX_TITRE, STATUTS_FICHE, titreValide } from "@/convex/playbookFiche";

/**
 * PLAYBOOK — une fiche par format qui a gagné, rangées par statut : ce qui est
 * prouvé d'abord, puis ce qui se teste, les idées, ce qui s'use, ce qui est
 * retiré. Le détail (recette, preuves, règles, posts relus en direct, journal)
 * est sur la fiche.
 */
export default function PlaybookPage() {
  const tr = useTranslations("admin.scripts.PlaybookPage");
  const tStatutAide = useTranslations("admin.scripts.playbookStatutAide");
  const tStatut = useTranslations("admin.scripts.playbookStatut");
  const projectPath = useProjectPath();
  const { has, chargement } = usePermissions();
  const loc = useIntlLocale();
  const fiches = useProjectQuery(api.playbook.listFiches, has("scripts.manage") ? {} : "skip");
  const [creation, setCreation] = useState(false);

  const parStatut = useMemo(
    () =>
      STATUTS_FICHE.map((s) => [s, (fiches ?? []).filter((f) => f.statut === s)] as const).filter(
        ([, liste]) => liste.length > 0,
      ),
    [fiches],
  );

  if (chargement) return <Skeleton className="h-96 w-full" />;
  if (!has("scripts.manage")) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-slate-500">{tr("accesRefuse")}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <BookOpenCheckIcon className="size-5" />
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tr("titre")}</h1>
            <p className="text-sm text-slate-500">{tr("sousTitre")}</p>
          </div>
        </div>
        <Button onClick={() => setCreation(true)} data-testid="playbook-nouvelle">
          <PlusIcon className="mr-2 size-4" />
          {tr("nouvelle")}
        </Button>
      </header>

      <ADocumenter />

      {fiches === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : fiches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">{tr("aucune")}</CardContent>
        </Card>
      ) : (
        parStatut.map(([statut, liste]) => (
          <section key={statut} className="space-y-2" data-testid="playbook-groupe">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {tStatut(statut)}
              <span className="ml-1.5 font-normal tabular-nums text-slate-400">{liste.length}</span>
              <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">{tStatutAide(statut)}</span>
            </h2>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
              {liste.map((f) => (
                <Link
                  key={f._id}
                  href={projectPath(`/playbook/${f._id}`)}
                  prefetch={false}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-3"
                  data-testid="playbook-ligne"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{f.titre}</span>
                    {f.recette && <span className="block truncate text-xs text-slate-500">{f.recette}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-slate-500">
                    <span>{tr("posts", { n: f.posts })}</span>
                    {f.meilleuresVues !== null && (
                      <span>{tr("meilleur", { vues: formatNumber(f.meilleuresVues, loc) })}</span>
                    )}
                    <span className="hidden md:inline">{tr("modifiee", { date: formatDate(f.updatedAt, loc) })}</span>
                    <StatutFiche statut={f.statut} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}

      <CreationDialog open={creation} onClose={() => setCreation(false)} />
    </div>
  );
}

function CreationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tr = useTranslations("admin.scripts.PlaybookPage");
  const showError = useConvexError();
  const router = useRouter();
  const projectPath = useProjectPath();
  const creer = useProjectMutation(api.playbook.creerFiche);
  const [titre, setTitre] = useState("");
  const [busy, setBusy] = useState(false);
  const pret = titreValide(titre) !== null;

  async function valider() {
    if (!pret) return;
    setBusy(true);
    try {
      const id: Id<"playbookFiches"> = await creer({ titre });
      toast.success(tr("creee"));
      onClose();
      setTitre("");
      router.push(projectPath(`/playbook/${id}`));
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("nouvelleTitre")}</DialogTitle>
          <DialogDescription>{tr("nouvelleAide")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="playbook-titre">{tr("titreFiche")}</Label>
          <Input
            id="playbook-titre"
            value={titre}
            maxLength={MAX_TITRE}
            onChange={(e) => setTitre(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void valider()}
            placeholder={tr("titreExemple")}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr("annuler")}
          </Button>
          <Button onClick={valider} disabled={!pret || busy}>
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {tr("creer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

