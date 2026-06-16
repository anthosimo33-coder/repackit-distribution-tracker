"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { ChartPeriodToggle } from "./ChartPeriodToggle";
import {
  FORMAT_CONFIGS,
  METRIC_COLORS,
  METRIC_LABELS,
  type ChartMetric,
  type FormatKey,
} from "@/lib/format-config";
import {
  getPeriodStart,
  getSinglePublicationTimeseries,
  type ChartMetricKey,
  type Granularity,
  type Period,
} from "@/lib/analytics-stats";
import { cn } from "@/lib/utils";

const ALL_METRICS: readonly ChartMetric[] = [
  "views",
  "likes",
  "saves",
  "subsGained",
  "comments",
];

/** ChartMetric ("views") → clé snapshot ("vues"). Les autres sont identiques. */
function toMetricKey(m: ChartMetric): ChartMetricKey {
  return m === "views" ? "vues" : m;
}

/**
 * Graphe "Évolution" — 2 modes :
 *  - "aggregate" : axe X = date calendaire (capturedAt bucketé), somme de la
 *    métrique cross-publication. Pilote : ChartPeriodToggle (fenêtre) +
 *    granularité. Source : query aggregateTimeseries.
 *  - "single_publication" : axe X = âge (J+X), valeur du snapshot d'UNE
 *    publication. Source : listSnapshotsByPublication.
 *
 * Une seule métrique à la fois (sélecteur), couleur METRIC_COLORS.
 */
export function MetricChart({
  mode,
  publicationId,
  mediaType,
}: {
  mode: "aggregate" | "single_publication";
  publicationId?: Id<"publications">;
  mediaType?: FormatKey;
}) {
  const available = mediaType
    ? FORMAT_CONFIGS[mediaType].availableMetrics
    : ALL_METRICS;
  const [metric, setMetric] = useState<ChartMetric>(available[0]);
  const [period, setPeriod] = useState<Period>("J30");
  const [granularity, setGranularity] = useState<Granularity>("day");
  // `now` figé au mount → args de query stables (sinon refetch en boucle).
  const [now] = useState(() => Date.now());

  const metricKey = toMetricKey(metric);

  const aggregateData = useProjectQuery(
    api.metricSnapshots.aggregateTimeseries,
    mode === "aggregate"
      ? {
          metric: metricKey,
          dateFrom: getPeriodStart(period, now),
          dateTo: now,
          granularity,
          mediaType,
        }
      : "skip",
  );

  const singleSnaps = useProjectQuery(
    api.metricSnapshots.listSnapshotsByPublication,
    mode === "single_publication" && publicationId
      ? { publicationId }
      : "skip",
  );

  const data = useMemo(() => {
    if (mode === "single_publication") {
      if (!singleSnaps) return [];
      return getSinglePublicationTimeseries(singleSnaps, metricKey).map((p) => ({
        x: p.label,
        value: p.value,
      }));
    }
    return (aggregateData ?? []).map((p) => ({ x: p.date, value: p.value }));
  }, [mode, singleSnaps, aggregateData, metricKey]);

  const loading =
    mode === "aggregate"
      ? aggregateData === undefined
      : singleSnaps === undefined;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900">Évolution</h3>
          {mode === "aggregate" && (
            <div className="flex flex-wrap items-center gap-2">
              <ChartPeriodToggle value={period} onChange={setPeriod} />
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
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {available.map((m) => {
            const isOn = m === metric;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  isOn
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                )}
                aria-pressed={isOn}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: METRIC_COLORS[m] }}
                />
                {METRIC_LABELS[m]}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex h-[300px] items-center justify-center rounded-md border border-dashed border-slate-200 text-sm text-slate-400">
            Chargement…
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center rounded-md border border-dashed border-slate-200 text-sm text-slate-400">
            {mode === "single_publication"
              ? "Pas assez de données pour afficher l'évolution."
              : "Aucune donnée sur cette période."}
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
                dataKey="x"
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
              <Line
                type="monotone"
                dataKey="value"
                name={METRIC_LABELS[metric]}
                stroke={METRIC_COLORS[metric]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
