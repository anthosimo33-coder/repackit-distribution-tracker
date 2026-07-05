"use client";

import { useState } from "react";
import Link from "next/link";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PlatformBadge } from "@/components/VerdictBadge";
import { UsersIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getEffectiveStatus,
  getStatusBadge,
  getEffectiveWarmupDuration,
  type Plateforme,
} from "@/lib/compte-status";
import { warmupProgress } from "@/lib/warmup";
import CompteDialog, { type Compte } from "@/components/comptes/CompteDialog";
import { CompteAdminActions } from "@/components/comptes/CompteAdminActions";
import { ManagedCompteDialog } from "@/components/comptes/ManagedCompteDialog";

/**
 * P5 — section « Comptes » de la fiche créateur (admin). Alimentée depuis
 * listComptes filtré par creatorId. Chantier D : actions admin par compte
 * (Modifier — plateforme incl. si vierge —, Archiver/Réactiver, Supprimer si
 * vierge). Comptes archivés grisés.
 */
export function CreatorComptesSection({
  creatorId,
}: {
  creatorId: Id<"creators">;
}) {
  const comptes = useProjectQuery(api.comptes.listComptes, {});
  const projectPath = useProjectPath();
  const mine = (comptes ?? []).filter((c) => c.creatorId === creatorId);
  const [editTarget, setEditTarget] = useState<Compte | null>(null);
  const [managedOpen, setManagedOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Comptes</CardTitle>
        {/* Créer un compte GÉRÉ par l'équipe (rattaché à cette créatrice) :
            l'équipe le tient, elle ne fait que suivre. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setManagedOpen(true)}
          data-testid="create-managed-compte"
        >
          <PlusIcon className="mr-1.5 size-4" />
          Compte géré
        </Button>
      </CardHeader>
      <CardContent>
        {comptes === undefined ? (
          <Skeleton className="h-20 w-full" />
        ) : mine.length === 0 ? (
          <p className="text-sm text-slate-400">
            Aucun compte déclaré par ce créateur.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {mine.map((c) => {
              const badge = getStatusBadge(c);
              const status = getEffectiveStatus(c);
              const isWarmup = status === "warmup";
              const progress =
                isWarmup && c.warmupStartedAt !== undefined
                  ? warmupProgress(
                      c.warmupProtocol?.dailyChecks?.length ?? 0,
                      getEffectiveWarmupDuration({
                        plateforme: c.plateforme as Plateforme,
                        warmupProtocol: c.warmupProtocol,
                      }),
                    )
                  : null;
              return (
                <li
                  key={c._id}
                  className={cn(
                    "flex items-center justify-between gap-3 py-2.5",
                    status === "archived" && "opacity-60",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <PlatformBadge plateforme={c.plateforme} />
                    <Link
                      href={projectPath(`/comptes/${c._id}`)}
                      className="truncate font-mono text-sm font-medium text-slate-900 hover:text-primary hover:underline"
                    >
                      {c.handle}
                    </Link>
                    {c.managedByAdmin && (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[0.65rem] font-semibold text-slate-600"
                        title="Compte géré par l'équipe"
                      >
                        <UsersIcon className="size-3" />
                        Géré
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {progress && (
                      <span className="text-xs text-slate-500">
                        Jour {progress.day}/{progress.targetDays}
                      </span>
                    )}
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                        badge.className,
                      )}
                    >
                      {badge.label}
                    </span>
                    <CompteAdminActions
                      compte={c}
                      onEdit={() => setEditTarget(c)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <CompteDialog
        open={editTarget !== null}
        onOpenChange={(o) => !o && setEditTarget(null)}
        mode="edit"
        compte={editTarget ?? undefined}
      />

      <ManagedCompteDialog
        open={managedOpen}
        onOpenChange={setManagedOpen}
        creatorId={creatorId}
      />
    </Card>
  );
}
