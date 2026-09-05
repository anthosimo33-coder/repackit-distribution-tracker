"use client";

import { useState } from "react";
import Link from "next/link";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProject, useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlusIcon, TrophyIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateFr } from "@/convex/dateFr";
import type { WinnerRule } from "@/convex/challengeScore";
import { CreateChallengeDialog } from "@/components/challenges/CreateChallengeDialog";
import {
  deadlineLabel,
  formatViews,
  modeLabel,
  rewardLabel,
  statusLabel,
  statusTone,
  winnerRuleLabel,
} from "@/components/challenges/challenge-format";
import { usePermissions } from "@/components/project/use-permissions";

export default function ChallengesPage() {
  const droitsNav = usePermissions();
  const challenges = useProjectQuery(api.challenges.listChallenges, {});
  const projectPath = useProjectPath();
  const payCurrency = useProject().project.payCurrency;
  const [createOpen, setCreateOpen] = useState(false);
  // Ancre temporelle stable au montage : `Date.now()` au render est impur.
  const [now] = useState(() => Date.now());

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Défis
          </h1>
          <p className="text-sm text-slate-500">
            Opérations exceptionnelles, limitées dans le temps, attribuées
            nommément.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon className="mr-2 size-4" />
          Nouveau défi
        </Button>
      </header>

      {challenges === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : challenges.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <TrophyIcon className="size-12 text-slate-300" strokeWidth={1.5} />
            <p className="text-sm text-slate-500">
              Aucun défi. Crée le premier — il naîtra en brouillon, invisible des
              créatrices tant que tu ne l&apos;ouvres pas.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Défi</TableHead>
                  <TableHead>Objectif</TableHead>
                  <TableHead>Récompense</TableHead>
                  <TableHead>Participantes</TableHead>
                  <TableHead>Gagnantes</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {challenges.map((c) => (
                  <TableRow key={c._id}>
                    <TableCell className="font-medium">
                      <Link
                        href={projectPath(`/defis/${c._id}`)}
                        className="hover:underline"
                      >
                        {c.name}
                      </Link>
                      <span className="ml-2 text-xs text-slate-400">
                        {modeLabel(c.mode)}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatViews(c.targetViews)} vues
                    </TableCell>
                    <TableCell>
                      {rewardLabel(c.reward, c.winnerRule as WinnerRule, payCurrency)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {c.participantCount}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="tabular-nums">{c.winCount}</span>
                      <span className="text-slate-400">
                        {Number.isFinite(c.slots) ? ` / ${c.slots}` : " / ∞"}
                      </span>
                      <span className="ml-2 text-xs text-slate-400">
                        {winnerRuleLabel(c.winnerRule as WinnerRule)}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDateFr(c.deadline)}
                      <span className="ml-2 text-xs text-slate-400">
                        {deadlineLabel(c.deadline, now)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          statusTone(c.status),
                        )}
                      >
                        {statusLabel(c.status)}
                      </span>
                      {c.over && c.status === "active" && (
                        <span
                          className="ml-2 text-xs text-slate-400"
                          title="Deadline passée ou toutes les places prises"
                        >
                          terminé de fait
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Créer un défi, c'est fixer son BUDGET et son barème
          (`challenges.money`). Animer un défi existant reste dans
          `challenges.run`, que le manager a. */}
      {droitsNav.has("challenges.money") && (
        <CreateChallengeDialog open={createOpen} onOpenChange={setCreateOpen} />
      )}
    </div>
  );
}
