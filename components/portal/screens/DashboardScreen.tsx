"use client";

import { useState } from "react";
import Link from "next/link";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { PaymentInfoNudge } from "@/components/portal/PaymentInfoNudge";
import { TodayPostBanner } from "@/components/portal/TodayPostBanner";
import { ChallengeBanner } from "@/components/portal/ChallengeBanner";
import { CreatorPublicationCalendar } from "@/components/portal/CreatorPublicationCalendar";
import { CycleGainsCard } from "@/components/portal/CycleGainsCard";
import { RankCard } from "@/components/portal/RankCard";
import {
  useMyAssignments,
  useWarmupDue,
  useWarmupInProgress,
  useArgentObservable,
  useOnboardingState,
} from "@/components/portal/creator-data";
import { usePortalBase } from "@/components/portal/ViewAsContext";
import {
  MissionListItem,
  formatMissionDate,
  type CreatorAssignment,
} from "@/components/portal/MissionListItem";
import { portalHref } from "@/lib/view-as";
import {
  assignmentUrgency,
  isActionable,
  URGENCY_BADGE,
  type AssignmentStatus,
} from "@/lib/assignment-status";
import { useLabel } from "@/lib/use-label";
import { formatPlannedDay, representativePostedAt } from "@/lib/calendar-status";
import { sortBySchedule } from "@/lib/creator-schedule";
import { nextCreatorAction, type NextAction } from "@/lib/creator-next-action";
import {
  deriveOnboarding,
  type StepState,
  type OnboardingDerived,
} from "@/lib/onboarding";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  ClapperboardIcon,
  ClockIcon,
  FlameIcon,
  HourglassIcon,
  PartyPopperIcon,
  RotateCcwIcon,
  SendIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";

/**
 * « AUJOURD'HUI » — l'accueil du portail créatrice, construit autour d'UNE action.
 *
 * L'ancien accueil empilait jusqu'à six blocs (rattrapage, post du jour, à
 * produire, à publier, à refaire, warmup), puis les gains et le classement tout en
 * bas. Tout y était, et rien ne disait par quoi commencer. Ici :
 *   1. la PROCHAINE ACTION, une seule, en grand (cf `lib/creator-next-action`) ;
 *   2. trois compteurs, pour le volume ;
 *   3. « Ensuite » : le reste, dans l'ordre du planning ;
 *   4. à côté (sous, sur mobile) : les gains du cycle et ta place au classement.
 *
 * Écran RÉUTILISÉ par le mode admin « voir l'espace d'un créateur » (lecture
 * seule) : données par les hooks d'indirection, liens préfixés par la base.
 *
 * `data-testid` CONSERVÉS là où le sens n'a pas changé (`produce-count`,
 * `publish-count`, `redo-count`, `dashboard-due`, `all-clear`, `see-all-missions`,
 * `block-managed`, `onboarding-checklist`) : ce sont des contrats de specs.
 */

const UPCOMING_CAP = 5;

export default function DashboardScreen() {
  const t = useTranslations("portal");
  const loc = useIntlLocale();
  const { current } = useCreatorProject();
  const projectId = current.projectId;
  const name = current.creatorName;
  const base = usePortalBase();
  const argent = useArgentObservable();

  const assignments = useMyAssignments(projectId);
  const warmupDue = useWarmupDue(projectId) ?? 0;
  const warmupInProgress = useWarmupInProgress(projectId) ?? 0;
  const onboardingRaw = useOnboardingState(projectId);
  const onboarding = onboardingRaw ? deriveOnboarding(onboardingRaw) : null;

  // Ancre temporelle stable au montage (impure au render sinon, cf react-hooks/purity).
  const [nowMs] = useState(() => Date.now());
  const list = assignments ?? [];
  // On attend assignments ET onboarding : sinon « Tout est à jour » clignote
  // avant que l'état d'onboarding soit connu.
  const loaded = assignments !== undefined && onboarding !== null;
  const showChecklist = onboarding?.applicable === true && !onboarding.complete;
  const fullyManaged = onboarding?.fullyManaged === true;

  const managedList = list.filter((a) => a.managedByAdmin);
  const actionable = list.filter(
    (a) => !a.managedByAdmin && isActionable(a.status as AssignmentStatus),
  );
  const toShoot = actionable.filter((a) => a.status === "todo" || a.status === "in_progress");
  const toPublish = actionable.filter((a) => a.status === "to_publish");
  const toRedo = actionable.filter(
    (a) => a.status === "video_rejected" || a.status === "rejected",
  );

  const action = loaded
    ? nextCreatorAction({
        rows: list,
        now: nowMs,
        warmupDue,
        onboardingPending: showChecklist,
      })
    : null;
  const heroId = action && "row" in action ? action.row._id : null;

  // « Ensuite » : les missions à faire hors de la carte, dans l'ordre du planning
  // (rattrapages d'abord, le plus ancien en tête — même tri que le bandeau).
  const upcoming = sortBySchedule(
    actionable
      .filter((a) => a._id !== heroId)
      .map((a) => ({
        row: a,
        postDate: a.postDate,
        postWindow: a.postWindow,
        publishedAt: representativePostedAt(a),
      })),
    nowMs,
  ).map((x) => x.row);
  const shown = upcoming.slice(0, UPCOMING_CAP);
  const extra = upcoming.length - shown.length;
  // Warmup dû mais pas en tête (une action plus urgente y est) : il reste une
  // tâche du jour, donc il remonte en premier dans « Ensuite ».
  const warmupInUpcoming = warmupDue > 0 && action?.kind !== "warmup" && !showChecklist;

  const today = new Intl.DateTimeFormat(loc, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(nowMs);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <p className="text-sm font-medium text-slate-500 first-letter:uppercase">{today}</p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {name ? t("dashboard.greetingNamed", { name }) : t("dashboard.greeting")}
        </h1>
      </header>

      <PaymentInfoNudge projectId={projectId} />

      {!loaded || action === null ? (
        <div className="space-y-3">
          <Skeleton className="h-52 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
          <div className="min-w-0 space-y-6">
            {action.kind === "onboarding" ? (
              onboarding && <OnboardingChecklist onb={onboarding} base={base} />
            ) : action.kind === "allClear" ? (
              <AllClear />
            ) : (
              <NextActionCard action={action} base={base} />
            )}

            {fullyManaged && <ManagedByTeamNotice />}

            {actionable.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <Counter testId="produce-count" value={toShoot.length} label={t("home.counters.toShoot")} />
                <Counter testId="publish-count" value={toPublish.length} label={t("home.counters.toPublish")} />
                <Counter
                  testId="redo-count"
                  value={toRedo.length}
                  label={t("home.counters.toRedo")}
                  tone={toRedo.length > 0 ? "rose" : "slate"}
                />
              </div>
            )}

            {/* Le programme du jour garde son bandeau, SAUF quand la carte dit
                déjà « publier aujourd'hui » : on ne répète pas la même mission. */}
            {action.kind !== "publishToday" && (
              <TodayPostBanner list={list} now={nowMs} base={base} />
            )}

            {/* Défi : une opportunité, sous l'action du jour — jamais au-dessus. */}
            <ChallengeBanner />

            {warmupDue === 0 && warmupInProgress > 0 && !showChecklist && (
              <WarmupOngoingReminder href={portalHref(base, "/comptes")} />
            )}

            {(shown.length > 0 || warmupInUpcoming) && (
              <section className="space-y-2" data-testid="home-upcoming">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-900">{t("home.upcoming")}</h2>
                  <Link
                    href={portalHref(base, "/missions")}
                    className="text-sm font-semibold text-primary hover:underline"
                  >
                    {t("home.upcomingAll")}
                  </Link>
                </div>
                <ul className="space-y-2">
                  {warmupInUpcoming && (
                    <li>
                      <Link
                        href={portalHref(base, "/comptes")}
                        className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 transition-colors hover:bg-amber-100"
                      >
                        <FlameIcon className="size-5 shrink-0 text-amber-600" />
                        <span className="min-w-0 flex-1 text-sm font-medium text-amber-900">
                          {t("home.kind.warmupTitle", { count: warmupDue })}
                        </span>
                        <ArrowRightIcon className="size-4 shrink-0 text-amber-700" />
                      </Link>
                    </li>
                  )}
                  {shown.map((a) => (
                    <li key={a._id}>
                      <MissionListItem assignment={a} base={base} showFeedback />
                    </li>
                  ))}
                  {extra > 0 && (
                    <li className="px-1 pt-1">
                      <Link
                        href={portalHref(base, "/missions")}
                        data-testid="see-all-missions"
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 underline underline-offset-4 hover:text-slate-900"
                      >
                        {t("missions.seeAll", { count: extra })}
                        <ArrowRightIcon className="size-3" />
                      </Link>
                    </li>
                  )}
                </ul>
              </section>
            )}

            {managedList.length > 0 && (
              <section
                data-testid="block-managed"
                className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <UsersIcon className="size-5" />
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <h2 className="text-base font-semibold text-slate-900">{t("dashboard.managedTitle")}</h2>
                    <p className="text-sm text-slate-500">{t("dashboard.managedBody")}</p>
                  </div>
                </div>
                <ul className="space-y-2">
                  {managedList.slice(0, UPCOMING_CAP).map((a) => (
                    <li key={a._id}>
                      <MissionListItem assignment={a} base={base} managed />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <CreatorPublicationCalendar list={list} now={nowMs} base={base} />
          </div>

          {argent && (
            <aside className="min-w-0 space-y-6">
              <CycleGainsCard />
              <RankCard variant="window" />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function Counter({
  testId,
  value,
  label,
  tone = "slate",
}: {
  testId: string;
  value: number;
  label: string;
  tone?: "slate" | "rose";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <p
        data-testid={testId}
        className={cn(
          "text-2xl font-bold tabular-nums",
          tone === "rose" ? "text-rose-600" : "text-slate-900",
        )}
      >
        {value}
      </p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

/**
 * LA CARTE D'ACTION — un titre qui dit le geste, une phrase qui dit pourquoi
 * maintenant, un bouton. Tout le reste de l'accueil lui est subordonné.
 */
function NextActionCard({
  action,
  base,
}: {
  action: Exclude<NextAction<CreatorAssignment>, { kind: "onboarding" } | { kind: "allClear" }>;
  base: string;
}) {
  const t = useTranslations("portal");
  const tLabel = useLabel();
  const loc = useIntlLocale();

  const row = "row" in action ? action.row : null;
  const urgency = row
    ? assignmentUrgency(row.dueDate, row.status as AssignmentStatus)
    : ("none" as const);
  const missionHref = row ? portalHref(base, `/assignments/${row._id}`) : null;
  const plannedDay = (ts: number) =>
    formatPlannedDay(ts, loc, { weekday: "long", day: "numeric", month: "long" });

  let icon: LucideIcon = ClapperboardIcon;
  let title = "";
  let hint = "";
  let cta = t("home.cta.open");
  let href = missionHref ?? portalHref(base, "/missions");
  let urgent = false;

  switch (action.kind) {
    case "catchup":
      icon = ClockIcon;
      urgent = true;
      title = t("home.kind.catchupTitle", { name: action.row.formatName });
      hint = action.row.postDate != null
        ? t("home.kind.catchupHint", { date: plannedDay(action.row.postDate) })
        : "";
      cta = action.row.status === "to_publish" ? t("home.cta.publish") : t("home.cta.open");
      break;
    case "publishToday":
      icon = SendIcon;
      title = t("home.kind.publishTodayTitle", { name: action.row.formatName });
      hint = t("home.kind.publishTodayHint");
      cta = t("home.cta.publish");
      break;
    case "redo":
      icon = RotateCcwIcon;
      urgent = true;
      title = t("home.kind.redoTitle", { name: action.row.formatName });
      hint = t("home.kind.redoHint");
      cta = t("home.cta.redo");
      break;
    case "warmup":
      icon = FlameIcon;
      title = t("home.kind.warmupTitle", { count: action.count });
      hint = t("dashboard.warmup.description");
      cta = t("home.cta.warmup");
      href = portalHref(base, "/comptes");
      break;
    case "publish":
      icon = SendIcon;
      title = t("home.kind.publishTitle", { name: action.row.formatName });
      hint = action.row.postDate != null
        ? t("home.kind.publishHint", { date: plannedDay(action.row.postDate) })
        : t("home.kind.publishHintNoDate");
      cta = t("home.cta.publish");
      break;
    case "produce":
      icon = ClapperboardIcon;
      title = t("home.kind.produceTitle", { name: action.row.formatName });
      hint = t("home.kind.produceHint", { date: formatMissionDate(action.row.dueDate, loc) });
      cta = t("home.cta.shoot");
      break;
    case "waiting":
      icon = HourglassIcon;
      title = t("home.kind.waitingTitle", { count: action.count });
      hint = t("home.kind.waitingHint");
      cta = t("home.cta.missions");
      href = portalHref(base, "/missions");
      break;
  }

  const Icon = icon;
  const others = "others" in action ? action.others : 0;

  return (
    <section
      data-testid="home-next-action"
      data-kind={action.kind}
      className="space-y-4 rounded-xl border border-primary/25 bg-white p-4 shadow-[0_12px_32px_-20px_color-mix(in_srgb,var(--primary)_55%,transparent)] sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          {t("home.nextAction")}
        </p>
        <div className="flex min-w-0 items-center gap-2">
          {row && row.targets.length > 0 && (
            <span className="truncate font-mono text-xs text-slate-400">
              {row.targets.map((x) => x.platform).join(" · ")}
            </span>
          )}
          {/* Échéance de PRODUCTION dépassée ou proche : le même badge que dans
              les listes — la carte ne doit pas taire ce que la ligne disait. */}
          {urgency !== "none" && urgency !== "ok" && (
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold",
                URGENCY_BADGE[urgency].className,
              )}
            >
              {tLabel(URGENCY_BADGE[urgency].labelKey)}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl",
            urgent ? "bg-rose-50 text-rose-600" : "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-bold leading-snug tracking-tight text-slate-900 sm:text-xl">
            {/* Le titre nomme la mission : il y mène, comme une ligne de liste. */}
            {missionHref ? (
              <Link href={missionHref} className="hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
          </h2>
          {hint && (
            <p className={cn("text-sm", urgent ? "text-rose-700" : "text-slate-600")}>{hint}</p>
          )}
          {action.kind === "redo" && action.row.videoReviewFeedback && (
            <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">
              {action.row.videoReviewFeedback}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={href}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          {cta}
          <ArrowRightIcon className="size-4" />
        </Link>
        {others > 0 && (
          <Link
            href={portalHref(base, "/missions")}
            className="text-center text-sm font-medium text-slate-500 hover:text-slate-900 sm:text-right"
          >
            {action.kind === "catchup"
              ? t("home.kind.catchupOthers", { count: others })
              : t("home.kind.others", { count: others })}
          </Link>
        )}
      </div>
    </section>
  );
}

/**
 * Checklist d'ONBOARDING (Snytch) — tant que le compte n'est pas activé, c'est
 * elle, la prochaine action : on guide au lieu d'afficher un faux « à jour ».
 */
function OnboardingChecklist({
  onb,
  base,
}: {
  onb: OnboardingDerived;
  base: string;
}) {
  const t = useTranslations("portal");
  const s = onb.steps;
  const best = onb.best;
  const comptesHref = portalHref(base, "/comptes");
  return (
    <section
      data-testid="onboarding-checklist"
      className="space-y-4 rounded-xl border border-primary/25 bg-white p-4 sm:p-5"
    >
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          {t("home.nextAction")}
        </p>
        <h2 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
          {t("dashboard.onboardTitle")}
        </h2>
        <p className="text-sm text-slate-600">{t("dashboard.onboardBody")}</p>
      </div>
      <div className="space-y-3">
        <ChecklistRow
          testId="step-declare"
          state={s.declare}
          title={t("dashboard.step.declare.title")}
          detail={
            onb.hasDeclaredAccount
              ? t("dashboard.step.declare.done")
              : t("dashboard.step.declare.todo")
          }
          cta={
            onb.hasDeclaredAccount
              ? undefined
              : { href: comptesHref, label: t("dashboard.step.declare.cta") }
          }
        />
        <ChecklistRow
          testId="step-warmup"
          state={s.warmup}
          title={t("dashboard.step.warmup.title")}
          detail={
            s.warmup === "done"
              ? t("dashboard.step.warmup.done")
              : best
                ? t("dashboard.step.warmup.progress", { done: best.checksDone, target: best.targetDays })
                : t("dashboard.step.warmup.locked")
          }
          cta={
            best?.dueToday
              ? { href: comptesHref, label: t("dashboard.step.warmup.cta") }
              : undefined
          }
        />
        {s.bio !== "na" && (
          <ChecklistRow
            testId="step-bio"
            state={s.bio}
            title={t("dashboard.step.bio.title")}
            detail={
              s.bio === "todo"
                ? t("dashboard.step.bio.todo")
                : t("dashboard.step.bio.done")
            }
            cta={
              s.bio === "todo"
                ? { href: comptesHref, label: t("dashboard.step.bio.cta") }
                : undefined
            }
          />
        )}
        {s.validation === "pending" ? (
          <div
            data-testid="awaiting-validation"
            className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
          >
            <ClockIcon className="size-5 shrink-0 text-amber-600" />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-amber-900">{t("dashboard.pendingTitle")}</p>
              <p className="text-sm text-amber-800">{t("dashboard.pendingBody")}</p>
            </div>
          </div>
        ) : (
          <ChecklistRow
            testId="step-validation"
            state={s.validation}
            title={t("dashboard.step.validation.title")}
            detail={
              s.validation === "done"
                ? t("dashboard.step.validation.done")
                : t("dashboard.step.validation.todo")
            }
          />
        )}
      </div>
    </section>
  );
}

const STEP_ICON: Record<StepState, { Icon: LucideIcon; className: string }> = {
  done: { Icon: CircleCheckIcon, className: "text-emerald-500" },
  in_progress: { Icon: CircleDashedIcon, className: "text-amber-500" },
  todo: { Icon: CircleDashedIcon, className: "text-primary" },
  pending: { Icon: ClockIcon, className: "text-amber-500" },
  upcoming: { Icon: CircleIcon, className: "text-slate-300" },
  na: { Icon: CircleIcon, className: "text-slate-300" },
};

/** Ligne de checklist : icône d'état + titre + détail + CTA optionnel. */
function ChecklistRow({
  testId,
  state,
  title,
  detail,
  cta,
}: {
  testId: string;
  state: StepState;
  title: string;
  detail?: string;
  cta?: { href: string; label: string };
}) {
  const { Icon, className } = STEP_ICON[state];
  const muted = state === "upcoming" || state === "na";
  return (
    <div data-testid={testId} data-state={state} className="flex items-start gap-3">
      <Icon className={cn("mt-0.5 size-5 shrink-0", className)} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className={cn("text-sm font-medium", muted ? "text-slate-400" : "text-slate-900")}>
          {title}
        </p>
        {detail && (
          <p className={cn("text-xs", muted ? "text-slate-400" : "text-slate-500")}>{detail}</p>
        )}
        {cta && (
          <Link
            href={cta.href}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            {cta.label}
            <ArrowRightIcon className="size-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

/** Créatrice « full gérée » : rien à configurer, l'équipe tient ses comptes. */
function ManagedByTeamNotice() {
  const t = useTranslations("portal");
  return (
    <div
      data-testid="managed-by-team-notice"
      className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        <UsersIcon className="size-5" />
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-semibold text-slate-900">{t("dashboard.teamManagesTitle")}</p>
        <p className="text-sm text-slate-500">{t("dashboard.teamManagesBody")}</p>
      </div>
    </div>
  );
}

/** Rien à faire, dans aucune catégorie. */
function AllClear() {
  const t = useTranslations("portal");
  return (
    <section
      data-testid="all-clear"
      className="flex flex-col items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-10 text-center"
    >
      <PartyPopperIcon className="size-9 text-emerald-500" strokeWidth={1.5} />
      <p className="text-base font-semibold text-emerald-900">{t("dashboard.allClearTitle")}</p>
      <p className="text-sm text-emerald-700">{t("dashboard.allClearBody")}</p>
    </section>
  );
}

/**
 * Warmup en cours, check du jour déjà fait : rappel qu'il se coche CHAQUE jour
 * jusqu'au bout — jamais laisser croire qu'il n'y a plus rien à faire.
 */
function WarmupOngoingReminder({ href }: { href: string }) {
  const t = useTranslations("portal");
  return (
    <Link
      href={href}
      data-testid="warmup-ongoing-reminder"
      className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 transition-colors hover:bg-amber-100"
    >
      <FlameIcon className="size-5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium text-amber-900">{t("dashboard.warmupDoneToday")}</p>
        <p className="text-sm text-amber-800">{t("dashboard.warmupDailyHint")}</p>
      </div>
      <ArrowRightIcon className="size-4 shrink-0 text-amber-700" />
    </Link>
  );
}
