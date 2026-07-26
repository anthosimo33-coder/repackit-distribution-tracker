import {
  AlertCircleIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ClockIcon,
  type LucideIcon,
} from "lucide-react";
import type { CalendarStatus } from "@/lib/calendar-status";

export type CalendarStatusVisual = Exclude<CalendarStatus, "none">;

/**
 * Rendu PARTAGÉ du statut calendrier (couleur + icône + libellé). Source UNIQUE
 * utilisée côté pilotage admin (AssignmentsCalendar) ET côté créatrice
 * (CreatorPublicationCalendar / TodayPostBanner) → la créatrice voit EXACTEMENT
 * les mêmes statuts que l'admin. `chip` = classes d'un badge cliquable.
 */
export const CALENDAR_STATUS_META: Record<
  CalendarStatusVisual,
  { chip: string; Icon: LucideIcon; label: string }
> = {
  on_time: {
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    Icon: CheckCircle2Icon,
    label: "À l'heure",
  },
  late: {
    chip: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
    Icon: ClockIcon,
    label: "En retard",
  },
  missed: {
    chip: "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100",
    Icon: AlertCircleIcon,
    label: "Manqué",
  },
  scheduled: {
    chip: "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
    Icon: CalendarClockIcon,
    label: "Prévu",
  },
};
