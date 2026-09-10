"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
// MIME custom pour le drag natif : porte l'index du slot vidéo déplacé.
const DND_MIME = "application/x-video-slot";

/** ms de MINUIT LOCAL du jour choisi — clé de stockage de postDate (jour). */
export function dayStartMs(d: Date): number {
  return startOfDay(d).getTime();
}

/**
 * Calendrier de PLANIFICATION des dates de publication (brique A). Un pool de
 * `count` vignettes « Vidéo N » que l'admin place sur les jours d'un calendrier
 * mensuel — par DRAG natif OU par clic (sélectionner une vignette puis cliquer un
 * jour). Plusieurs vidéos par jour autorisées (elles s'empilent). Une vignette
 * placée se retire (×) pour la replacer. Contrôlé : `dates[i]` = postDate (ms) de
 * la i-ème vidéo, ou null si pas encore placée ; `onChange` remonte le tableau.
 * Pas de lib DnD (drag HTML5 natif) ni de lib calendrier (date-fns + Tailwind).
 */
export function AssignmentPlanningCalendar({
  count,
  dates,
  onChange,
  disabled = false,
}: {
  count: number;
  dates: (number | null)[];
  onChange: (next: (number | null)[]) => void;
  disabled?: boolean;
}) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  // Slot sélectionné pour le placement au CLIC (alternative au drag).
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(currentMonth), {
      weekStartsOn: 1,
    });
    const gridEnd = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  // Slots encore dans le pool (non placés), dans l'ordre.
  const unplaced = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => i).filter((i) => dates[i] == null),
    [count, dates],
  );
  const placedCount = count - unplaced.length;

  function place(slot: number, day: Date) {
    if (disabled) return;
    const next = dates.slice();
    next[slot] = dayStartMs(day);
    onChange(next);
    setSelectedSlot(null);
  }

  function unplace(slot: number) {
    if (disabled) return;
    const next = dates.slice();
    next[slot] = null;
    onChange(next);
  }

  function handleDrop(e: React.DragEvent, day: Date) {
    e.preventDefault();
    setDragOverKey(null);
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    const slot = Number(raw);
    if (Number.isInteger(slot) && slot >= 0 && slot < count) place(slot, day);
  }

  function handleDayClick(day: Date) {
    // Mode clic : un slot est sélectionné → on le place sur ce jour.
    if (selectedSlot !== null) place(selectedSlot, day);
  }

  return (
    <div className="min-w-0 space-y-3">
      {/* Pool des vidéos à placer + progression */}
      <div className="rounded-md border border-slate-200 bg-slate-50/60 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">
            Vidéos à placer
          </span>
          <span
            className={cn(
              "text-xs font-medium",
              placedCount === count ? "text-primary" : "text-slate-500",
            )}
            data-testid="plan-progress"
          >
            {placedCount}/{count} planifiée{count > 1 ? "s" : ""}
          </span>
        </div>
        {unplaced.length === 0 ? (
          <p className="py-1 text-xs text-slate-400">
            Toutes les vidéos sont placées. Glisse-les entre les jours pour
            ajuster, ou clique le × d&apos;une vignette pour la replacer.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {unplaced.map((slot) => (
              <button
                key={slot}
                type="button"
                draggable={!disabled}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_MIME, String(slot));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() =>
                  setSelectedSlot((s) => (s === slot ? null : slot))
                }
                disabled={disabled}
                aria-label={`Vidéo ${slot + 1} à placer`}
                aria-pressed={selectedSlot === slot}
                className={cn(
                  "cursor-grab rounded-full border px-2.5 py-1 text-xs font-medium transition-colors active:cursor-grabbing",
                  selectedSlot === slot
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10",
                )}
              >
                Vidéo {slot + 1}
              </button>
            ))}
          </div>
        )}
        {selectedSlot !== null && (
          <p className="mt-1.5 text-[11px] text-primary">
            Clique un jour pour placer la vidéo {selectedSlot + 1} (ou glisse-la).
          </p>
        )}
      </div>

      {/* Calendrier mensuel */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold capitalize text-slate-900">
          {/* i18n-exempt: « MMMM yyyy » est un MASQUE date-fns, pas du texte — la langue du rendu vient de la locale passée à format(), jamais de cette chaîne. */}
          {format(currentMonth, "MMMM yyyy", { locale: fr })}
        </h3>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Mois précédent"
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            type="button"
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
          const inMonth = isSameMonth(day, currentMonth);
          const today = isToday(day);
          const slotsHere = Array.from({ length: count }, (_, i) => i).filter(
            (i) => dates[i] != null && isSameDay(new Date(dates[i]!), day),
          );
          const isDragOver = dragOverKey === key;
          const clickable = selectedSlot !== null && !disabled;
          return (
            <div
              key={key}
              onClick={() => handleDayClick(day)}
              onDragOver={(e) => {
                if (disabled) return;
                e.preventDefault();
                setDragOverKey(key);
              }}
              onDragLeave={() =>
                setDragOverKey((k) => (k === key ? null : k))
              }
              onDrop={(e) => handleDrop(e, day)}
              // i18n-exempt: « EEEE d MMMM yyyy » est un MASQUE date-fns, pas du texte
              aria-label={format(day, "EEEE d MMMM yyyy", { locale: fr })}
              className={cn(
                "min-h-16 rounded-md border p-1 transition-colors sm:min-h-20",
                inMonth ? "bg-white" : "bg-slate-50/50",
                today ? "border-slate-300" : "border-slate-100",
                isDragOver && "border-primary ring-1 ring-primary",
                clickable && "cursor-pointer hover:border-primary/50",
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
              <div className="flex flex-wrap gap-0.5">
                {slotsHere.map((slot) => (
                  <span
                    key={slot}
                    draggable={!disabled}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_MIME, String(slot));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className="inline-flex cursor-grab items-center gap-0.5 rounded bg-primary px-1 py-0.5 text-[10px] font-medium leading-none text-primary-foreground active:cursor-grabbing"
                  >
                    V{slot + 1}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        unplace(slot);
                      }}
                      disabled={disabled}
                      aria-label={`Retirer la vidéo ${slot + 1}`}
                      className="grid size-3 place-items-center rounded-full hover:bg-white/25"
                    >
                      <XIcon className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
