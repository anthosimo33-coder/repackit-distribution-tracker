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
 * Toggle button group pour choisir la période d'agrégation du chart.
 * Bouton simple stylé : pas de shadcn ToggleGroup (non installé), pas
 * besoin de la complexité d'un base-ui Tabs pour ce contrôle de 4
 * options exclusives.
 */
export function PeriodToggle({
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
      aria-label="Période"
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
