"use client";

import { useState } from "react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { PaymentInfoNudge } from "@/components/portal/PaymentInfoNudge";
import { PortalLeaderboard } from "@/components/portal/PortalLeaderboard";
import {
  useMyAssignments,
  useWarmupDue,
  useWarmupInProgress,
  useMyPayments,
  useOnboardingState,
  useMyVideoStats,
} from "@/components/portal/creator-data";
import { usePortalBase } from "@/components/portal/ViewAsContext";
import { portalHref } from "@/lib/view-as";
import {
  deriveOnboarding,
  type StepState,
  type OnboardingDerived,
} from "@/lib/onboarding";
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
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  ClapperboardIcon,
  ClockIcon,
  FilmIcon,
  FlameIcon,
  ListChecksIcon,
  PartyPopperIcon,
  RotateCcwIcon,
  SendIcon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatEuros, formatViews } from "@/lib/format-rate";
import { isSnytchProject } from "@/lib/snytch-drive";
import type { Id } from "@/convex/_generated/dataModel";
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
  const base = usePortalBase();

  const assignments = useMyAssignments(projectId);
  const warmupDue = useWarmupDue(projectId) ?? 0;
  // QW1 — warmups EN COURS (qu'un check soit dû aujourd'hui ou non) : alimente le
  // rappel permanent « reviens le cocher chaque jour » (lecture seule).
  const warmupInProgress = useWarmupInProgress(projectId) ?? 0;
  const payments = useMyPayments(projectId);
  // Onboarding (Snytch) — dérivé serveur compact. Hors Snytch : applicable false.
  const onboardingRaw = useOnboardingState(projectId);
  const onboarding = onboardingRaw ? deriveOnboarding(onboardingRaw) : null;

  const list = assignments ?? [];
  // Comptes GÉRÉS par l'équipe : missions montrées en LECTURE (script visible)
  // mais JAMAIS dans les blocs actionnables — la créatrice ne produit/soumet/
  // publie rien dessus (l'équipe s'en charge, cf managedByAdmin dénormalisé).
  const managedList = list.filter((a) => a.managedByAdmin);
  const actionable = list.filter((a) => !a.managedByAdmin);
  const toProduce = actionable.filter(
    (a) => a.status === "todo" || a.status === "in_progress",
  );
  const toPublish = actionable.filter((a) => a.status === "to_publish");
  const toRedo = actionable.filter(
    (a) => a.status === "video_rejected" || a.status === "rejected",
  );

  // Gains + prochaine paie du CYCLE J+30 EN COURS (fenêtre de 30 j perso, ancrée
  // au 1er post). Cycle courant = celui qui contient maintenant (sinon le plus
  // récent). « Prochaine paie » = sa fin (cycleEnd) — plus de « 10 du mois ».
  // Ancre temporelle stable au montage (impure au render sinon, cf react-hooks/purity).
  const [nowMs] = useState(() => Date.now());
  const currentCycle =
    (payments ?? []).find((p) => nowMs >= p.cycleStart && nowMs < p.cycleEnd) ??
    (payments ?? [])[0] ??
    null;
  const dueNow = currentCycle?.totalDue ?? 0;
  const nextPayoutTs = currentCycle?.cycleEnd ?? null;
  const payoutDays =
    nextPayoutTs !== null
      ? Math.max(0, Math.ceil((nextPayoutTs - nowMs) / 86_400_000))
      : null;

  // On attend assignments ET onboarding pour éviter un flash « Tout est à jour »
  // avant que l'état d'onboarding soit connu.
  const loaded = assignments !== undefined && onboarding !== null;
  // Checklist visible tant que l'onboarding Snytch n'est PAS terminé.
  const showChecklist = onboarding?.applicable === true && !onboarding.complete;
  // Créatrice « full gérée » (0 compte propre, l'équipe tient tout) : pas de
  // checklist (onboarding.complete=true côté lib) → message dédié à la place.
  const fullyManaged = onboarding?.fullyManaged === true;
  // Onboarding « terminé » pour la logique AllClear : true hors Snytch (dashboard
  // inchangé) et une fois la créatrice réellement activée.
  const onboardingDone = !onboarding?.applicable || onboarding.complete;
  // Pendant l'onboarding PUR (aucun compte actif), la checklist porte déjà l'info
  // warmup → on masque les blocs warmup autonomes pour ne pas dupliquer.
  const suppressWarmupBlocks =
    showChecklist && onboarding?.hasActiveAccount === false;

  const allClear =
    loaded &&
    onboardingDone &&
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

      {!loaded ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <>
          {/* 0. Checklist d'onboarding (Snytch) — tant que le compte n'est pas
              activé, on guide au lieu d'afficher un faux « tout à jour ». */}
          {showChecklist && onboarding && (
            <OnboardingChecklist onb={onboarding} base={base} />
          )}

          {/* Créatrice full gérée : rien à configurer (l'équipe tient ses
              comptes). Message court + espace normal (missions/vidéos/AllClear
              selon l'état réel). Mutuellement exclusif avec la checklist. */}
          {fullyManaged && <ManagedByTeamNotice />}

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

          {/* 2. Warmups à cocher aujourd'hui — masqué pendant l'onboarding pur
              (la checklist porte déjà l'étape warmup). */}
          {!suppressWarmupBlocks && warmupDue > 0 && (
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
          {!suppressWarmupBlocks &&
            warmupDue === 0 &&
            warmupInProgress > 0 && (
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

          {/* Gérées par l'équipe — LECTURE seule : la créatrice consulte le
              script à produire, mais l'équipe publie (aucune action ici). Le
              post publié + les perfs apparaissent dans « Mes vidéos ». */}
          {managedList.length > 0 && (
            <Card data-testid="block-managed">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <UsersIcon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      Gérées par l&apos;équipe
                    </CardTitle>
                    <CardDescription>
                      L&apos;équipe publie ces vidéos — ouvre-les pour voir le
                      script. Le post et les perfs arrivent dans « Mes vidéos ».
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <AssignmentList items={managedList} base={base} managed />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Récap « Mes vidéos publiées » (Snytch) — 3 chiffres du mois + détail. */}
      {isSnytchProject(current.slug) && (
        <VideoStatsCard projectId={projectId} base={base} />
      )}

      {/* 5. Aperçu gains + prochaine paie — toujours visible. */}
      <EarningsOverview
        loading={payments === undefined}
        dueNow={dueNow}
        nextPayoutTs={nextPayoutTs}
        payoutDays={payoutDays}
        detailHref={portalHref(base, "/paiements")}
      />

      {/* 6. Classement du projet — gains de tous visibles (transparence assumée),
          soi surligné. Scopé/sécurisé serveur (creatorQuery), view-as géré via le
          hook d'indirection. */}
      <PortalLeaderboard />
    </div>
  );
}

/**
 * Checklist d'ONBOARDING (Snytch) — remplace le faux « Tout est à jour » tant
 * que la créatrice n'est pas activée. Guide les 4 étapes : déclarer un compte,
 * warmup, bio (si fournie), validation admin. Le message « en cours de
 * validation » couvre le trou warmup-terminé-mais-pas-encore-actif.
 */
function OnboardingChecklist({
  onb,
  base,
}: {
  onb: OnboardingDerived;
  base: string;
}) {
  const s = onb.steps;
  const best = onb.best;
  const comptesHref = portalHref(base, "/comptes");
  return (
    <Card
      data-testid="onboarding-checklist"
      className="border-primary/30 bg-primary/5"
    >
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ListChecksIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-base">
              Pour commencer à recevoir tes missions
            </CardTitle>
            <CardDescription>
              Termine ces étapes pour activer ton compte.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ChecklistRow
          testId="step-declare"
          state={s.declare}
          title="Déclare ton compte"
          detail={
            onb.hasDeclaredAccount
              ? "Compte déclaré"
              : "Ajoute ton @ TikTok / Instagram / YouTube."
          }
          cta={
            onb.hasDeclaredAccount
              ? undefined
              : { href: comptesHref, label: "Déclarer mon compte" }
          }
        />
        <ChecklistRow
          testId="step-warmup"
          state={s.warmup}
          title="Fais ton warmup"
          detail={
            s.warmup === "done"
              ? "Warmup terminé"
              : best
                ? `Jour ${best.checksDone}/${best.targetDays}`
                : "Disponible après la déclaration de ton compte."
          }
          cta={
            best?.dueToday
              ? { href: comptesHref, label: "Cocher le check du jour" }
              : undefined
          }
        />
        {s.bio !== "na" && (
          <ChecklistRow
            testId="step-bio"
            state={s.bio}
            title="Applique ta bio"
            detail={
              s.bio === "todo"
                ? "Une bio t'a été fournie — copie-la sur ton profil."
                : "Bio appliquée"
            }
            cta={
              s.bio === "todo"
                ? { href: comptesHref, label: "Voir la bio" }
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
              <p className="text-sm font-medium text-amber-900">
                Ton compte est en cours de validation
              </p>
              <p className="text-sm text-amber-800">
                Tes scripts arrivent bientôt : l&apos;équipe valide ton compte,
                tu recevras tes premières missions juste après.
              </p>
            </div>
          </div>
        ) : (
          <ChecklistRow
            testId="step-validation"
            state={s.validation}
            title="Validation de ton compte"
            detail={
              s.validation === "done"
                ? "Compte validé — tu peux recevoir des missions."
                : "L'équipe valide ton compte une fois le warmup terminé."
            }
          />
        )}
      </CardContent>
    </Card>
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
    <div
      data-testid={testId}
      data-state={state}
      className="flex items-start gap-3"
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", className)} />
      <div className="min-w-0 flex-1 space-y-1">
        <p
          className={cn(
            "text-sm font-medium",
            muted ? "text-slate-400" : "text-slate-900",
          )}
        >
          {title}
        </p>
        {detail && (
          <p className={cn("text-xs", muted ? "text-slate-400" : "text-slate-500")}>
            {detail}
          </p>
        )}
        {cta && (
          <Link
            href={cta.href}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {cta.label}
            <ArrowRightIcon className="size-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Créatrice « full gérée » (0 compte propre, l'équipe tient tous ses comptes) :
 * rien à configurer → message court à la place de la checklist d'onboarding.
 * L'espace normal (missions gérées, vidéos, AllClear) s'affiche selon l'état réel
 * des assignments — pas de faux « tout à jour » forcé.
 */
function ManagedByTeamNotice() {
  return (
    <Card
      data-testid="managed-by-team-notice"
      className="border-slate-200 bg-slate-50/60"
    >
      <CardContent className="flex items-start gap-3 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <UsersIcon className="size-5" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-slate-900">
            Ton équipe gère tes comptes
          </p>
          <p className="text-sm text-slate-500">
            Tu n&apos;as rien à configurer. Retrouve tes vidéos et leurs
            performances dans « Mes vidéos ».
          </p>
        </div>
      </CardContent>
    </Card>
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
  managed,
}: {
  items: CreatorAssignment[];
  base: string;
  showFeedback?: boolean;
  /** Comptes gérés : pas d'urgence, badge « géré par l'équipe » au lieu du statut. */
  managed?: boolean;
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
            managed={managed}
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
  managed,
}: {
  assignment: CreatorAssignment;
  base: string;
  showFeedback?: boolean;
  managed?: boolean;
}) {
  // Compte géré : aucune urgence (elle n'agit pas), et un badge « géré par
  // l'équipe » remplace le statut de workflow (« À publier » serait trompeur).
  const urg = managed
    ? ("none" as const)
    : assignmentUrgency(a.dueDate, a.status as AssignmentStatus);
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
              managed
                ? "border-slate-300 bg-slate-100 text-slate-600"
                : st.className,
            )}
          >
            {managed ? "Géré par l'équipe" : st.label}
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

/**
 * Récap « Mes vidéos publiées » (Snytch) — 3 chiffres du MOIS (vidéos en ligne /
 * vues cumulées / gains générés) + lien vers le détail par vidéo. Rendu SEULEMENT
 * si au moins une vidéo est publiée ce mois-ci (jamais de carte vide). Les gains
 * = somme des gains PAR VIDÉO déjà plafonnés 150 € (source unique, cf VideosScreen).
 */
function VideoStatsCard({
  projectId,
  base,
}: {
  projectId: Id<"projects">;
  base: string;
}) {
  const stats = useMyVideoStats(projectId);
  if (!stats || stats.onlineCount === 0) return null;
  return (
    <Card data-testid="video-stats-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FilmIcon className="size-4 text-slate-400" />
          Mes vidéos publiées
        </CardTitle>
        <CardDescription>Ton activité vidéo ce cycle.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <VideoStat label="En ligne" value={String(stats.onlineCount)} />
          <VideoStat label="Vues" value={formatViews(stats.totalViews)} />
          <VideoStat label="Gains" value={formatEuros(stats.totalGain)} />
        </div>
        <Link
          href={portalHref(base, "/videos")}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700"
        >
          Voir le détail par vidéo
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

function VideoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 py-3 text-center">
      <p
        className="text-lg font-semibold tabular-nums text-slate-900"
        data-testid="video-stat-value"
      >
        {value}
      </p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
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
