"use client";

import { useMemo, useState } from "react";
import { formatPostWindow } from "@/convex/postWindow";
import Link from "next/link";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  calendarStatus,
  representativePostedAt,
} from "@/lib/calendar-status";
import {
  CALENDAR_STATUS_META,
  type CalendarStatusVisual,
} from "@/components/calendar/calendar-status-meta";
import { portalHref } from "@/lib/view-as";
import { useLabel } from "@/lib/use-label";
import { useTranslations } from "next-intl";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

type CalRow = {
  _id: Id<"assignments">;
  formatName: string;
  postDate?: number;
  postWindow?: { startMin: number; endMin: number };
  managedByAdmin?: boolean;
  targets: { publishedAt?: number | null }[];
  publishedAt?: number | null;
};

/**
 * Mini-calendrier de PUBLICATION de la créatrice (brique D). Place ses posts (non
 * gérés par l'équipe) ayant une date planifiée, avec le STATUT calendrier (mêmes
 * couleurs/icônes que le pilotage admin, via CALENDAR_STATUS_META + lib/calendar-
 * status). Clic sur un post → son brief. Rendu null si aucune publication planifiée.
 */
export function CreatorPublicationCalendar({
  list,
  now,
  base,
}: {
  list: CalRow[];
  now: number;
  base: string;
}) {
  const tcal = useTranslations("portal.calendar");
  const tLabel = useLabel();
  const [currentMonth, setCurrentMonth] = useState(() => new Date(now));

  const planned = useMemo(
    () =>
      list
        .filter((a) => !a.managedByAdmin && a.postDate != null)
        .map((a) => ({
          row: a,
          status: calendarStatus({
            postDate: a.postDate,
            postedAt: representativePostedAt(a),
            now,
          }) as CalendarStatusVisual,
        })),
    [list, now],
  );

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(currentMonth), {
      weekStartsOn: 1,
    });
    const gridEnd = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  const byDay = useMemo(() => {
    const map = new Map<string, typeof planned>();
    for (const item of planned) {
      const key = format(new Date(item.row.postDate!), "yyyy-MM-dd");
      const arr = map.get(key);
      if (arr) arr.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [planned]);

  if (planned.length === 0) return null;

  return (
    <Card data-testid="creator-publication-calendar">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{tcal("title")}</CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={tcal("prevMonth")}
              onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="min-w-28 text-center text-sm font-medium capitalize text-slate-700">
              {/* i18n-exempt: « MMMM yyyy » est un MASQUE date-fns, pas du texte — la langue du rendu vient de la locale passée à format(), jamais de cette chaîne. */}
              {format(currentMonth, "MMMM yyyy", { locale: fr })}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={tcal("nextMonth")}
              onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-7 gap-px">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="pb-1 text-center text-[11px] font-medium text-slate-400"
            >
              {w}
            </div>
          ))}
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const items = byDay.get(key) ?? [];
            const inMonth = isSameMonth(day, currentMonth);
            const today = isToday(day);
            return (
              <div
                key={key}
                className={cn(
                  "min-h-16 rounded-md border p-1 sm:min-h-20",
                  inMonth ? "bg-white" : "bg-slate-50/50",
                  today
                    ? "border-primary ring-1 ring-primary"
                    : "border-slate-100",
                )}
              >
                <div
                  className={cn(
                    "mb-1 text-right text-xs",
                    inMonth ? "text-slate-500" : "text-slate-300",
                    today && "font-bold text-primary",
                  )}
                >
                  {format(day, "d")}
                </div>
                <div className="space-y-0.5">
                  {items.slice(0, 2).map(({ row, status }) => {
                    const meta = CALENDAR_STATUS_META[status];
                    return (
                      <Link
                        key={row._id}
                        href={portalHref(base, `/assignments/${row._id}`)}
                        title={
                          formatPostWindow(row.postWindow) !== null
                            ? `${row.formatName} · ${tLabel(meta.labelKey)} · entre ${formatPostWindow(row.postWindow)!.replace("-", " et ")}`
                            : `${row.formatName} · ${tLabel(meta.labelKey)}`
                        }
                        className={cn(
                          "flex w-full items-center gap-1 rounded border px-1 py-0.5 text-left text-[10px] font-medium leading-tight transition-colors",
                          meta.chip,
                        )}
                      >
                        <meta.Icon className="size-3 shrink-0" />
                        <span className="truncate">{row.formatName}</span>
                      </Link>
                    );
                  })}
                  {items.length > 2 && (
                    <div className="px-1 text-[10px] font-medium text-slate-400">
                      +{items.length - 2}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Légende des statuts (mêmes couleurs/icônes que le pilotage admin). */}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {(
            ["on_time", "late", "missed", "scheduled"] as CalendarStatusVisual[]
          ).map((s) => {
            const meta = CALENDAR_STATUS_META[s];
            return (
              <span
                key={s}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500"
              >
                <meta.Icon className="size-3" />
                {tLabel(meta.labelKey)}
              </span>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
