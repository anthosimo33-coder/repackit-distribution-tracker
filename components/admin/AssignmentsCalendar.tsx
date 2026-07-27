"use client";

import { useMemo, useState } from "react";
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
import { Card, CardContent } from "@/components/ui/card";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { calendarStatus, type CalendarStatus } from "@/lib/calendar-status";
import { CALENDAR_STATUS_META } from "@/components/calendar/calendar-status-meta";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** Ligne d'assignment minimale attendue par le calendrier (sous-ensemble du
 *  retour listAssignments — passer la row complète est compatible). */
export type CalendarAssignmentRow = {
  _id: Id<"assignments">;
  creatorId: string;
  creatorName: string;
  formatName: string | null;
  scriptCampaignName?: string | null;
  postDate?: number;
  postedAt: number | null;
};

// Pastille d'IDENTITÉ créatrice (couleur stable par créateur, ≠ statut).
const CREATOR_DOTS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-lime-600",
];
function creatorDot(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CREATOR_DOTS[h % CREATOR_DOTS.length];
}

const ON_TIME_THRESHOLD = 0.8; // sous ce taux → alerte visuelle.

function rowLabel(r: CalendarAssignmentRow): string {
  return r.scriptCampaignName ?? r.formatName ?? "—";
}

/**
 * Vue CALENDRIER de pilotage (brique C), fusionnée dans la page Assignments. Place
 * chaque assignment AYANT une date de post (postDate) sur son jour ; le badge
 * montre la créatrice (pastille couleur), le format/campagne, et le STATUT
 * calendrier (couleur + icône : à l'heure vert / en retard ambre / manqué rouge /
 * prévu gris). Le jour courant est mis en évidence. Stats en tête recalculées sur
 * les rows FILTRÉES (mêmes filtres que la liste). Clic sur un post → onOpen.
 */
export function AssignmentsCalendar({
  rows,
  now,
  onOpen,
}: {
  rows: CalendarAssignmentRow[];
  now: number;
  onOpen: (id: Id<"assignments">) => void;
}) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date(now));

  // Rows planifiées (avec date de post) + leur statut calendrier.
  const planned = useMemo(
    () =>
      rows
        .filter((r) => r.postDate != null)
        .map((r) => ({
          row: r,
          status: calendarStatus({
            postDate: r.postDate,
            postedAt: r.postedAt,
            now,
          }) as Exclude<CalendarStatus, "none">,
        })),
    [rows, now],
  );

  const stats = useMemo(() => {
    let onTime = 0;
    let late = 0;
    let missed = 0;
    let scheduled = 0;
    for (const { status } of planned) {
      if (status === "on_time") onTime++;
      else if (status === "late") late++;
      else if (status === "missed") missed++;
      else scheduled++;
    }
    const past = onTime + late + missed;
    return {
      onTime,
      late,
      missed,
      scheduled,
      past,
      rate: past > 0 ? onTime / past : null,
    };
  }, [planned]);

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

  const rateAlert = stats.rate != null && stats.rate < ON_TIME_THRESHOLD;

  return (
    <div className="space-y-4">
      {/* Stats de pilotage — recalculées selon les filtres partagés. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card
          className={cn(
            rateAlert && "border-rose-300",
            stats.rate != null && !rateAlert && "border-emerald-300",
          )}
        >
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500">
              Taux à l&apos;heure
            </div>
            <div
              className={cn(
                "mt-1 text-2xl font-semibold",
                stats.rate == null
                  ? "text-slate-400"
                  : rateAlert
                    ? "text-rose-600"
                    : "text-emerald-600",
              )}
            >
              {stats.rate == null
                ? "—"
                : `${Math.round(stats.rate * 100)}%`}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {stats.onTime}/{stats.past} post{stats.past > 1 ? "s" : ""} passé
              {stats.past > 1 ? "s" : ""}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500">À l&apos;heure</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-600">
              {stats.onTime}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500">
              En retard + manqués
            </div>
            <div className="mt-1 text-2xl font-semibold text-rose-600">
              {stats.late + stats.missed}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {stats.late} en retard · {stats.missed} manqué
              {stats.missed > 1 ? "s" : ""}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500">À venir</div>
            <div className="mt-1 text-2xl font-semibold text-slate-700">
              {stats.scheduled}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grille mensuelle */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold capitalize text-slate-900">
              {format(currentMonth, "MMMM yyyy", { locale: fr })}
            </h2>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Mois précédent"
                onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Mois suivant"
                onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          </div>

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
                    "min-h-24 rounded-md border p-1",
                    inMonth ? "bg-white" : "bg-slate-50/50",
                    today ? "border-primary ring-1 ring-primary" : "border-slate-100",
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
                  {/* Vue de pilotage : on affiche TOUS les posts du jour (pas de
                      « +N » tronqué). La case grandit avec son contenu ; un jour
                      très chargé scrolle en interne au-delà d'un plafond confortable
                      (~10 posts) plutôt que d'étirer sans fin la ligne de semaine. */}
                  <div className="max-h-64 space-y-0.5 overflow-y-auto">
                    {items.map(({ row, status }) => {
                      const meta = CALENDAR_STATUS_META[status];
                      return (
                        <button
                          key={row._id}
                          type="button"
                          onClick={() => onOpen(row._id)}
                          title={`${row.creatorName} · ${rowLabel(row)} · ${meta.label}`}
                          className={cn(
                            "flex w-full items-center gap-1 rounded border px-1 py-0.5 text-left text-[10px] font-medium leading-tight transition-colors",
                            meta.chip,
                          )}
                        >
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              creatorDot(row.creatorId),
                            )}
                            aria-hidden
                          />
                          <meta.Icon className="size-3 shrink-0" />
                          <span className="truncate">{row.creatorName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-slate-400">
            {planned.length} post{planned.length > 1 ? "s" : ""} planifié
            {planned.length > 1 ? "s" : ""} (filtres appliqués). Les assignments
            sans date de publication n&apos;apparaissent pas.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
