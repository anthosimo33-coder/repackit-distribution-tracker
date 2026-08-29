"use client";

import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { portalHref } from "@/lib/view-as";
import { Badge } from "@/components/ui/badge";
import { ArrowRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ASSIGNMENT_STATUS,
  assignmentUrgency,
  URGENCY_BADGE,
  type AssignmentStatus,
} from "@/lib/assignment-status";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useLabel } from "@/lib/use-label";

/**
 * LIGNE DE MISSION — l'unique rendu d'une mission dans une liste du portail.
 *
 * EXTRAITE de DashboardScreen sans changement de balisage : le dashboard et
 * l'écran « Mes missions » montrent LA MÊME chose, et deux copies auraient fini
 * par diverger sur l'urgence ou le badge de statut — c'est-à-dire exactement sur
 * ce qui dit à la créatrice quoi faire en premier. Toute évolution ici touche les
 * deux surfaces, ce qui est le but.
 *
 * Le lien pointe vers la fiche détail, dans le portail créateur (/app/…) comme en
 * mode admin « voir l'espace » (la fiche existe des deux côtés, en lecture seule
 * côté admin) : `base` vient de usePortalBase().
 */
export type CreatorAssignment = FunctionReturnType<
  typeof api.assignments.listMyAssignments
>[number];

const TYPE_LABELS: Record<string, string> = {
  carousel: "Carrousel",
  short: "Short",
  screenrecorder: "ScreenRecorder",
  custom: "Custom",
};

export function formatMissionDate(ts: number, locale: string) {
  return new Date(ts).toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
  });
}

export function MissionListItem({
  assignment: a,
  base,
  showFeedback,
  managed,
}: {
  assignment: CreatorAssignment;
  base: string;
  showFeedback?: boolean;
  /** Comptes gérés : pas d'urgence, badge « géré par l'équipe » au lieu du statut. */
  managed?: boolean;
}) {
  const tLabel = useLabel();
  const loc = useIntlLocale();
  const t = useTranslations("portal");
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
            <span className="text-slate-500">
              {t("dashboard.dueOn", { date: formatMissionDate(a.dueDate, loc) })}
            </span>
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
              {tLabel(URGENCY_BADGE[urg].labelKey)}
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
            {managed ? t("dashboard.managedBadge") : tLabel(st.labelKey)}
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

  return (
    <Link
      href={portalHref(base, `/assignments/${a._id}`)}
      className="block rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      {inner}
    </Link>
  );
}
