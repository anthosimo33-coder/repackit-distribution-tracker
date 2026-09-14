"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeftIcon,
  PencilIcon,
  CheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PlatformBadge } from "@/components/VerdictBadge";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { SnapshotAgeSelector } from "@/components/snapshot-age-selector/SnapshotAgeSelector";
import CompteDialog, { type Compte } from "@/components/comptes/CompteDialog";
import { CompteAdminActions } from "@/components/comptes/CompteAdminActions";
import {
  getEffectiveStatus,
  getStatusBadge,
  isWarmupCompleteForCompte,
} from "@/lib/compte-status";
import { RestartWarmupButton } from "./RestartWarmupButton";
import { countryLabel } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { useLabel } from "@/lib/use-label";
import { useTranslations } from "next-intl";

/**
 * Header de la vue détail compte : retour /comptes, handle + plateforme +
 * rattachement (créatrice propriétaire / gestionnaire), sélecteur de période
 * (global, pilote les Vues/Likes affichés), bouton d'édition (réouvre le
 * CompteDialog en mode edit) et menu ⋯ admin (réassigner / archiver /
 * supprimer, partagé avec la table /comptes).
 */
export function CompteDetailHeader({ compte }: { compte: Compte }) {
  const tr = useTranslations("admin.accounts.CompteDetailHeader");
  const tLabel = useLabel();
  const [editOpen, setEditOpen] = useState(false);
  const projectPath = useProjectPath();
  const router = useRouter();

  const effStatus = getEffectiveStatus(compte);
  const badge = getStatusBadge(compte);
  const warmupComplete =
    effStatus === "warmup" &&
    compte.warmupStartedAt != null &&
    isWarmupCompleteForCompte(compte);
  // « Relancer le warmup » : pertinent pour un compte sorti d'échauffement
  // (actif), à valider (warmup terminé) ou shadowban. Masqué pendant un warmup
  // EN COURS (déjà en chauffe) et pour un compte archivé (réactiver d'abord).
  const canRestartWarmup =
    effStatus === "actif" || effStatus === "shadowban" || warmupComplete;

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2">
        <Link
          href={projectPath("/comptes")}
          aria-label={tr("retourAuxComptes")}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-ml-2 h-7 gap-1 px-2 text-slate-500",
          )}
        >
          <ChevronLeftIcon className="size-4" />
          {tr("comptes")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-3xl font-semibold tracking-tight text-slate-900">
            {compte.handle}
          </h1>
          <PlatformBadge plateforme={compte.plateforme} />
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-xs font-semibold",
              badge.className,
            )}
          >
            {effStatus === "shadowban" && (
              <TriangleAlertIcon className="size-3.5" />
            )}
            {tLabel(badge.labelKey, badge.params)}
          </span>
          {compte.targetCountry && (
            <span
              data-testid="compte-country-badge"
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-0.5 text-xs font-semibold text-slate-600"
              title={tr("paysCibleLabelInterneInformatif")}
            >
              {countryLabel(compte.targetCountry)}
            </span>
          )}
          {warmupComplete && (
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setEditOpen(true)}
            >
              <CheckIcon className="mr-1.5 size-3.5" />
              {tr("passerEnActif")}
            </Button>
          )}
          {/* Rattachement : propriétaire (créatrice ou interne) + gestionnaire.
              Rendu lisible ici parce que c'est ce que « Réassigner… » (menu ⋯)
              modifie. */}
          <span className="text-sm text-slate-500" data-testid="compte-owner">
            {compte.creator ? (
              <>
                {tr("creatrice")}{" "}
                <span className="font-medium text-slate-700">
                  {compte.creator.name}
                </span>
              </>
            ) : (
              tr("compteInterne")
            )}
          </span>
          {compte.personne && (
            <span className="text-sm text-slate-500">
              {tr("gerePar")}{" "}
              <span className="font-medium text-slate-700">
                {compte.personne.prenom} {compte.personne.nom}
              </span>
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SnapshotAgeSelector compact />
        {canRestartWarmup && (
          <RestartWarmupButton
            compteId={compte._id}
            plateforme={compte.plateforme}
          />
        )}
        <Button variant="outline" onClick={() => setEditOpen(true)}>
          <PencilIcon className="mr-2 size-4" />
          {tr("modifierLeCompte")}
        </Button>
        {/* Réassigner / Archiver / Supprimer — même menu que la table /comptes.
            Après suppression la fiche n'existe plus → retour à la liste. */}
        <CompteAdminActions
          compte={compte}
          onEdit={() => setEditOpen(true)}
          onDeleted={() => router.replace(projectPath("/comptes"))}
        />
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
