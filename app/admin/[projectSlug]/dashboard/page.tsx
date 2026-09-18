"use client";

import { useState } from "react";
import { ActionDashboard } from "@/components/admin/ActionDashboard";
import { YouTubeSyncButton } from "@/components/admin/YouTubeSyncButton";
import { ApifySyncButton } from "@/components/admin/ApifySyncButton";
import {
  TrackerDataView,
  useTrackerFilterState,
} from "@/components/tracker/TrackerDataView";
import { TrackerShareMode } from "@/components/share/TrackerShareMode";
import { usePermissions } from "@/components/project/use-permissions";
import { Button } from "@/components/ui/button";
import { Share2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";

type DashboardView = "action" | "tracker";

/**
 * Dashboard d'accueil admin. Deux vues basculables :
 *  - "action" (par DÉFAUT) : ce qui demande l'attention (validations, warmups
 *    en retard, paie due, deadlines) + worklist + activité créateurs. INCHANGÉE.
 *  - "tracker" : data des posts publiés — filtres libres (dates Du/Au +
 *    créateur/compte/plateforme/format/campagne) pilotant stats globales + liste
 *    détaillée + charts (cf TrackerDataView). Remplace l'ancienne vue figée
 *    (sélecteur J+N + cartes héritées).
 */
export default function DashboardPage() {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.dashboard.DashboardPage");
  const [view, setView] = useState<DashboardView>("action");
  // Mode partage : le Tracker cède la place à son aperçu public (cf
  // TrackerShareMode). Réservé au bloc `content.share`.
  const [sharing, setSharing] = useState(false);
  // Filtres du Tracker tenus ICI : ils survivent au mode partage, qui les
  // reprend comme point de départ.
  const trackerFilters = useTrackerFilterState();
  const droits = usePermissions();
  const canShare = droits.has("content.share");

  const today = new Date().toLocaleDateString(loc, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {view === "action" ? tr("bonjour") : tr("vueTracker")}
          </h1>
          <p className="text-sm text-slate-500">
            {view === "action"
              ? tr("voiciCeQuiDemandeTon")
              : tr("dataDesPostsPublies", { today: today })}
          </p>
        </div>
        {!sharing && (
          <div className="flex items-center gap-3">
            {view === "tracker" && <YouTubeSyncButton />}
            {view === "tracker" && <ApifySyncButton />}
            {view === "tracker" && canShare && (
              <Button size="sm" onClick={() => setSharing(true)}>
                <Share2Icon className="size-4" aria-hidden />
                {tr("partager")}
              </Button>
            )}
            <ViewToggle value={view} onChange={setView} />
          </div>
        )}
      </header>

      {view === "action" ? (
        <ActionDashboard />
      ) : sharing ? (
        <TrackerShareMode
          initialFilters={trackerFilters}
          onExit={() => setSharing(false)}
        />
      ) : (
        <TrackerDataView filters={trackerFilters} />
      )}
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: DashboardView;
  onChange: (v: DashboardView) => void;
}) {
  const tr = useTranslations("admin.dashboard.ViewToggle");
  const options: { value: DashboardView; label: string }[] = [
    { value: "action", label: tr("action") },
    { value: "tracker", label: tr("tracker") },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={tr("vueDuDashboard")}
      className="inline-flex rounded-md border border-slate-200 bg-white p-0.5"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded px-3 py-1 text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
