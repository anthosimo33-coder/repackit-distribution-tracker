"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
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
import {
  ArrowRightIcon,
  ClapperboardIcon,
  FlameIcon,
  PartyPopperIcon,
  RotateCcwIcon,
  SendIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatEuros } from "@/lib/format-rate";
import { nextPayoutDate, daysUntilPayout } from "@/lib/payout";
import {
  ASSIGNMENT_STATUS,
  assignmentUrgency,
  URGENCY_BADGE,
  type AssignmentStatus,
} from "@/lib/assignment-status";

/**
 * Accueil du portail créateur — DASHBOARD ORIENTÉ ACTION, scopé au PROJET
 * COURANT (CreatorProjectProvider + creatorQuery filtrées par creatorId +
 * projectId). En 2 secondes : ce que le créateur doit faire MAINTENANT, par
 * priorité :
 *   1. vidéos à produire (todo / in_progress)
 *   2. warmups à cocher aujourd'hui (countMyWarmupDue)
 *   3. vidéos à publier (to_publish)
 *   4. vidéos refusées à refaire (video_rejected)
 *   5. aperçu gains du mois + prochaine paie.
 * Les blocs d'action vides sont MASQUÉS (focus sur ce qu'il y a à faire) ; si
 * tout est vide → état « tout à jour » positif. L'aperçu gains est toujours là.
 *
 * Données : tout vient de creatorQuery existantes (listMyAssignments,
 * countMyWarmupDue, getMyPayments) → 0 sur-fetch, isolation automatique par
 * (creatorId, projectId courant). Changer de projet (switcher PR #37) recharge
 * ces queries sur l'autre projet → compteurs distincts, aucune fuite.
 */

type CreatorAssignment = FunctionReturnType<
  typeof api.assignments.listMyAssignments
>[number];

const TYPE_LABELS: Record<string, string> = {
  carousel: "Carrousel",
  short: "Short",
  screenrecorder: "ScreenRecorder",
  custom: "Custom",
};

const ITEM_CAP = 5;

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

export default function CreatorDashboardPage() {
  const { current } = useCreatorProject();
  const projectId = current.projectId;
  const name = current.creatorName;
  const payoutDay = current.payoutDay;

  const assignments = useQuery(api.assignments.listMyAssignments, { projectId });
  const warmupDue =
    useQuery(api.comptes.countMyWarmupDue, { projectId }) ?? 0;
  const payments = useQuery(api.payments.getMyPayments, { projectId });

  const list = assignments ?? [];
  const toProduce = list.filter(
    (a) => a.status === "todo" || a.status === "in_progress",
  );
  const toPublish = list.filter((a) => a.status === "to_publish");
  const toRedo = list.filter(
    (a) => a.status === "video_rejected" || a.status === "rejected",
  );

  // Gains de la période en cours (UTC "YYYY-MM", aligné sur periodOf serveur).
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const dueNow =
    (payments ?? []).find((p) => p.period === currentPeriod)?.totalDue ?? 0;
  const nextPayoutTs = payoutDay ? nextPayoutDate(payoutDay) : null;
  const payoutDays = payoutDay ? daysUntilPayout(payoutDay) : null;

  const assignmentsLoaded = assignments !== undefined;
  const allClear =
    assignmentsLoaded &&
    toProduce.length === 0 &&
    toPublish.length === 0 &&
    toRedo.length === 0 &&
    warmupDue === 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Bonjour{name ? ` ${name}` : ""}
        </h1>
        <p className="text-sm text-slate-500">
          Ce que tu as à faire pour {current.name}.
        </p>
      </header>

      {!assignmentsLoaded ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <>
          {allClear && <AllClear />}

          {/* 1. À produire */}
          {toProduce.length > 0 && (
            <ActionBlock
              testId="block-produce"
              icon={ClapperboardIcon}
              tone="primary"
              count={toProduce.length}
              countTestId="produce-count"
              title={`vidéo${toProduce.length > 1 ? "s" : ""} à produire`}
              description="Tourne ta vidéo selon le brief, puis envoie ton MP4."
            >
              <AssignmentList items={toProduce} />
            </ActionBlock>
          )}

          {/* 2. Warmups à cocher aujourd'hui */}
          {warmupDue > 0 && (
            <ActionBlock
              testId="block-warmup"
              icon={FlameIcon}
              tone="amber"
              count={warmupDue}
              countTestId="warmup-count"
              title={`warmup${warmupDue > 1 ? "s" : ""} à cocher aujourd'hui`}
              description="Coche le check du jour pour faire avancer le warmup."
            >
              <BlockCta href="/app/comptes" label="Cocher mes warmups" />
            </ActionBlock>
          )}

          {/* 3. À publier */}
          {toPublish.length > 0 && (
            <ActionBlock
              testId="block-publish"
              icon={SendIcon}
              tone="emerald"
              count={toPublish.length}
              countTestId="publish-count"
              title={`vidéo${toPublish.length > 1 ? "s" : ""} à publier`}
              description="Validée(s) — publie et colle l'URL pour déclencher ton paiement."
            >
              <AssignmentList items={toPublish} />
            </ActionBlock>
          )}

          {/* 4. À refaire */}
          {toRedo.length > 0 && (
            <ActionBlock
              testId="block-redo"
              icon={RotateCcwIcon}
              tone="rose"
              count={toRedo.length}
              countTestId="redo-count"
              title={`vidéo${toRedo.length > 1 ? "s" : ""} à refaire`}
              description="Refusée(s) par l'admin — corrige et re-soumets."
            >
              <AssignmentList items={toRedo} showFeedback />
            </ActionBlock>
          )}
        </>
      )}

      {/* 5. Aperçu gains + prochaine paie — toujours visible. */}
      <EarningsOverview
        loading={payments === undefined}
        dueNow={dueNow}
        nextPayoutTs={nextPayoutTs}
        payoutDays={payoutDays}
      />
    </div>
  );
}

/** État « tout à jour » : rien à faire dans aucune catégorie. */
function AllClear() {
  return (
    <Card data-testid="all-clear" className="border-emerald-200 bg-emerald-50/60">
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <PartyPopperIcon className="size-9 text-emerald-500" strokeWidth={1.5} />
        <p className="text-base font-semibold text-emerald-900">
          Tout est à jour
        </p>
        <p className="text-sm text-emerald-700">
          Rien à faire pour le moment. On te préviendra dès qu&apos;une vidéo ou
          un warmup t&apos;attend.
        </p>
      </CardContent>
    </Card>
  );
}

const TONE_CHIP: Record<string, string> = {
  primary: "bg-primary/10 text-primary",
  amber: "bg-amber-100 text-amber-600",
  emerald: "bg-emerald-100 text-emerald-600",
  rose: "bg-rose-100 text-rose-600",
};

/** Bloc d'action : pastille d'icône + compteur + titre + description, et corps. */
function ActionBlock({
  testId,
  icon: Icon,
  tone,
  count,
  countTestId,
  title,
  description,
  children,
}: {
  testId: string;
  icon: LucideIcon;
  tone: keyof typeof TONE_CHIP | string;
  count: number;
  countTestId: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              TONE_CHIP[tone] ?? TONE_CHIP.primary,
            )}
          >
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-base">
              <span data-testid={countTestId} className="tabular-nums">
                {count}
              </span>{" "}
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** CTA pleine largeur (mobile-friendly, 44px) vers une page du portail. */
function BlockCta({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
    >
      {label}
      <ArrowRightIcon className="size-4" />
    </Link>
  );
}

function AssignmentList({
  items,
  showFeedback,
}: {
  items: CreatorAssignment[];
  showFeedback?: boolean;
}) {
  const shown = items.slice(0, ITEM_CAP);
  const extra = items.length - shown.length;
  return (
    <ul className="space-y-2">
      {shown.map((a) => (
        <li key={a._id}>
          <AssignmentItem assignment={a} showFeedback={showFeedback} />
        </li>
      ))}
      {extra > 0 && (
        <li className="px-1 pt-1 text-xs text-slate-400">
          +{extra} de plus…
        </li>
      )}
    </ul>
  );
}

function AssignmentItem({
  assignment: a,
  showFeedback,
}: {
  assignment: CreatorAssignment;
  showFeedback?: boolean;
}) {
  const urg = assignmentUrgency(a.dueDate, a.status as AssignmentStatus);
  const st = ASSIGNMENT_STATUS[a.status as AssignmentStatus];
  return (
    <Link
      href={`/app/assignments/${a._id}`}
      className="block rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-slate-900">
              {a.formatName}
            </span>
            {a.formatType && (
              <Badge variant="secondary" className="shrink-0">
                {TYPE_LABELS[a.formatType] ?? a.formatType}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
            <span className="text-slate-500">Échéance {formatDate(a.dueDate)}</span>
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
              "hidden rounded-full border px-2.5 py-0.5 text-xs font-semibold sm:inline",
              st.className,
            )}
          >
            {st.label}
          </span>
          <ArrowRightIcon className="size-4 text-slate-400" />
        </div>
      </div>
      {showFeedback && a.videoReviewFeedback && (
        <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          {a.videoReviewFeedback}
        </p>
      )}
    </Link>
  );
}

function EarningsOverview({
  loading,
  dueNow,
  nextPayoutTs,
  payoutDays,
}: {
  loading: boolean;
  dueNow: number;
  nextPayoutTs: number | null;
  payoutDays: number | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <WalletIcon className="size-4 text-slate-400" />
          Mes gains
        </CardTitle>
        <CardDescription>Gagné ce mois + prochaine paie.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {loading ? (
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
          className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700"
        >
          Voir le détail
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
