"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import {
  ArrowRightIcon,
  MonitorSmartphoneIcon,
  WalletIcon,
  CheckCircle2Icon,
  FlameIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatEuros } from "@/lib/format-rate";
import { nextPayoutDate, daysUntilPayout } from "@/lib/payout";
import {
  ASSIGNMENT_STATUS,
  assignmentUrgency,
  isActionable,
  URGENCY_BADGE,
  type AssignmentStatus,
} from "@/lib/assignment-status";

const TYPE_LABELS: Record<string, string> = {
  carousel: "Carrousel",
  short: "Short",
  screenrecorder: "ScreenRecorder",
  custom: "Custom",
};

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

export default function CreatorDashboardPage() {
  const { current } = useCreatorProject();
  const projectId = current.projectId;
  const assignments = useQuery(
    api.assignments.listMyAssignments,
    projectId ? { projectId } : "skip",
  );
  const payments = useQuery(
    api.payments.getMyPayments,
    projectId ? { projectId } : "skip",
  );
  // Notif in-app : warmups à faire/rattraper aujourd'hui (compteur dérivé).
  const warmupDue =
    useQuery(
      api.comptes.countMyWarmupDue,
      projectId ? { projectId } : "skip",
    ) ?? 0;
  const name = current.creatorName;
  const payoutDay = current.payoutDay;

  // Gains de la période en cours (UTC "YYYY-MM", aligné sur periodOf serveur).
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const dueNow =
    (payments ?? []).find((p) => p.period === currentPeriod)?.totalDue ?? 0;
  const nextPayoutTs = payoutDay ? nextPayoutDate(payoutDay) : null;
  const payoutDays = payoutDay ? daysUntilPayout(payoutDay) : null;

  const todo = (assignments ?? []).filter((a) =>
    isActionable(a.status as AssignmentStatus),
  );
  const done = (assignments ?? []).filter(
    (a) => !isActionable(a.status as AssignmentStatus),
  );
  // Notif in-app : vidéos validées en attente de publication.
  const toPublish = (assignments ?? []).filter((a) => a.status === "to_publish");

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Bonjour{name ? ` ${name}` : ""}
        </h1>
        <p className="text-sm text-slate-500">
          Tes briefs à produire, tes gains et tes comptes.
        </p>
      </div>

      {/* Notif : vidéo(s) validée(s) à publier */}
      {toPublish.length > 0 && (
        <Link
          href={`/app/assignments/${toPublish[0]._id}`}
          className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 transition-colors hover:bg-emerald-100/70"
          data-testid="to-publish-notif"
        >
          <CheckCircle2Icon className="size-5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-emerald-900">
              {toPublish.length} vidéo{toPublish.length > 1 ? "s" : ""} validée
              {toPublish.length > 1 ? "s" : ""} — à publier
            </p>
            <p className="text-emerald-700">
              Publie{toPublish.length > 1 ? "-les" : "-la"}
              {" "}sur ton compte et colle l&apos;URL pour déclencher ton
              paiement.
            </p>
          </div>
          <ArrowRightIcon className="size-4 shrink-0 text-emerald-600" />
        </Link>
      )}

      {/* Notif : warmup(s) à faire / rattraper aujourd'hui */}
      {warmupDue > 0 && (
        <Link
          href="/app/comptes"
          className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 transition-colors hover:bg-amber-100/70"
          data-testid="warmup-due-notif"
        >
          <FlameIcon className="size-5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-amber-900">
              {warmupDue} warmup{warmupDue > 1 ? "s" : ""} à faire aujourd&apos;hui
            </p>
            <p className="text-amber-700">
              Coche{warmupDue > 1 ? "-les" : "-le"} pour faire avancer le warmup
              de {warmupDue > 1 ? "tes comptes" : "ton compte"}.
            </p>
          </div>
          <ArrowRightIcon className="size-4 shrink-0 text-amber-600" />
        </Link>
      )}

      {/* À produire */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          À produire
        </h2>
        {assignments === undefined ? (
          <Skeleton className="h-32 w-full" />
        ) : todo.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-500">
              Rien à produire pour le moment. Tu es à jour 🎉
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {todo.map((a) => {
              const urg = assignmentUrgency(
                a.dueDate,
                a.status as AssignmentStatus,
              );
              const st = ASSIGNMENT_STATUS[a.status as AssignmentStatus];
              return (
                <li key={a._id}>
                  <Link
                    href={`/app/assignments/${a._id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-slate-900">
                          {a.formatName}
                        </span>
                        {/* Pas de badge de type pour un assignment script. */}
                        {a.formatType && (
                          <Badge variant="secondary" className="shrink-0">
                            {TYPE_LABELS[a.formatType] ?? a.formatType}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-slate-500">
                          Échéance {formatDate(a.dueDate)}
                        </span>
                        {a.targets.length > 0 && (
                          <span className="font-mono text-slate-400">
                            · {a.targets.map((t) => t.platform).join(" · ")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {urg !== "none" && urg !== "ok" && (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-semibold",
                            URGENCY_BADGE[urg].className,
                          )}
                        >
                          {URGENCY_BADGE[urg].label}
                        </span>
                      )}
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          st.className,
                        )}
                      >
                        {st.label}
                      </span>
                      <ArrowRightIcon className="size-4 text-slate-400" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Mes gains (période en cours) */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <WalletIcon className="size-4 text-slate-400" />
              Mes gains
            </CardTitle>
            <CardDescription>Dû pour la période en cours.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {payments === undefined ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <p
                className="text-3xl font-semibold tabular-nums text-slate-900"
                data-testid="dashboard-due"
              >
                {formatEuros(dueNow)}
              </p>
            )}
            {nextPayoutTs !== null && payoutDays !== null && (
              <p className="text-xs text-slate-500">
                {dueNow > 0
                  ? `Payé dans ${payoutDays} jour${payoutDays > 1 ? "s" : ""} (le ${formatDate(nextPayoutTs)})`
                  : `Prochaine paie le ${formatDate(nextPayoutTs)}`}
              </p>
            )}
            <Link
              href="/app/paiements"
              className="inline-block pt-1 text-sm font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700"
            >
              Voir le détail
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MonitorSmartphoneIcon className="size-4 text-slate-400" />
              Mes comptes
            </CardTitle>
            <CardDescription>Déclare tes comptes et suis leur warmup.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/app/comptes"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Aller à mes comptes
            </Link>
          </CardContent>
        </Card>
      </section>

      {/* Soumis / terminés (compact) */}
      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Soumis &amp; terminés
          </h2>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {done.map((a) => {
              const st = ASSIGNMENT_STATUS[a.status as AssignmentStatus];
              return (
                <li key={a._id}>
                  <Link
                    href={`/app/assignments/${a._id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-slate-50"
                  >
                    <span className="truncate text-slate-700">{a.formatName}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                        st.className,
                      )}
                    >
                      {st.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
