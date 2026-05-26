"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeftIcon, PencilIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PlatformBadge } from "@/components/VerdictBadge";
import { SnapshotAgeSelector } from "@/components/snapshot-age-selector/SnapshotAgeSelector";
import CompteDialog, { type Compte } from "@/components/comptes/CompteDialog";
import { cn } from "@/lib/utils";

/**
 * Header de la vue détail compte : retour /comptes, handle + plateforme +
 * gestionnaire, sélecteur de période (global, pilote les Vues/Likes affichés)
 * et bouton d'édition (réouvre le CompteDialog en mode edit).
 */
export function CompteDetailHeader({ compte }: { compte: Compte }) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2">
        <Link
          href="/comptes"
          aria-label="Retour aux comptes"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-ml-2 h-7 gap-1 px-2 text-slate-500",
          )}
        >
          <ChevronLeftIcon className="size-4" />
          Comptes
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-3xl font-semibold tracking-tight text-slate-900">
            {compte.handle}
          </h1>
          <PlatformBadge plateforme={compte.plateforme} />
          {!compte.actif && (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-0.5 text-xs font-semibold text-slate-500">
              Archivé
            </span>
          )}
          {compte.personne && (
            <span className="text-sm text-slate-500">
              Géré par{" "}
              <span className="font-medium text-slate-700">
                {compte.personne.prenom} {compte.personne.nom}
              </span>
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SnapshotAgeSelector compact />
        <Button variant="outline" onClick={() => setEditOpen(true)}>
          <PencilIcon className="mr-2 size-4" />
          Modifier le compte
        </Button>
      </div>

      <CompteDialog
        mode="edit"
        compte={compte}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </header>
  );
}
