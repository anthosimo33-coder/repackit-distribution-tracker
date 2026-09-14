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
  formatViews,
  statusTone,
} from "@/components/challenges/challenge-format";
import { usePermissions } from "@/components/project/use-permissions";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useChallengeLabels } from "@/components/challenges/use-challenge-labels";

export default function ChallengesPage() {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.challenges.ChallengesPage");
  const L = useChallengeLabels();
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
            {tr("defis")}
          </h1>
          <p className="text-sm text-slate-500">
            {tr("operationsExceptionnellesLimiteesDansLe")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon className="mr-2 size-4" />
          {tr("nouveauDefi")}
        </Button>
      </header>

      {challenges === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : challenges.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <TrophyIcon className="size-12 text-slate-300" strokeWidth={1.5} />
            <p className="text-sm text-slate-500">
              {tr("aucunDefiCreeLePremier")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("defi")}</TableHead>
                  <TableHead>{tr("objectif")}</TableHead>
                  <TableHead>{tr("recompense")}</TableHead>
                  <TableHead>{tr("participantes")}</TableHead>
                  <TableHead>{tr("gagnantes")}</TableHead>
                  <TableHead>{tr("deadline")}</TableHead>
                  <TableHead>{tr("statut")}</TableHead>
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
                        {L.mode(c.mode)}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {tr("vues", { count: formatViews(c.targetViews, loc) })}
                    </TableCell>
                    <TableCell>
                      {L.reward(c.reward, c.winnerRule as WinnerRule, payCurrency)}
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
                        {L.winnerRule(c.winnerRule as WinnerRule)}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDateFr(c.deadline, loc)}
                      <span className="ml-2 text-xs text-slate-400">
                        {L.deadline(c.deadline, now)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          statusTone(c.status),
                        )}
                      >
                        {L.status(c.status)}
                      </span>
                      {c.over && c.status === "active" && (
                        <span
                          className="ml-2 text-xs text-slate-400"
                          title={tr("deadlinePasseeOuToutesLes")}
                        >
                          {tr("termineDeFait")}
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
