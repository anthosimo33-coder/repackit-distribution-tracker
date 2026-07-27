"use client";

import { useMemo } from "react";
import type { Doc } from "@/convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import {
  FORMAT_CONFIGS,
  KPI_LABELS,
  KPI_FORMATTERS,
  type FormatKey,
  type KpiKey,
} from "@/lib/format-config";
import {
  getGlobalStats,
  getGlobalStatsShorts,
  getGlobalStatsScreenRecorder,
} from "@/lib/dashboard-stats";
import { filterByWarmupMode } from "@/lib/warmup-mode";
import { formatNumber, formatPercent } from "@/lib/format";
import { isPublished } from "@/lib/publication-status";
import { calculateSaveRate, calculateVerdict } from "@/lib/verdict";
import type { DisplayMetrics } from "@/convex/metricsDisplay";

type Publication = Doc<"publications"> & { displayMetrics?: DisplayMetrics };

/**
 * KpiGrid — 6 KPI cards configurées par format via FORMAT_CONFIGS.kpiKeys.
 *
 * Calcule les valeurs au mount + à chaque change de publications. Au volume
 * actuel (~10 pubs), agrégation client triviale ; à 5000+ pubs, passer
 * serveur via TD-009.
 */
export function KpiGrid({
  publications,
  mediaType,
}: {
  publications: Publication[];
  mediaType: FormatKey;
}) {
  const config = FORMAT_CONFIGS[mediaType];
  const values = useMemo(
    () => computeKpis(publications, mediaType),
    [publications, mediaType],
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {config.kpiKeys.map((key) => (
        <KpiCard key={key} kpiKey={key} value={values[key]} />
      ))}
    </div>
  );
}

function KpiCard({
  kpiKey,
  value,
}: {
  kpiKey: KpiKey;
  value: number | null;
}) {
  const formatter = KPI_FORMATTERS[kpiKey];
  const display =
    value === null
      ? "—"
      : formatter === "percent"
        ? formatPercent(value)
        : formatNumber(value);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold tabular-nums text-slate-900">
          {display}
        </div>
        <div className="mt-1 text-xs text-slate-500">{KPI_LABELS[kpiKey]}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Mappe les KpiKey configurés vers leur valeur calculée. Les KPIs
 * inapplicables au mediaType retournent null (l'UI affiche "—" pour ces
 * cellules — pas de masquage car FORMAT_CONFIGS prévoit les bonnes clés).
 */
function computeKpis(
  publications: Publication[],
  mediaType: FormatKey,
): Record<KpiKey, number | null> {
  const published = publications.filter(isPublished);
  // TD-019 : publishedCount reste sur TOUS les publiés ; les SOMMES et RATIOS de
  // métriques (y c. le numérateur de l'engagement, aligné sur totalVues déjà
  // filtré par getGlobalStats*) excluent le warmup (helper unique).
  const monetized = filterByWarmupMode(
    published,
    (p) => p.isWarmup === true,
    "exclude",
  );

  // Init avec null partout. Seules les keys présentes dans FORMAT_CONFIGS
  // pour ce mediaType seront effectivement lues, mais le Record TS demande
  // toutes les keys.
  const result: Record<KpiKey, number | null> = {
    publishedCount: published.length,
    vuesTotal: null,
    saveRateAvg: null,
    winners: null,
    savesTotal: null,
    engagementRate: null,
    likesAvg: null,
    subsGainedTotal: null,
    ratioSubsViews: null,
    comments: null,
  };

  if (mediaType === "carousel") {
    const stats = getGlobalStats(published);
    result.vuesTotal = stats.totalVues;
    result.saveRateAvg = stats.avgSaveRate;
    result.winners = stats.winners;
    let savesTotal = 0;
    let likesSum = 0;
    let commentsSum = 0;
    for (const p of monetized) {
      const dmp = p.displayMetrics;
      if (dmp?.saves != null) savesTotal += dmp.saves;
      if (dmp?.likes != null) likesSum += dmp.likes;
      if (dmp?.comments != null) commentsSum += dmp.comments;
    }
    result.savesTotal = savesTotal;
    result.comments = commentsSum;
    // engagement rate = (likes + comments) / vues. Pour les carousels,
    // likes = 0 le plus souvent (pas saisi côté UI carousel) → fallback
    // à comments/vues si likes vide.
    result.engagementRate =
      stats.totalVues > 0
        ? (likesSum + commentsSum) / stats.totalVues
        : null;
  } else {
    const stats =
      mediaType === "short"
        ? getGlobalStatsShorts(published)
        : getGlobalStatsScreenRecorder(published);
    result.vuesTotal = stats.totalVuesJ7;
    result.likesAvg = stats.avgLikes;
    result.subsGainedTotal = stats.totalSubsGained;
    result.ratioSubsViews = stats.ratioSubsViews;
    let commentsSum = 0;
    for (const p of monetized) {
      if (p.displayMetrics?.comments != null) {
        commentsSum += p.displayMetrics.comments;
      }
    }
    result.comments = commentsSum;
  }

  // Recalcul du verdict count pour cohérence (déjà inclus dans
  // getGlobalStats mais isolé ici pour éviter une dépendance forte).
  if (mediaType === "carousel" && result.winners === null) {
    let winners = 0;
    for (const p of monetized) {
      const sr = calculateSaveRate(
        p.displayMetrics?.saves ?? null,
        p.displayMetrics?.vues ?? null,
      );
      if (calculateVerdict(sr) === "WINNER") winners++;
    }
    result.winners = winners;
  }

  return result;
}
