"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProject, useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeftIcon, TrophyIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateFr } from "@/convex/dateFr";
import { formatMoney } from "@/lib/format-rate";
import { progressRatio, type WinnerRule } from "@/convex/challengeScore";
import { ChallengeMaterialCard } from "@/components/challenges/ChallengeMaterialCard";
import { ChallengeDangerActions } from "@/components/challenges/ChallengeDangerActions";
import { ChallengeParticipantsCard } from "@/components/challenges/ChallengeParticipantsCard";
import { ChallengeWinsCard } from "@/components/challenges/ChallengeWinsCard";
import {
  formatViews,
  maxCommitment,
  statusTone,
} from "@/components/challenges/challenge-format";
import { usePermissions } from "@/components/project/use-permissions";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useChallengeLabels } from "@/components/challenges/use-challenge-labels";
import { useConvexError } from "@/lib/use-convex-error";

export default function ChallengeDetailPage() {
  const showError = useConvexError();
  const loc = useIntlLocale();
  const tr = useTranslations("admin.challenges.ChallengeDetailPage");
  const L = useChallengeLabels();
  const droitsNav = usePermissions();
  const params = useParams<{ id: string }>();
  const id = params.id as Id<"challenges">;
  const projectPath = useProjectPath();
  // Devise de la PAIE créatrices : une prime de défi lui est versée comme le
  // reste de sa paie. Jamais un symbole en dur (cf challenge-format).
  const payCurrency = useProject().project.payCurrency;
  const data = useProjectQuery(api.challenges.getChallenge, { id });
  const preview = useProjectQuery(api.challenges.previewChallengeWinners, { id });
  const open = useProjectMutation(api.challenges.openChallenge);
  const close = useProjectMutation(api.challenges.closeChallenge);
  const evaluate = useProjectMutation(api.challengeSync.evaluateChallengeNow);
  const setRemoved = useProjectMutation(api.challenges.setChallengeVideoRemoved);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  if (data === undefined) return <Skeleton className="h-96 w-full" />;
  if (data === null) {
    return (
      <div className="space-y-4">
        <BackLink href={projectPath("/defis")} />
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            {tr("defiIntrouvable")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { challenge: c, ranking, wins, videos, participantIds } = data;
  const rule = c.winnerRule as WinnerRule;
  const liveWins = wins.filter((w) => w.cancelledAt === null);
  const engagement = maxCommitment(c.reward, rule);

  async function act(
    fn: () => Promise<unknown>,
    okMsg: string,
    then?: () => void,
  ) {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      then?.();
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <BackLink href={projectPath("/defis")} />

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
              {c.name}
            </h1>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                statusTone(c.status),
              )}
            >
              {L.status(c.status)}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {tr("vues", { count: formatViews(c.targetViews, loc), value: L.mode(c.mode), value2: L.reward(c.reward, rule, payCurrency), value3: L.winnerRule(rule) })}
          </p>
          <p className="text-xs text-slate-400">{L.modeHelp(c.mode)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* SUPPRIMER / MASQUER — à TOUS les statuts, parce que c'est ce que le
              défi PORTE qui décide, pas l'étape où il en est. Reste un geste
              `challenges.money` : il défait un budget, ce n'est pas de
              l'animation. */}
          {droitsNav.has("challenges.money") && (
            <ChallengeDangerActions
              id={id}
              hidden={c.hiddenAt !== null}
              redirectTo={projectPath("/defis")}
            />
          )}
          {c.status === "draft" && (
            <Button
              disabled={busy}
              onClick={() => act(() => open({ id }), tr("defiOuvert"))}
            >
              {tr("ouvrirLeDefi")}
            </Button>
          )}
          {c.status === "active" && (
            <>
              {/* Ne pas attendre 23h30 quand on vient d'ouvrir ou de corriger.
                  Passe par le MÊME chemin que le relevé nocturne — un second
                  chemin d'écriture des victoires divergerait, et ce sont des
                  primes. */}
              <Button
                variant="outline"
                disabled={busy}
                data-testid="challenge-evaluate-now"
                onClick={() =>
                  act(async () => {
                    const r = await evaluate({ id });
                    return r;
                  }, tr("evaluationFaite"))
                }
              >
                {tr("evaluerMaintenant")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => act(() => close({ id }), tr("defiClos"))}
              >
                {tr("clore")}
              </Button>
            </>
          )}
        </div>
      </header>

      {c.description && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {c.description}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={tr("deadline")}>
          {formatDateFr(c.deadline, loc)}
          <span className="ml-2 text-xs font-normal text-slate-400">
            {L.deadline(c.deadline, now)}
          </span>
        </Stat>
        <Stat label={tr("participantes")}>{ranking.length}</Stat>
        <Stat label={tr("gagnantesActees")}>
          {liveWins.length}
          <span className="text-sm font-normal text-slate-400">
            {rule.kind === "all" ? " / ∞" : ` / ${rule.kind === "first" ? 1 : rule.n}`}
          </span>
        </Stat>
        <Stat label={tr("engagementMax")}>
          {engagement !== null ? formatMoney(engagement, payCurrency, loc) : "—"}
          <span className="block text-xs font-normal text-slate-400">
            {engagement !== null
              ? tr("siToutesLesPlacesSont")
              : rule.kind === "all"
                ? tr("sansPlafondToutes")
                : tr("coutReelNonRenseigne")}
          </span>
        </Stat>
      </div>

      {/* Ce que le prochain relevé actera. La question que l'admin se pose
          vraiment (« qui va gagner cette nuit ? ») mérite d'être répondue
          explicitement plutôt que déduite du classement. */}
      {c.status === "active" && preview && (
        <Card data-testid="challenge-preview">
          <CardHeader>
            <CardTitle className="text-base">
              {tr("auProchainReleve23h30Paris")}
            </CardTitle>
            <CardDescription>
              {tr("ceQuiSeraitActeSi")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {preview.wouldWin.length === 0 ? (
              <p className="text-sm text-slate-500">
                {tr("aucuneNouvelleGagnantePersonneN")}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {preview.wouldWin.map((w) => (
                  <li key={w.creatorId} className="flex items-center gap-2">
                    <TrophyIcon className="size-4 text-amber-500" />
                    <span className="font-medium text-slate-800">{w.name}</span>
                    <span className="tabular-nums text-slate-500">
                      {tr("vues2", { count: formatViews(w.score, loc) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tr("classement")}</CardTitle>
          <CardDescription>
            {tr("leMemeClassementQueCelui")}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{tr("creatrice")}</TableHead>
                <TableHead>{tr("score")}</TableHead>
                <TableHead>{tr("progression")}</TableHead>
                <TableHead>{tr("videos")}</TableHead>
                <TableHead>{tr("etat")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranking.map((r) => {
                const won = liveWins.find((w) => w.creatorId === r.creatorId);
                return (
                  <TableRow key={r.creatorId}>
                    <TableCell className="tabular-nums text-slate-400">
                      {r.rank}
                    </TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatViews(r.score, loc)}
                    </TableCell>
                    <TableCell className="w-40">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            r.crossed ? "bg-emerald-500" : "bg-slate-400",
                          )}
                          style={{
                            width: `${progressRatio(r.score, c.targetViews) * 100}%`,
                          }}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums text-slate-500">
                      {r.videoCount}
                    </TableCell>
                    <TableCell className="text-sm">
                      {won ? (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                          <TrophyIcon className="size-3.5" />
                          {tr("gagnante")}
                        </span>
                      ) : r.crossed ? (
                        <span className="text-emerald-700">{tr("barreFranchie")}</span>
                      ) : (
                        <span className="text-slate-400">{tr("enCours")}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {ranking.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    {tr("aucuneParticipanteAjouteLesCi")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ChallengeWinsCard wins={wins} currency={payCurrency} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChallengeMaterialCard
          challengeId={id}
          script={c.script}
          legacy={c.legacy}
          instructions={c.instructions}
        />
        <ChallengeParticipantsCard
          challengeId={id}
          participantIds={participantIds}
          locked={c.status === "closed"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {tr("videosDuDefi", { count: videos.length })}
          </CardTitle>
          <CardDescription>
            {tr("videosDuDefiAide", { pricing: c.pricingName ?? "—" })}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("creatrice")}</TableHead>
                <TableHead>{tr("vues3")}</TableHead>
                <TableHead>{tr("statut")}</TableHead>
                <TableHead>{tr("compteAuScore")}</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {videos.map((v) => (
                <TableRow key={v.assignmentId}>
                  <TableCell className="font-medium">{v.creatorName}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatViews(v.views, loc)}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {v.status}
                  </TableCell>
                  <TableCell className="text-sm">
                    {v.counted ? (
                      <span className="text-emerald-700">{tr("oui")}</span>
                    ) : v.removedAt !== null ? (
                      <span className="text-slate-400">{tr("retireeDuDefi")}</span>
                    ) : (
                      <span className="text-slate-400">{tr("pasEncorePubliee")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* RETIRER n'est pas SUPPRIMER : la vidéo reste publiée,
                        payée et trackée, seul son apport au score disparaît.
                        Sans ce geste, le seul moyen de corriger un score serait
                        de supprimer la publication — qui emporterait
                        l'historique, les relevés et la trace de paie. */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () =>
                            setRemoved({
                              assignmentId: v.assignmentId,
                              removed: v.removedAt === null,
                            }),
                          v.removedAt === null
                            ? tr("videoRetireeDuDefiElle")
                            : tr("videoReintegreeAuDefi"),
                        )
                      }
                    >
                      {v.removedAt === null ? tr("retirerDuDefi") : tr("reintegrer")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {videos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">
                    {tr("aucuneVideoSoumisePourL")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink({ href }: { href: string }) {
  const tr = useTranslations("admin.challenges.BackLink");
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
    >
      <ArrowLeftIcon className="size-4" />
      {tr("defis")}
    </Link>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{children}</p>
    </div>
  );
}
