"use client";

import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  formatWindow,
  PRESET_LABELS,
  presetWindow,
  windowLengthDays,
  type AnalyticsWindow,
  type DataRange,
  type WindowPreset,
} from "@/lib/analytics-window";

const PRESETS: WindowPreset[] = ["7d", "14d", "30d", "all"];

/** "YYYY-MM-DD" → Date locale à midi (aucun risque de basculer de jour). */
function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12);
}

/** Date choisie dans le calendrier → clé de jour, sans passer par UTC. */
function dateToDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Sélecteur de PÉRIODE du hub — préréglages + plage libre.
 *
 * Remplace les trois boutons « 7 / 30 / 90 jours », dont deux ne changeaient
 * rien : PostHog ne contient que 46 jours (premier event le 2026-07-23), donc
 * « 90 » ne pouvait pas montrer plus que « 30 ». Le calendrier est BORNÉ à
 * l'étendue réelle des données — on ne propose pas de sélectionner des jours qui
 * n'existent pas, et le libellé sous le sélecteur dit toujours ce qui a été
 * réellement retenu.
 */
export function PeriodPicker({
  window,
  range,
  onChange,
  className,
}: {
  window: AnalyticsWindow | null;
  range: DataRange | null;
  onChange: (w: AnalyticsWindow) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);

  const activePreset =
    range !== null && window !== null
      ? PRESETS.find((p) => {
          const w = presetWindow(p, range);
          return w.from === window.from && w.to === window.to;
        })
      : undefined;

  const days = window === null ? 0 : windowLengthDays(window);

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="mr-1 text-xs font-medium uppercase tracking-wide text-slate-400">
        Période
      </span>

      {PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          disabled={range === null}
          onClick={() => range && onChange(presetWindow(p, range))}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            activePreset === p
              ? "border-primary bg-primary text-primary-foreground"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
          )}
        >
          {p === "all" ? "Tout" : PRESET_LABELS[p].replace(" derniers jours", " j")}
        </button>
      ))}

      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o && window) {
            setDraft({ from: dayToDate(window.from), to: dayToDate(window.to) });
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={range === null}
              className={cn(
                "h-[26px] gap-1.5 px-2.5 text-xs font-medium",
                activePreset === undefined && window !== null
                  ? "border-primary text-primary"
                  : "border-slate-200 text-slate-600",
              )}
            >
              <CalendarIcon className="size-3.5" />
              Dates
            </Button>
          }
        />
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={
              window ? dayToDate(window.from) : range ? dayToDate(range.last) : undefined
            }
            selected={draft}
            onSelect={(r) => {
              setDraft(r);
              // On ne remonte la plage qu'une fois les DEUX bornes posées : un
              // premier clic seul enverrait une fenêtre d'un jour et ferait
              // clignoter tout l'écran entre les deux clics.
              if (r?.from && r?.to) {
                onChange({ from: dateToDay(r.from), to: dateToDay(r.to) });
                setOpen(false);
              }
            }}
            disabled={
              range
                ? [{ before: dayToDate(range.first) }, { after: dayToDate(range.last) }]
                : undefined
            }
            startMonth={range ? dayToDate(range.first) : undefined}
            endMonth={range ? dayToDate(range.last) : undefined}
          />
          <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
            Données disponibles du{" "}
            {range ? formatWindow({ from: range.first, to: range.last }) : "—"}.
            Cliquez le premier puis le dernier jour.
          </p>
        </PopoverContent>
      </Popover>

      <span className="ml-1 text-xs text-slate-500">
        {formatWindow(window)}
        {days > 0 && (
          <span className="text-slate-400">
            {" "}
            · {days} jour{days > 1 ? "s" : ""}
          </span>
        )}
      </span>
    </div>
  );
}
