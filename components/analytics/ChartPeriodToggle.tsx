"use client";

import { cn } from "@/lib/utils";
import type { Period } from "@/lib/analytics-stats";
import { useTranslations } from "next-intl";

const OPTIONS: ReadonlyArray<{ value: Period; days: number | null }> = [
  { value: "J7", days: 7 },
  { value: "J30", days: 30 },
  { value: "J90", days: 90 },
  { value: "All", days: null },
];

/**
 * Fenêtre temporelle de l'axe X du graphe d'évolution (7 derniers jours,
 * 30 jours, …). ⚠️ DIFFÉRENT du SnapshotAgeSelector : ici on borne la plage
 * de dates (capturedAt) affichée ; là-bas on choisit l'âge du snapshot
 * (J+1, J+7…) pour les métriques/verdict. Renommé depuis PeriodToggle pour
 * lever l'ambiguïté.
 */
export function ChartPeriodToggle({
  value,
  onChange,
}: {
  value: Period;
  onChange: (next: Period) => void;
}) {
  const tr = useTranslations("admin.common.ChartPeriodToggle");
  return (
    <div
      className="inline-flex rounded-md border border-slate-200 bg-white p-0.5"
      role="radiogroup"
      aria-label={tr("fenetreDuGraphe")}
    >
      {OPTIONS.map((opt) => (
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
          {opt.days === null ? tr("all") : tr("days", { days: opt.days })}
        </button>
      ))}
    </div>
  );
}
