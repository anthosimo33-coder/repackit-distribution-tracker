"use client";

import { useEffect, useMemo, useState } from "react";
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
import { getMediaType, type MediaType } from "@/lib/media-type";
import { FORMAT_CONFIGS } from "@/lib/format-config";
import { isLate, isPublished } from "@/lib/publication-status";
import { cn } from "@/lib/utils";
import type { PublicationWithImage } from "@/components/PublicationDetailDialog";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

// Identité couleur par format (l'icône reste le marqueur principal). Le statut
// module le rendu : publié = solide, à venir = pâle, en retard = rose pâle.
const FORMAT_BADGE: Record<MediaType, string> = {
  carousel: "border-blue-200 bg-blue-100 text-blue-700",
  short: "border-rose-200 bg-rose-100 text-rose-700",
  screenrecorder: "border-emerald-200 bg-emerald-100 text-emerald-700",
};

/**
 * Calendrier mensuel custom (date-fns + Tailwind, pas de lib lourde). Place
 * chaque publication par datePubli (futures + passées). Navigation mois
 * précédent/suivant (boutons + flèches clavier ←/→). Click sur un badge →
 * onView (ouvre le PublicationDetailDialog porté par CompteDetailView).
 */
export function CompteCalendar({
  publications,
  onView,
}: {
  publications: PublicationWithImage[];
  onView: (p: PublicationWithImage) => void;
}) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(currentMonth), {
      weekStartsOn: 1,
    });
    const gridEnd = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  const byDay = useMemo(() => {
    const map = new Map<string, PublicationWithImage[]>();
    for (const p of publications) {
      const key = format(new Date(p.datePubli), "yyyy-MM-dd");
      const arr = map.get(key);
      if (arr) arr.push(p);
      else map.set(key, [p]);
    }
    return map;
  }, [publications]);

  const monthCount = useMemo(
    () =>
      publications.filter((p) =>
        isSameMonth(new Date(p.datePubli), currentMonth),
      ).length,
    [publications, currentMonth],
  );

  // Navigation clavier ←/→ (alternative aux boutons). Ignorée quand un champ
  // est focus ou qu'un dialog est ouvert, pour ne pas hijacker la saisie.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.getAttribute("contenteditable") === "true")
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "ArrowLeft") setCurrentMonth((m) => subMonths(m, 1));
      else if (e.key === "ArrowRight") setCurrentMonth((m) => addMonths(m, 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
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
            const pubs = byDay.get(key) ?? [];
            const inMonth = isSameMonth(day, currentMonth);
            const today = isToday(day);
            return (
              <div
                key={key}
                className={cn(
                  "min-h-20 rounded-md border border-slate-100 p-1 sm:min-h-24",
                  inMonth ? "bg-white" : "bg-slate-50/50",
                  today && "border-slate-300 bg-slate-50",
                )}
              >
                <div
                  className={cn(
                    "mb-1 text-right text-xs",
                    inMonth ? "text-slate-500" : "text-slate-300",
                    today && "font-bold text-slate-900",
                  )}
                >
                  {format(day, "d")}
                </div>
                <div className="space-y-0.5">
                  {pubs.slice(0, 3).map((p) => (
                    <CalendarBadge key={p._id} pub={p} onView={onView} />
                  ))}
                  {pubs.length > 3 && (
                    <div className="px-1 text-[10px] font-medium text-slate-400">
                      +{pubs.length - 3}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-slate-400">
          {monthCount} publication{monthCount > 1 ? "s" : ""} ce mois-ci
        </p>
      </CardContent>
    </Card>
  );
}

function CalendarBadge({
  pub,
  onView,
}: {
  pub: PublicationWithImage;
  onView: (p: PublicationWithImage) => void;
}) {
  const mediaType = getMediaType(pub);
  const Icon = FORMAT_CONFIGS[mediaType].icon;
  const published = isPublished(pub);
  const late = isLate(pub);
  const label = pub.titre?.trim() || pub.hookText || pub.carouselId;
  const time = format(new Date(pub.datePubli), "HH:mm");

  return (
    <button
      type="button"
      onClick={() => onView(pub)}
      title={`${label} · ${time} · ${pub.plateforme}${
        late ? " · En retard" : ""
      }`}
      className={cn(
        "flex w-full items-center gap-1 rounded border px-1 py-0.5 text-left text-[10px] font-medium leading-tight transition-opacity hover:opacity-80",
        late
          ? "border-rose-300 bg-rose-50 text-rose-700"
          : published
            ? FORMAT_BADGE[mediaType]
            : cn(FORMAT_BADGE[mediaType], "opacity-50"),
      )}
    >
      <Icon className="size-3 shrink-0" />
      <span className="hidden truncate sm:inline">
        {late ? "En retard" : pub.carouselId}
      </span>
    </button>
  );
}
