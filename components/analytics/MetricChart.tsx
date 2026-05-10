"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { MetricChipSelector } from "./MetricChipSelector";
import { PeriodToggle } from "./PeriodToggle";
import {
  FORMAT_CONFIGS,
  METRIC_COLORS,
  METRIC_LABELS,
  type ChartMetric,
  type FormatKey,
} from "@/lib/format-config";
import {
  getTimeseries,
  type Granularity,
  type Period,
} from "@/lib/analytics-stats";

type Publication = Doc<"publications">;

/**
 * MetricChart — séries temporelles configurables.
 *
 * State local (pas d'URL params dans ce batch — TD-010 séparé) :
 *  - metrics : Set<ChartMetric>, default = première métrique du
 *    availableMetrics du format.
 *  - period : "J30" par défaut (compromis entre signal et bruit).
 *  - granularity : "day" par défaut.
 *
 * <LineChart> Recharts (vs <BarChart> du dashboard pré-Batch B qui était un
 * bucket-by-dimension). Une <Line> par métrique sélectionnée, couleur tirée
 * de METRIC_COLORS pour cohérence avec MetricChipSelector.
 */
export function MetricChart({
  publications,
  mediaType,
}: {
  publications: Publication[];
  mediaType: FormatKey;
}) {
  const config = FORMAT_CONFIGS[mediaType];
  const [period, setPeriod] = useState<Period>("J30");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [selected, setSelected] = useState<Set<ChartMetric>>(
    () => new Set(config.availableMetrics.slice(0, 1)),
  );

  const data = useMemo(
    () =>
      getTimeseries(publications, {
        period,
        granularity,
        metrics: selected,
      }),
    [publications, period, granularity, selected],
  );

  const orderedMetrics = useMemo(
    () => config.availableMetrics.filter((m) => selected.has(m)),
    [config.availableMetrics, selected],
  );

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900">
            Évolution
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodToggle value={period} onChange={setPeriod} />
            <Select
              value={granularity}
              onValueChange={(v) =>
                v !== null && setGranularity(v as Granularity)
              }
            >
              <SelectTrigger className="h-8 w-[110px] text-xs">
                <SelectValue>
                  {granularity === "day" ? "Jour" : "Semaine"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Jour</SelectItem>
                <SelectItem value="week">Semaine</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <MetricChipSelector
          available={config.availableMetrics}
          selected={selected}
          onChange={setSelected}
        />
        {data.length === 0 || selected.size === 0 ? (
          <div className="flex h-[300px] items-center justify-center rounded-md border border-dashed border-slate-200 text-sm text-slate-400">
            {selected.size === 0
              ? "Sélectionne au moins une métrique."
              : "Aucune publication dans cette période."}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={data}
              margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#e2e8f0"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#475569" }}
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#475569" }}
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
                width={50}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value) =>
                  METRIC_LABELS[value as ChartMetric] ?? value
                }
              />
              {orderedMetrics.map((metric) => (
                <Line
                  key={metric}
                  type="monotone"
                  dataKey={metric}
                  stroke={METRIC_COLORS[metric]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
