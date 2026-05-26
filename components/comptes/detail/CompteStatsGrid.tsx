"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { getMediaType } from "@/lib/media-type";
import { FORMAT_CONFIGS, type FormatKey } from "@/lib/format-config";
import type { PublicationWithImage } from "@/components/PublicationDetailDialog";

const FORMAT_ORDER: FormatKey[] = ["carousel", "short", "screenrecorder"];

/**
 * 4 KPI cross-format pour un compte. Pilotées par la période globale via les
 * displayMetrics déjà résolus serveur (les Vues/Likes suivent le
 * SnapshotAgeSelector du header). Total = nombre de rows (cohérent avec le
 * mental model du tracker : 1 row = 1 plateforme).
 */
export function CompteStatsGrid({
  publications,
}: {
  publications: PublicationWithImage[];
}) {
  const stats = useMemo(() => {
    const byFormat: Record<FormatKey, number> = {
      carousel: 0,
      short: 0,
      screenrecorder: 0,
    };
    let vues = 0;
    let likes = 0;
    for (const p of publications) {
      byFormat[getMediaType(p) as FormatKey] += 1;
      vues += p.displayMetrics?.vues ?? 0;
      likes += p.displayMetrics?.likes ?? 0;
    }
    return { total: publications.length, byFormat, vues, likes };
  }, [publications]);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="Publications" value={formatNumber(stats.total)} />

      <Card>
        <CardContent className="p-4">
          <div className="space-y-1">
            {FORMAT_ORDER.map((key) => (
              <div
                key={key}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="text-slate-500">
                  {FORMAT_CONFIGS[key].plural}
                </span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {stats.byFormat[key]}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-500">Détail par format</div>
        </CardContent>
      </Card>

      <StatCard label="Vues totales" value={formatNumber(stats.vues)} />
      <StatCard label="Likes totaux" value={formatNumber(stats.likes)} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold tabular-nums text-slate-900">
          {value}
        </div>
        <div className="mt-1 text-xs text-slate-500">{label}</div>
      </CardContent>
    </Card>
  );
}
