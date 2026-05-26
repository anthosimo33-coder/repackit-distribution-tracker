"use client";

import { cn } from "@/lib/utils";
import type { Period } from "@/lib/analytics-stats";

const OPTIONS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: "J7", label: "7j" },
  { value: "J30", label: "30j" },
  { value: "J90", label: "90j" },
  { value: "All", label: "Tous" },
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
  return (
    <div
      className="inline-flex rounded-md border border-slate-200 bg-white p-0.5"
      role="radiogroup"
      aria-label="Fenêtre du graphe"
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
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
