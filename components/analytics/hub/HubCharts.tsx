"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import {
  conversionLift,
  retentionIntensity,
  type ConversionStat,
  type FunnelStep,
  type RetentionRow,
} from "@/lib/analytics-hub";
import { SampleBadge, dash, factor, pct } from "./HubPrimitives";

/**
 * Rendus partagés du hub : funnel, table de conversion, heatmap de rétention.
 * Tous trois appliquent le MÊME garde-fou : sous le seuil d'effectif, la barre
 * est GRISÉE (elle perd l'accent projet) et un badge « non concluant » apparaît
 * — on n'invite jamais à conclure sur du bruit.
 */

// ─── Funnel ──────────────────────────────────────────────────────────────────

export function FunnelChart({
  steps,
  labels,
}: {
  steps: FunnelStep[];
  labels: Record<string, string>;
}) {
  return (
    <div className="space-y-3">
      {steps.map((s, i) => (
        <div key={s.key} className="space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-slate-700">
              {labels[s.key] ?? s.key}
            </span>
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums text-slate-900">
                {formatNumber(s.count)}
              </span>
              <span className="text-xs tabular-nums text-slate-400">
                {pct(s.shareOfStart)}
              </span>
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                s.conclusive ? "bg-primary" : "bg-slate-300",
              )}
              style={{ width: `${Math.max(0, Math.min(100, s.shareOfStart ?? 0))}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            {i > 0 && s.dropPct !== null ? (
              <span className="text-xs text-red-600">
                −{formatNumber(s.dropPct)} % ({formatNumber(s.droppedCount ?? 0)}{" "}
                perdus)
              </span>
            ) : (
              <span />
            )}
            <SampleBadge n={s.count} conclusive={s.conclusive} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Table de conversion (paywalls, sources, formats, prédicteurs) ───────────

export function ConversionTable({
  rows,
  baseline,
  labelHeader,
  nHeader,
  convertedHeader,
  labels,
  showLift,
}: {
  rows: ConversionStat[];
  /** Taux de référence pour la colonne « facteur » (moyenne globale). */
  baseline?: number | null;
  labelHeader: string;
  nHeader: string;
  convertedHeader: string;
  /** Traduction optionnelle des clés techniques en libellés lisibles. */
  labels?: Record<string, string>;
  showLift?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{labelHeader}</TableHead>
          <TableHead className="text-right">{nHeader}</TableHead>
          <TableHead className="text-right">{convertedHeader}</TableHead>
          <TableHead className="text-right">Taux</TableHead>
          {showLift ? <TableHead className="text-right">vs moyenne</TableHead> : null}
          <TableHead className="text-right">Effectif</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const lift = conversionLift(r.rate, baseline ?? null);
          return (
            <TableRow key={r.key} className={cn(!r.conclusive && "opacity-60")}>
              <TableCell className="font-medium text-slate-700">
                {labels?.[r.key] ?? r.label}
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs">
                {formatNumber(r.n)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs">
                {formatNumber(r.converted)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right text-xs font-semibold tabular-nums",
                  r.conclusive ? "text-slate-900" : "text-slate-400",
                )}
              >
                {pct(r.rate)}
              </TableCell>
              {showLift ? (
                <TableCell
                  className={cn(
                    "text-right text-xs font-medium tabular-nums",
                    lift === null || !r.conclusive
                      ? "text-slate-400"
                      : lift >= 1
                        ? "text-emerald-600"
                        : "text-red-600",
                  )}
                >
                  {factor(lift)}
                </TableCell>
              ) : null}
              <TableCell className="text-right">
                <SampleBadge n={r.n} conclusive={r.conclusive} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ─── Heatmap de rétention ────────────────────────────────────────────────────

export function RetentionHeatmap({
  rows,
  weeks,
}: {
  rows: RetentionRow[];
  weeks: number;
}) {
  const headers = Array.from({ length: weeks }, (_, k) => k);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="w-32 text-left font-medium text-slate-500">Cohorte</th>
            <th className="w-24 text-right font-medium text-slate-500">Taille</th>
            {headers.map((k) => (
              <th key={k} className="w-12 text-center font-medium text-slate-500">
                S+{k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cohort}>
              <td className="whitespace-nowrap font-medium text-slate-700">
                {r.cohort}
              </td>
              <td className="text-right">
                <SampleBadge n={r.size} conclusive={r.conclusive} />
              </td>
              {headers.map((k) => {
                const cell = r.cells[k];
                if (!cell) {
                  // Semaine non encore atteinte : cellule VIDE, jamais un 0.
                  return (
                    <td
                      key={k}
                      className="h-8 rounded bg-slate-50 text-center text-slate-300"
                    >
                      ·
                    </td>
                  );
                }
                const intensity = retentionIntensity(cell.pct);
                return (
                  <td
                    key={k}
                    className="relative h-8 overflow-hidden rounded text-center"
                    title={`${r.cohort} · S+${k} : ${formatNumber(cell.retained)} / ${formatNumber(r.size)}`}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-0",
                        // Une cohorte non concluante perd l'accent projet.
                        r.conclusive ? "bg-primary" : "bg-slate-400",
                      )}
                      style={{ opacity: 0.08 + intensity * 0.85 }}
                    />
                    <span
                      className={cn(
                        "relative font-medium tabular-nums",
                        intensity > 0.55 && r.conclusive
                          ? "text-primary-foreground"
                          : "text-slate-700",
                      )}
                    >
                      {dash(cell.pct, (n) => `${Math.round(n)}`)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
