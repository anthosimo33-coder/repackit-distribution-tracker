"use client";

import {
  METRIC_COLORS,
  METRIC_LABELS,
  type ChartMetric,
} from "@/lib/format-config";
import { cn } from "@/lib/utils";

/**
 * Chips multi-select pour choisir les métriques visibles dans MetricChart.
 *
 * Chaque chip est colorée selon la palette de la métrique (cohérente avec
 * MetricChart). Click toggle l'état dans le Set passé en prop. Pas de
 * shadcn Toggle (non installé) ni de wrap base-ui — un simple <button>
 * stylé suffit pour ce contrôle léger.
 */
export function MetricChipSelector({
  available,
  selected,
  onChange,
}: {
  available: readonly ChartMetric[];
  selected: Set<ChartMetric>;
  onChange: (next: Set<ChartMetric>) => void;
}) {
  function toggle(metric: ChartMetric) {
    const next = new Set(selected);
    if (next.has(metric)) next.delete(metric);
    else next.add(metric);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {available.map((metric) => {
        const isOn = selected.has(metric);
        const color = METRIC_COLORS[metric];
        return (
          <button
            key={metric}
            type="button"
            onClick={() => toggle(metric)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              isOn
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
            aria-pressed={isOn}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            {METRIC_LABELS[metric]}
          </button>
        );
      })}
    </div>
  );
}
