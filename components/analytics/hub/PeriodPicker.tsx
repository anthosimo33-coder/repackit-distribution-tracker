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
  formatDayShort,
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

/** Le mois précédent — pour ouvrir sur [mois-1, mois courant] et non sur un mois vide. */
function monthBefore(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() - 1, 1, 12);
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
  /**
   * Sélection EN COURS dans le calendrier. Deux clics : le premier pose l'ancre,
   * le second referme la plage — dans n'importe quel ordre chronologique.
   *
   * Pourquoi piloter les clics nous-mêmes plutôt que laisser `mode="range"` s'en
   * charger : avec une plage DÉJÀ complète en `selected`, react-day-picker
   * étend la sélection existante au lieu d'en commencer une nouvelle. Un clic
   * sur un jour au milieu de la plage courante donnait donc une plage inattendue,
   * ou rien. Ici, un clic sur un jour quand la plage est complète repart TOUJOURS
   * de ce jour — c'est ce qu'on attend d'un sélecteur de dates.
   */
  const [anchor, setAnchor] = useState<Date | null>(null);
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
          // À l'ouverture on montre la fenêtre courante, ancre remise à zéro :
          // le prochain clic commence une NOUVELLE plage. À la fermeture sans
          // avoir refermé la plage, rien n'est appliqué — une sélection à moitié
          // faite ne doit pas changer l'écran.
          setAnchor(null);
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
            // Les jours des mois voisins sont MASQUÉS : affichés, le 31 août
            // apparaissait deux fois — dans la grille d'août et dans la première
            // semaine de septembre — et les deux se peignaient en « sélectionné ».
            showOutsideDays={false}
            // Ouvrir sur [mois-1, dernier mois] : avec deux mois affichés et un
            // `endMonth` borné aux données, ancrer sur le dernier mois montrerait
            // une grille vide à droite.
            defaultMonth={range ? monthBefore(dayToDate(range.last)) : undefined}
            selected={draft}
            // `onSelect` est neutralisé : c'est `onDayClick` qui décide (cf `anchor`).
            onSelect={() => {}}
            onDayClick={(d) => {
              // Un jour hors des données ne doit RIEN faire : selon la version,
              // react-day-picker laisse passer le clic sur un jour désactivé.
              const key = dateToDay(d);
              if (range && (key < range.first || key > range.last)) return;
              if (anchor === null) {
                setAnchor(d);
                setDraft({ from: d, to: d });
                return;
              }
              // Deuxième clic : la plage se referme, quel que soit l'ordre des
              // deux dates cliquées.
              const [a, b] = anchor <= d ? [anchor, d] : [d, anchor];
              onChange({ from: dateToDay(a), to: dateToDay(b) });
              setDraft({ from: a, to: b });
              setAnchor(null);
              setOpen(false);
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
            {anchor === null
              ? "Cliquez le premier jour de la période."
              : `Départ le ${formatDayShort(dateToDay(anchor))} — cliquez le dernier jour.`}
            {" · "}
            Données du{" "}
            {range ? formatWindow({ from: range.first, to: range.last }) : "—"}.
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
