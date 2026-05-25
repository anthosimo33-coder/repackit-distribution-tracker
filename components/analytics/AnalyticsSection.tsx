"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { KpiGrid } from "./KpiGrid";
import { MetricChart } from "./MetricChart";
import { TopHooksTable } from "./TopHooksTable";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  RECORDING_DEVICE_ICONS,
  RECORDING_DEVICE_LABELS,
  type FormatKey,
  type RecordingDevice,
} from "@/lib/format-config";
import {
  aggregateByIcp,
  aggregateByRecordingDevice,
  aggregateByRepackaging,
  type AggregateRowShort,
} from "@/lib/dashboard-stats";
import { getFolderColor } from "@/lib/folder-colors";
import { cn } from "@/lib/utils";
import { formatNumber, formatPercent } from "@/lib/format";

type Publication = Doc<"publications">;

/**
 * AnalyticsSection — bloc analytics rendu en bas des pages format.
 *
 * Layout : KpiGrid (6 cards) + MetricChart (chart configurable) +
 * TopHooksTable (10 rows). Pas filtrée par les filtres internes du
 * TrackerListSection — vue globale du format pour permettre le pilotage
 * stratégique. Si l'utilisateur veut zoomer, il a la liste filtrable
 * au-dessus pour ça.
 *
 * Refinement SR — pour mediaType=screenrecorder, le TopHooksTable est
 * remplacé par 2 tables compactes spécifiques SR : Performances par
 * Appareil (Phone/Desktop) + Performances par Type (Repack/Autre). Le
 * concept "top hooks" n'est pas pertinent pour SR (étape Hook skip dans
 * modal nouveau). La matrice 2x2 combinatoire (Phone+Repack /
 * Phone+Autre / Desktop+Repack / Desktop+Autre) est différée — TD-013.
 */
export function AnalyticsSection({
  publications,
  mediaType,
}: {
  publications: Publication[];
  mediaType: FormatKey;
}) {
  const isSR = mediaType === "screenrecorder";
  const isShort = mediaType === "short";
  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold text-slate-900">Analytics</h2>
      <KpiGrid publications={publications} mediaType={mediaType} />
      <MetricChart publications={publications} mediaType={mediaType} />
      {isSR ? (
        <ScreenRecorderAnalytics publications={publications} />
      ) : isShort ? (
        // Refinement Shorts — TopHooks (simplifié, sans mécanique/niveau via
        // TopHooksTable mediaType=short) + table Performance par ICP.
        <>
          <TopHooksTable publications={publications} mediaType={mediaType} />
          <IcpAnalytics publications={publications} />
        </>
      ) : (
        <TopHooksTable publications={publications} mediaType={mediaType} />
      )}
    </section>
  );
}

/**
 * Refinement Shorts — Performance par ICP. Réutilise SimpleDimensionTable
 * (cohérent avec les tables SR). La clé de chaque row est l'icpId, résolu
 * en nom + couleur via listIcps. Les Shorts sans ICP sont exclus en amont
 * (aggregateByIcp).
 */
function IcpAnalytics({ publications }: { publications: Publication[] }) {
  const icps = useQuery(api.icps.listIcps, {});
  const rows = aggregateByIcp(publications);
  const icpMap = new Map(
    (icps ?? []).map((i) => [i._id as string, i] as const),
  );
  return (
    <SimpleDimensionTable
      title="Performance par ICP"
      rows={rows}
      renderKey={(key) => {
        const icp = icpMap.get(key);
        if (!icp) {
          return <span className="text-slate-400">ICP supprimé</span>;
        }
        const color = getFolderColor(icp.color);
        return (
          <Badge variant="outline" className="gap-1.5 text-slate-700">
            <span className={cn("size-2 rounded-full", color.dotClass)} />
            {icp.nom}
          </Badge>
        );
      }}
      emptyLabel="Aucun Short avec ICP assigné."
    />
  );
}

function ScreenRecorderAnalytics({
  publications,
}: {
  publications: Publication[];
}) {
  const byDevice = aggregateByRecordingDevice(publications);
  const byType = aggregateByRepackaging(publications);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SimpleDimensionTable
        title="Performances par Appareil"
        rows={byDevice}
        renderKey={(key) => {
          const device = key as RecordingDevice;
          const Icon = RECORDING_DEVICE_ICONS[device];
          return (
            <Badge variant="outline" className="gap-1 text-slate-700">
              <Icon className="size-3" />
              {RECORDING_DEVICE_LABELS[device]}
            </Badge>
          );
        }}
        emptyLabel="Aucun SR avec appareil renseigné."
      />
      <SimpleDimensionTable
        title="Performances par Type"
        rows={byType}
        renderKey={(key) =>
          key === "Repackaging" ? (
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
              Repackaging
            </Badge>
          ) : (
            <Badge variant="outline" className="text-slate-600">
              Autre capture
            </Badge>
          )
        }
        emptyLabel="Aucun SR avec type renseigné."
      />
    </div>
  );
}

function SimpleDimensionTable({
  title,
  rows,
  renderKey,
  emptyLabel,
}: {
  title: string;
  rows: AggregateRowShort[];
  renderKey: (key: string) => React.ReactNode;
  emptyLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            {emptyLabel}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Catégorie</TableHead>
                <TableHead className="text-right">Pubs</TableHead>
                <TableHead className="text-right">Vues</TableHead>
                <TableHead className="text-right">Likes</TableHead>
                <TableHead className="text-right">Subs</TableHead>
                <TableHead className="text-right">Ratio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>{renderKey(r.key)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {r.count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {formatNumber(r.totalVues)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {formatNumber(r.totalLikes)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {formatNumber(r.totalSubsGained)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs font-medium">
                    {formatPercent(r.avgRatioSubsViews, 2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
