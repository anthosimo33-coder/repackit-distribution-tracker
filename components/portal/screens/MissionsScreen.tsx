"use client";

import { useMemo, useState } from "react";
import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { useMyAssignments } from "@/components/portal/creator-data";
import { usePortalBase } from "@/components/portal/ViewAsContext";
import {
  MissionListItem,
  type CreatorAssignment,
} from "@/components/portal/MissionListItem";
import { groupBySchedule } from "@/lib/creator-schedule";
import { representativePostedAt } from "@/lib/calendar-status";
import { isActionable, type AssignmentStatus } from "@/lib/assignment-status";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CircleCheckIcon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";

/**
 * « MES MISSIONS » — la liste EXHAUSTIVE de ce que la créatrice a encore à faire.
 *
 * POURQUOI CET ÉCRAN EXISTE. Le dashboard plafonne chaque bloc à 5 lignes, et le
 * portail n'avait aucune autre liste de missions : au-delà de 5, les suivantes
 * n'étaient joignables que par le bandeau « à rattraper » (donc seulement une
 * fois en retard) ou par le calendrier (2 pastilles par jour, le reste muet).
 * Relevé en prod le 28/08/2026 : 16 missions actionnables pour une créatrice,
 * 9 hors des blocs ; une autre avec 4 missions le même jour, dont 2 sans aucun
 * chemin d'accès. Ici, RIEN n'est plafonné.
 *
 * LECTURE PAR JOUR. Le regroupement vient de `lib/creator-schedule.groupBySchedule`,
 * qui réutilise `isToCatchUp` — le MÊME prédicat que le bandeau rouge du
 * dashboard. Deux définitions du retard placeraient une mission dans le bandeau
 * et pas dans la liste, ou l'inverse.
 *
 * Écran RÉUTILISÉ par le portail créateur ET par le mode admin « voir l'espace »
 * (lecture seule) : données via le hook d'indirection, liens préfixés par
 * usePortalBase().
 */
export default function MissionsScreen() {
  const t = useTranslations("portal");
  const loc = useIntlLocale();
  const projectId = useCreatorProjectId();
  const base = usePortalBase();
  const assignments = useMyAssignments(projectId);
  // Ancre temporelle stable au montage (impure au render sinon, cf le dashboard).
  const [nowMs] = useState(() => Date.now());

  const list = useMemo(() => assignments ?? [], [assignments]);
  // Missions ACTIONNABLES et non gérées : exactement le périmètre des trois blocs
  // du dashboard (à produire + à publier + à refaire), sans plafond.
  const mine = useMemo(
    () =>
      list.filter(
        (a) =>
          !a.managedByAdmin && isActionable(a.status as AssignmentStatus),
      ),
    [list],
  );
  const managed = useMemo(() => list.filter((a) => a.managedByAdmin), [list]);

  const groups = useMemo(
    () =>
      groupBySchedule(
        mine.map((a) => ({
          row: a,
          postDate: a.postDate,
          postWindow: a.postWindow,
          publishedAt: representativePostedAt(a),
        })),
        nowMs,
      ),
    [mine, nowMs],
  );

  const dayLabel = (dayStart: number) => {
    const d = new Date(dayStart);
    const today = new Date(nowMs);
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((dayStart - today.getTime()) / 86_400_000);
    if (diff === 0) return t("missions.group.today");
    if (diff === 1) return t("missions.group.tomorrow");
    // `numeric` et non `2-digit` : « mardi 1 septembre », pas « mardi 01 ».
    return d.toLocaleDateString(loc, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {t("missions.title")}
        </h1>
        <p className="text-sm text-slate-500">
          {assignments === undefined
            ? t("missions.subtitle")
            : `${t("missions.count", { count: mine.length })} — ${t("missions.subtitle")}`}
        </p>
      </header>

      {assignments === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : mine.length === 0 && managed.length === 0 ? (
        <Card data-testid="missions-empty">
          <CardContent className="flex items-center gap-3 p-6 text-sm">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <CircleCheckIcon className="size-5" />
            </span>
            <p className="text-slate-600">{t("missions.empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6" data-testid="missions-list">
          {groups.catchup.length > 0 && (
            <Section
              testId="missions-group-catchup"
              tone="rose"
              title={t("missions.group.catchup")}
              hint={t("missions.groupHint.catchup")}
              count={groups.catchup.length}
              items={groups.catchup.map((x) => x.row)}
              base={base}
            />
          )}
          {groups.days.map((d) => (
            <Section
              key={d.dayStart}
              testId={`missions-group-day-${d.dayStart}`}
              tone="slate"
              title={dayLabel(d.dayStart)}
              count={d.items.length}
              items={d.items.map((x) => x.row)}
              base={base}
            />
          ))}
          {groups.later.length > 0 && (
            <Section
              testId="missions-group-later"
              tone="slate"
              title={t("missions.group.later")}
              count={groups.later.length}
              items={groups.later.map((x) => x.row)}
              base={base}
            />
          )}
          {groups.undated.length > 0 && (
            <Section
              testId="missions-group-undated"
              tone="slate"
              title={t("missions.group.undated")}
              hint={t("missions.groupHint.undated")}
              count={groups.undated.length}
              items={groups.undated.map((x) => x.row)}
              base={base}
            />
          )}
          {managed.length > 0 && (
            <Section
              testId="missions-group-managed"
              tone="slate"
              icon={UsersIcon}
              title={t("missions.group.managed")}
              count={managed.length}
              items={managed}
              base={base}
              managed
            />
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  testId,
  title,
  hint,
  count,
  items,
  base,
  tone,
  managed,
  icon: Icon,
}: {
  testId: string;
  title: string;
  hint?: string;
  count: number;
  items: CreatorAssignment[];
  base: string;
  tone: "rose" | "slate";
  managed?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <section data-testid={testId} className="space-y-2">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="size-4 text-slate-400" />}
        <h2
          className={
            tone === "rose"
              ? "text-sm font-semibold text-rose-700"
              : "text-sm font-semibold text-slate-900 first-letter:uppercase"
          }
        >
          {title}
        </h2>
        <span
          data-testid={`${testId}-count`}
          className={
            tone === "rose"
              ? "rounded-full border border-rose-300 bg-rose-100 px-1.5 text-xs font-medium text-rose-700"
              : "rounded-full border border-slate-200 bg-slate-100 px-1.5 text-xs font-medium text-slate-600"
          }
        >
          {count}
        </span>
      </div>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a._id}>
            <MissionListItem
              assignment={a}
              base={base}
              showFeedback
              managed={managed}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
