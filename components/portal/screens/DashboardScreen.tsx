"use client";

import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { PaymentInfoNudge } from "@/components/portal/PaymentInfoNudge";
import {
  useMyAssignments,
  useWarmupDue,
  useWarmupInProgress,
  useMyPayments,
} from "@/components/portal/creator-data";
import { usePortalBase } from "@/components/portal/ViewAsContext";
import { portalHref } from "@/lib/view-as";
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
 * COURANT. Écran RÉUTILISÉ tel quel par le portail créateur normal ET par le
 * mode admin « voir l'espace d'un créateur » (lecture seule) :
 *   - les données viennent des hooks d'indirection (creator-data) → getMy* en
 *     normal, *AsAdmin scopé serveur en view-as ;
 *   - les liens internes sont préfixés par usePortalBase() ("/app" ou base
 *     view-as) ; en lecture seule, les éléments de mission ne sont pas cliquables
 *     (pas de page de détail dans le mode vue).
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

export default function DashboardScreen() {
  const { current } = useCreatorProject();
  const projectId = current.projectId;
  const name = current.creatorName;
  const payoutDay = current.payoutDay;
  const base = usePortalBase();

  const assignments = useMyAssignments(projectId);
  const warmupDue = useWarmupDue(projectId) ?? 0;
  // QW1 — warmups EN COURS (qu'un check soit dû aujourd'hui ou non) : alimente le
  // rappel permanent « reviens le cocher chaque jour » (lecture seule).
  const warmupInProgress = useWarmupInProgress(projectId) ?? 0;
  const payments = useMyPayments(projectId);

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
    warmupDue === 0 &&
    warmupInProgress === 0;

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

      {/* QW3 — coordonnées de paiement manquantes alors que des gains sont dus. */}
      <PaymentInfoNudge projectId={projectId} />

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
              <AssignmentList items={toProduce} base={base} />
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
              <BlockCta href={portalHref(base, "/comptes")} label="Cocher mes warmups" />
            </ActionBlock>
          )}

          {/* 2 bis. Warmup en cours mais rien à cocher aujourd'hui → rappel
              PERMANENT (QW1) : le warmup se coche chaque jour, on ne laisse
              jamais croire « rien à faire » tant qu'il n'est pas terminé. */}
          {warmupDue === 0 && warmupInProgress > 0 && (
            <WarmupOngoingReminder href={portalHref(base, "/comptes")} />
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
              <AssignmentList items={toPublish} base={base} />
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
              <AssignmentList items={toRedo} base={base} showFeedback />
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
        detailHref={portalHref(base, "/paiements")}
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
          Rien à faire pour le moment. Repasse de temps en temps : tes nouvelles
          missions et tes warmups apparaîtront ici.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * QW1 — rappel PERMANENT tant qu'un warmup est en cours (et que le check du jour
 * est déjà fait). Le warmup se coche CHAQUE jour jusqu'au bout ; on l'affiche même
 * « fait aujourd'hui » pour ne jamais laisser croire qu'il n'y a plus rien à faire.
 * Renvoie vers « Mes comptes » où se fait le check. AFFICHAGE seul (lecture).
 */
function WarmupOngoingReminder({ href }: { href: string }) {
  return (
    <Link
      href={href}
      data-testid="warmup-ongoing-reminder"
      className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 transition-colors hover:bg-amber-100"
    >
      <FlameIcon className="size-5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium text-amber-900">
          Warmup en cours — c&apos;est bon pour aujourd&apos;hui&nbsp;✓
        </p>
        <p className="text-sm text-amber-800">
          Reviens le cocher chaque jour jusqu&apos;au bout : c&apos;est ce qui
          rend ton compte prêt à publier.
        </p>
      </div>
      <ArrowRightIcon className="size-4 shrink-0 text-amber-700" />
    </Link>
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
  base,
  showFeedback,
}: {
  items: CreatorAssignment[];
  base: string;
  showFeedback?: boolean;
}) {
  const shown = items.slice(0, ITEM_CAP);
  const extra = items.length - shown.length;
  return (
    <ul className="space-y-2">
      {shown.map((a) => (
        <li key={a._id}>
          <AssignmentItem
            assignment={a}
            base={base}
            showFeedback={showFeedback}
          />
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
  base,
  showFeedback,
}: {
  assignment: CreatorAssignment;
  base: string;
  showFeedback?: boolean;
}) {
  const urg = assignmentUrgency(a.dueDate, a.status as AssignmentStatus);
  const st = ASSIGNMENT_STATUS[a.status as AssignmentStatus];
  const inner = (
    <>
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
    </>
  );

  // Lien vers le détail de la mission — dans le portail créateur (/app/...) comme
  // dans le mode admin view-as (la fiche détail existe dans les deux, en lecture
  // seule côté admin). usePortalBase fournit la bonne base.
  return (
    <Link
      href={portalHref(base, `/assignments/${a._id}`)}
      className="block rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      {inner}
    </Link>
  );
}

function EarningsOverview({
  loading,
  dueNow,
  nextPayoutTs,
  payoutDays,
  detailHref,
}: {
  loading: boolean;
  dueNow: number;
  nextPayoutTs: number | null;
  payoutDays: number | null;
  detailHref: string;
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
          href={detailHref}
          className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700"
        >
          Voir le détail
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
