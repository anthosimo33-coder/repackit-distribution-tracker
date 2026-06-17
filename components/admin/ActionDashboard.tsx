"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRightIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  FlameIcon,
  UserPlusIcon,
  WalletIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { formatEuros } from "@/lib/format-rate";
import { missedDays } from "@/lib/warmup";
import {
  getEffectiveStatus,
  getEffectiveWarmupDuration,
} from "@/lib/compte-status";
import { creatorStatusBadge } from "@/lib/creator-status";

const DAY_MS = 86_400_000;
const WORKLIST_LIMIT = 6;
const ACTIVITY_LIMIT = 8;

/**
 * Dashboard d'accueil orienté ACTION — agrège des queries DÉJÀ existantes
 * (listAssignments, listComptes, listPayments, listCreators) côté client. Aucune
 * nouvelle logique métier ni fonction Convex : chaque carte/section ne fait que
 * filtrer/compter l'existant (cf lib/warmup, lib/compte-status). Toutes les
 * cartes sont cliquables et mènent à la page concernée.
 */

// Période de paie courante "YYYY-MM" (UTC) — identique à convex/payments.periodOf
// (réplique pure pour ne pas importer un module Convex côté client).
function currentPeriod(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

function relativeAge(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < 60_000) return "à l'instant";
  const days = Math.floor(diff / DAY_MS);
  if (days >= 1) return `il y a ${days} j`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `il y a ${hours} h`;
  return `il y a ${Math.floor(diff / 60_000)} min`;
}

export function ActionDashboard() {
  const projectPath = useProjectPath();
  // « Maintenant » figé au mount (lazy init pur — cf react-hooks/purity, même
  // pattern que MetricChart). Suffisant pour un instantané de dashboard.
  const [now] = useState(() => Date.now());
  const assignments = useProjectQuery(api.assignments.listAssignments, {});
  const comptes = useProjectQuery(api.comptes.listComptes, {});
  const payments = useProjectQuery(api.payments.listPayments, {});
  const creators = useProjectQuery(api.creators.listCreators, {});

  const loading =
    assignments === undefined ||
    comptes === undefined ||
    payments === undefined ||
    creators === undefined;

  const data = useMemo(() => {
    if (
      assignments === undefined ||
      comptes === undefined ||
      payments === undefined ||
      creators === undefined
    ) {
      return null;
    }
    const period = currentPeriod(now);

    // Carte 1 + worklist — vidéos en attente de revue (plus anciennes en tête).
    const submitted = assignments
      .filter((a) => a.status === "video_submitted")
      .sort((a, b) => a.createdAt - b.createdAt);

    // Carte 2 — comptes en warmup avec des jours manqués (lib/warmup).
    const warmupLate = comptes.filter((c) => {
      if (getEffectiveStatus(c) !== "warmup" || c.warmupStartedAt === undefined)
        return false;
      return (
        missedDays(
          c.warmupStartedAt,
          c.warmupProtocol?.dailyChecks ?? [],
          getEffectiveWarmupDuration(c),
        ) > 0
      );
    });

    // Carte 3 — total accruing de la période de paie courante.
    const dueThisMonth = payments
      .filter((p) => p.period === period && p.status === "accruing")
      .reduce((s, p) => s + p.totalDue, 0);

    // Carte 4 — assignments actionnables dont la deadline tombe sous 7 j.
    const deadlines7 = assignments.filter((a) => {
      if (a.status !== "todo" && a.status !== "in_progress") return false;
      const d = a.dueDate - now;
      return d >= 0 && d <= 7 * DAY_MS;
    });

    // Activité créateurs — join créateurs × comptes (par creatorId), agrégats
    // perf déjà calculés par listComptes (perf.vuesCumulees / perf.nbPublies).
    const comptesByCreator = new Map<string, typeof comptes>();
    for (const c of comptes) {
      if (!c.creatorId) continue;
      const arr = comptesByCreator.get(c.creatorId) ?? [];
      arr.push(c);
      comptesByCreator.set(c.creatorId, arr);
    }
    const creatorActivity = creators
      .filter((cr) => cr.status !== "churned")
      .map((cr) => {
        const accts = comptesByCreator.get(cr._id) ?? [];
        return {
          creator: cr,
          vues: accts.reduce((s, a) => s + a.perf.vuesCumulees, 0),
          posts: accts.reduce((s, a) => s + a.perf.nbPublies, 0),
          warmupCount: accts.filter((a) => getEffectiveStatus(a) === "warmup")
            .length,
          nbComptes: accts.length,
        };
      })
      .sort((a, b) => b.vues - a.vues);

    return {
      submitted,
      warmupLate,
      dueThisMonth,
      deadlines7,
      creatorActivity,
      totalCreators: creators.length,
    };
  }, [assignments, comptes, payments, creators, now]);

  if (loading || data === null) return <ActionSkeleton />;

  const {
    submitted,
    warmupLate,
    dueThisMonth,
    deadlines7,
    creatorActivity,
    totalCreators,
  } = data;

  // État vide : ni créateur ni soumission → message d'accueil (pas des cartes à
  // zéro qui semblent cassées).
  if (totalCreators === 0 && submitted.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserPlusIcon className="size-6" />
          </span>
          <div className="space-y-1">
            <h2 className="text-lg font-medium text-slate-900">
              Invite tes premiers créateurs pour commencer
            </h2>
            <p className="text-sm text-slate-500">
              Une fois des créateurs ajoutés et des contenus assignés, leurs
              soumissions et deadlines apparaîtront ici.
            </p>
          </div>
          <Link
            href={projectPath("/createurs")}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <UserPlusIcon className="size-4" />
            Ajouter un créateur
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Rangée de 4 cartes-action cliquables. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ActionCard
          href={projectPath("/validation")}
          icon={CheckCircle2Icon}
          label="À valider"
          value={String(submitted.length)}
          hint="soumissions en attente"
          accent
        />
        <ActionCard
          href={projectPath("/comptes")}
          icon={FlameIcon}
          label="Warmups en retard"
          value={String(warmupLate.length)}
          hint="comptes avec jours manqués"
          warn={warmupLate.length > 0}
        />
        <ActionCard
          href={projectPath("/paiements")}
          icon={WalletIcon}
          label="Dû ce mois"
          value={formatEuros(dueThisMonth)}
          hint="paiements en cours d'accumulation"
        />
        <ActionCard
          href={projectPath("/assignments")}
          icon={CalendarClockIcon}
          label="Deadlines 7 j"
          value={String(deadlines7.length)}
          hint="assignments à rendre"
          warn={deadlines7.length > 0}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* À traiter maintenant — worklist des soumissions + raccourci warmups. */}
        <Section
          title="À traiter maintenant"
          action={
            submitted.length > 0
              ? { label: "Voir tout", href: projectPath("/validation") }
              : undefined
          }
        >
          {submitted.length === 0 && warmupLate.length === 0 ? (
            <EmptyRow icon={CheckCircle2Icon} label="Rien à traiter — tout est à jour." />
          ) : (
            <div className="divide-y divide-slate-100">
              {submitted.slice(0, WORKLIST_LIMIT).map((a) => (
                <div
                  key={a._id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {a.creatorName}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {a.formatName ?? (a.origin === "script" ? "Script" : "Format")}
                      {" · "}
                      {relativeAge(a.createdAt, now)}
                    </div>
                  </div>
                  <Link
                    href={projectPath("/validation")}
                    className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Valider
                  </Link>
                </div>
              ))}
              {warmupLate.length > 0 && (
                <Link
                  href={projectPath("/comptes")}
                  className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2 text-sm text-slate-700">
                    <FlameIcon className="size-4 text-amber-600" />
                    <span>
                      <span className="font-medium">{warmupLate.length}</span>{" "}
                      warmup{warmupLate.length > 1 ? "s" : ""} en retard à
                      relancer
                    </span>
                  </div>
                  <ArrowRightIcon className="size-4 shrink-0 text-slate-400" />
                </Link>
              )}
            </div>
          )}
        </Section>

        {/* Activité créateurs — agrégats existants (perf par compte). */}
        <Section
          title="Activité créateurs"
          action={
            creatorActivity.length > 0
              ? { label: "Voir tout", href: projectPath("/createurs") }
              : undefined
          }
        >
          {creatorActivity.length === 0 ? (
            <EmptyRow icon={UserPlusIcon} label="Aucun créateur actif." />
          ) : (
            <div className="divide-y divide-slate-100">
              {creatorActivity.slice(0, ACTIVITY_LIMIT).map(({ creator, vues, posts, warmupCount }) => {
                const badge = creatorStatusBadge(creator.status);
                return (
                  <Link
                    key={creator._id}
                    href={projectPath(`/createurs/${creator._id}`)}
                    className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">
                          {creator.name}
                        </span>
                        <Badge variant="outline" className={badge.className}>
                          {badge.label}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {posts} post{posts > 1 ? "s" : ""}
                        {warmupCount > 0 && (
                          <span className="text-amber-600">
                            {" · "}
                            {warmupCount} en warmup
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold tabular-nums text-slate-900">
                        {formatNumber(vues)}
                      </div>
                      <div className="text-xs text-slate-400">vues</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function ActionCard({
  href,
  icon: Icon,
  label,
  value,
  hint,
  accent,
  warn,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <Link href={href} className="group block">
      <Card className="transition-colors group-hover:border-primary/40 group-hover:bg-primary/[0.03]">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-md",
                accent
                  ? "bg-primary/10 text-primary"
                  : warn
                    ? "bg-amber-50 text-amber-600"
                    : "bg-slate-100 text-slate-500",
              )}
            >
              <Icon className="size-4" />
            </span>
            <ArrowRightIcon className="size-4 text-slate-300 transition-colors group-hover:text-primary" />
          </div>
          <div
            className={cn(
              "mt-3 text-3xl font-bold tabular-nums",
              accent ? "text-primary" : "text-slate-900",
            )}
          >
            {value}
          </div>
          <div className="mt-1 text-sm font-medium text-slate-700">{label}</div>
          <div className="text-xs text-slate-400">{hint}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            {title}
          </h2>
          {action && (
            <Link
              href={action.href}
              className="text-xs font-medium text-primary hover:underline"
            >
              {action.label}
            </Link>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function EmptyRow({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
      <Icon className="size-4" />
      {label}
    </div>
  );
}

function ActionSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
