"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlatformBadge } from "@/components/VerdictBadge";
import { getTopHooks, getTopHooksShorts } from "@/lib/dashboard-stats";
import { formatNumber, formatPercent } from "@/lib/format";
import { isPublished } from "@/lib/publication-status";
import { getMediaType } from "@/lib/media-type";
import {
  useSnapshotAge,
  snapshotQueryArgs,
} from "@/components/snapshot-age-selector/SnapshotAgeContext";
import { SnapshotAgeSelector } from "@/components/snapshot-age-selector/SnapshotAgeSelector";
import { cn } from "@/lib/utils";
import { FileTextIcon } from "lucide-react";

type Publications = FunctionReturnType<
  typeof api.publications.listPublications
>;
type Kpis = FunctionReturnType<typeof api.dashboard.dashboardKpis>;

/**
 * Dashboard cross-format. KPIs calculés serveur (dashboardKpis) selon la
 * période d'âge globale (SnapshotAgeSelector). Top hooks re-triés selon le
 * snapshot affiché (getTopHooks lit displayMetrics).
 */
export default function DashboardPage() {
  const { age, customDay } = useSnapshotAge();
  const args = snapshotQueryArgs({ age, customDay });
  const publications = useQuery(api.publications.listPublications, args);
  const kpis = useQuery(api.dashboard.dashboardKpis, args);

  const today = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Dashboard
          </h1>
          <p className="text-sm text-slate-500">
            {today} — vue d&apos;ensemble cross-format
          </p>
        </div>
        <SnapshotAgeSelector />
      </header>

      {publications === undefined || kpis === undefined ? (
        <LoadingState />
      ) : publications.length === 0 ? (
        <EmptyState />
      ) : (
        <DashboardContent publications={publications} kpis={kpis} />
      )}
    </div>
  );
}

function DashboardContent({
  publications,
  kpis,
}: {
  publications: Publications;
  kpis: Kpis;
}) {
  const publishedAll = publications.filter(isPublished);
  const carouselPubs = publishedAll.filter(
    (p) => getMediaType(p) === "carousel",
  );
  const shortPubs = publishedAll.filter((p) => getMediaType(p) === "short");
  const srPubs = publishedAll.filter(
    (p) => getMediaType(p) === "screenrecorder",
  );
  const videoCount = shortPubs.length + srPubs.length;

  type TopRow = {
    hookText: string;
    carouselId: string;
    plateforme: string;
    vues: number;
    mediaType: "carousel" | "short" | "screenrecorder";
  };
  const carouselTop: TopRow[] = getTopHooks(carouselPubs, 10).map((h) => ({
    hookText: h.hookText,
    carouselId: h.carouselId,
    plateforme: h.plateforme,
    vues: h.vues,
    mediaType: "carousel",
  }));
  const shortTop: TopRow[] = getTopHooksShorts(shortPubs, 10).map((h) => ({
    hookText: h.hookText,
    carouselId: h.carouselId,
    plateforme: h.plateforme,
    vues: h.vues,
    mediaType: "short",
  }));
  const srTop: TopRow[] = getTopHooksShorts(srPubs, 10).map((h) => ({
    hookText: h.hookText,
    carouselId: h.carouselId,
    plateforme: h.plateforme,
    vues: h.vues,
    mediaType: "screenrecorder",
  }));
  const topMix = [...carouselTop, ...shortTop, ...srTop]
    .sort((a, b) => b.vues - a.vues)
    .slice(0, 3);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Publiés"
          value={String(kpis.totalPublished)}
          secondary={
            kpis.totalDrafts > 0 ? `+${kpis.totalDrafts} à venir` : undefined
          }
        />
        <KpiCard label="Vues totales" value={formatNumber(kpis.vuesTotal)} />
        <KpiCard
          label="Save rate moyen"
          value={
            carouselPubs.length === 0 ? "—" : formatPercent(kpis.saveRateAvg)
          }
          secondary={
            carouselPubs.length === 0 ? undefined : "Carrousels uniquement"
          }
        />
        <KpiCard
          label="Winners"
          value={carouselPubs.length === 0 ? "—" : String(kpis.winnersCount)}
          secondary={
            carouselPubs.length === 0 ? undefined : "Carrousels uniquement"
          }
          highlight={kpis.winnersCount > 0}
        />
        <KpiCard
          label="Subs gagnés"
          value={videoCount === 0 ? "—" : formatNumber(kpis.subsGainedTotal)}
          secondary={videoCount === 0 ? undefined : "Shorts + SR"}
          highlight={videoCount > 0 && kpis.subsGainedTotal > 0}
        />
        <KpiCard
          label="Engagement rate"
          value={formatPercent(kpis.engagementRate, 2)}
          secondary="(likes + comments) / vues"
        />
      </div>

      {topMix.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top {topMix.length} hooks performers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Hook</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead className="font-mono">Carousel</TableHead>
                    <TableHead>Plateforme</TableHead>
                    <TableHead className="text-right">Vues</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topMix.map((h, i) => (
                    <TableRow key={`${h.carouselId}-${h.plateforme}`}>
                      <TableCell className="font-mono text-xs text-slate-500">
                        #{i + 1}
                      </TableCell>
                      <TableCell
                        className="max-w-[360px] truncate text-sm"
                        title={h.hookText}
                      >
                        {h.hookText.length > 60
                          ? h.hookText.slice(0, 60) + "…"
                          : h.hookText}
                      </TableCell>
                      <TableCell className="text-xs">
                        {h.mediaType === "carousel"
                          ? "Carrousel"
                          : h.mediaType === "screenrecorder"
                            ? "ScreenRecorder"
                            : "Short"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {h.carouselId}
                      </TableCell>
                      <TableCell>
                        <PlatformBadge plateforme={h.plateforme} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {formatNumber(h.vues)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function KpiCard({
  label,
  value,
  highlight,
  secondary,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  secondary?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-baseline gap-2">
          <div
            className={cn(
              "text-3xl font-bold tabular-nums",
              highlight ? "text-emerald-600" : "text-slate-900",
            )}
          >
            {value}
          </div>
        </div>
        <div className="mt-1 text-sm text-slate-500">{label}</div>
        {secondary && (
          <div className="mt-0.5 text-xs text-slate-400">{secondary}</div>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <FileTextIcon className="size-10 text-slate-400" />
        <div>
          <h2 className="text-lg font-medium text-slate-900">
            Aucune publication pour l&apos;instant
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Crée ta première publication pour faire apparaître les KPIs.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
