"use client";

import Link from "next/link";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PlatformBadge } from "@/components/VerdictBadge";
import { cn } from "@/lib/utils";
import {
  getEffectiveStatus,
  getStatusBadge,
  getEffectiveWarmupDuration,
  type Plateforme,
} from "@/lib/compte-status";
import { warmupProgress } from "@/lib/warmup";

/**
 * P5 — section « Comptes » de la fiche créateur (admin). Alimentée depuis
 * listComptes filtré par creatorId. Lien vers la fiche compte (protocole +
 * perf). Remplace l'emplacement réservé de P4.
 */
export function CreatorComptesSection({
  creatorId,
}: {
  creatorId: Id<"creators">;
}) {
  const comptes = useProjectQuery(api.comptes.listComptes, {});
  const projectPath = useProjectPath();
  const mine = (comptes ?? []).filter((c) => c.creatorId === creatorId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comptes</CardTitle>
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
              const isWarmup = getEffectiveStatus(c) === "warmup";
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
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <PlatformBadge plateforme={c.plateforme} />
                    <Link
                      href={projectPath(`/comptes/${c._id}`)}
                      className="font-mono text-sm font-medium text-slate-900 hover:text-primary hover:underline"
                    >
                      {c.handle}
                    </Link>
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
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
