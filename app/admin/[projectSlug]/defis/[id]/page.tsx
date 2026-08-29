"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
import { convexErrorMessage } from "@/lib/convex-error";
import { ArrowLeftIcon, TrophyIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateFr } from "@/convex/dateFr";
import { formatMoney } from "@/lib/format-rate";
import { progressRatio, type WinnerRule } from "@/convex/challengeScore";
import { ChallengeMaterialCard } from "@/components/challenges/ChallengeMaterialCard";
import { ChallengeParticipantsCard } from "@/components/challenges/ChallengeParticipantsCard";
import { ChallengeWinsCard } from "@/components/challenges/ChallengeWinsCard";
import {
  deadlineLabel,
  formatViews,
  maxCommitment,
  modeHelp,
  modeLabel,
  rewardLabel,
  statusLabel,
  statusTone,
  winnerRuleLabel,
} from "@/components/challenges/challenge-format";

export default function ChallengeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id as Id<"challenges">;
  const projectPath = useProjectPath();
  // Devise de la PAIE créatrices : une prime de défi lui est versée comme le
  // reste de sa paie. Jamais un symbole en dur (cf challenge-format).
  const payCurrency = useProject().project.payCurrency;
  const router = useRouter();
  const data = useProjectQuery(api.challenges.getChallenge, { id });
  const preview = useProjectQuery(api.challenges.previewChallengeWinners, { id });
  const open = useProjectMutation(api.challenges.openChallenge);
  const close = useProjectMutation(api.challenges.closeChallenge);
  const remove = useProjectMutation(api.challenges.deleteChallenge);
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
            Défi introuvable.
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
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
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
              {statusLabel(c.status)}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {formatViews(c.targetViews)} vues · {modeLabel(c.mode)} ·{" "}
            {rewardLabel(c.reward, rule, payCurrency)} · {winnerRuleLabel(rule)}
          </p>
          <p className="text-xs text-slate-400">{modeHelp(c.mode)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.status === "draft" && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  act(() => remove({ id }), "Brouillon supprimé", () =>
                    router.push(projectPath("/defis")),
                  )
                }
              >
                Supprimer
              </Button>
              <Button
                disabled={busy}
                onClick={() => act(() => open({ id }), "Défi ouvert")}
              >
                Ouvrir le défi
              </Button>
            </>
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
                  }, "Évaluation faite")
                }
              >
                Évaluer maintenant
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => act(() => close({ id }), "Défi clos")}
              >
                Clore
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
        <Stat label="Deadline">
          {formatDateFr(c.deadline)}
          <span className="ml-2 text-xs font-normal text-slate-400">
            {deadlineLabel(c.deadline, now)}
          </span>
        </Stat>
        <Stat label="Participantes">{ranking.length}</Stat>
        <Stat label="Gagnantes actées">
          {liveWins.length}
          <span className="text-sm font-normal text-slate-400">
            {rule.kind === "all" ? " / ∞" : ` / ${rule.kind === "first" ? 1 : rule.n}`}
          </span>
        </Stat>
        <Stat label="Engagement max">
          {engagement !== null ? formatMoney(engagement, payCurrency) : "—"}
          <span className="block text-xs font-normal text-slate-400">
            {engagement !== null
              ? "si toutes les places sont prises"
              : rule.kind === "all"
                ? "sans plafond (« toutes »)"
                : "coût réel non renseigné"}
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
              Au prochain relevé (23h30 Paris)
            </CardTitle>
            <CardDescription>
              Ce qui serait acté si le relevé tombait maintenant. Rien n&apos;est
              écrit tant qu&apos;il n&apos;a pas eu lieu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {preview.wouldWin.length === 0 ? (
              <p className="text-sm text-slate-500">
                Aucune nouvelle gagnante — personne n&apos;a franchi la barre, ou
                toutes les places sont prises.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {preview.wouldWin.map((w) => (
                  <li key={w.creatorId} className="flex items-center gap-2">
                    <TrophyIcon className="size-4 text-amber-500" />
                    <span className="font-medium text-slate-800">{w.name}</span>
                    <span className="tabular-nums text-slate-500">
                      {formatViews(w.score)} vues
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
          <CardTitle className="text-base">Classement</CardTitle>
          <CardDescription>
            Le MÊME classement que celui affiché aux créatrices, et celui qui
            décide des victoires — une seule implémentation.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Créatrice</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Progression</TableHead>
                <TableHead>Vidéos</TableHead>
                <TableHead>État</TableHead>
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
                      {formatViews(r.score)}
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
                          Gagnante
                        </span>
                      ) : r.crossed ? (
                        <span className="text-emerald-700">Barre franchie</span>
                      ) : (
                        <span className="text-slate-400">En cours</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {ranking.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    Aucune participante. Ajoute-les ci-dessous.
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
          material={c.material}
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
            Vidéos du défi ({videos.length})
          </CardTitle>
          <CardDescription>
            Seules celles-ci comptent dans le score. Elles sont par ailleurs
            payées dans le cycle normal, au barème « {c.pricingName ?? "—"} ».
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Créatrice</TableHead>
                <TableHead>Vues</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Compte au score</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {videos.map((v) => (
                <TableRow key={v.assignmentId}>
                  <TableCell className="font-medium">{v.creatorName}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatViews(v.views)}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {v.status}
                  </TableCell>
                  <TableCell className="text-sm">
                    {v.counted ? (
                      <span className="text-emerald-700">oui</span>
                    ) : v.removedAt !== null ? (
                      <span className="text-slate-400">retirée du défi</span>
                    ) : (
                      <span className="text-slate-400">pas encore publiée</span>
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
                            ? "Vidéo retirée du défi (elle reste publiée)"
                            : "Vidéo réintégrée au défi",
                        )
                      }
                    >
                      {v.removedAt === null ? "Retirer du défi" : "Réintégrer"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {videos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">
                    Aucune vidéo soumise pour l&apos;instant.
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
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
    >
      <ArrowLeftIcon className="size-4" />
      Défis
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
