"use client";

import { Suspense } from "react";
import { useQuery } from "convex/react";
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
import {
  getGlobalStats,
  getGlobalStatsShorts,
  getTopHooks,
  getTopHooksShorts,
} from "@/lib/dashboard-stats";
import { formatNumber, formatPercent } from "@/lib/format";
import { isPublished } from "@/lib/publication-status";
import { getMediaType } from "@/lib/media-type";
import { cn } from "@/lib/utils";
import { FileTextIcon } from "lucide-react";


/**
 * Dashboard cross-format (Batch B).
 *
 * Vue cumulée stricte sans Tabs mediaType. Les onglets Carrousels / Shorts
 * du commit 87223ad disparaissent — chaque format a désormais sa propre
 * page (/carrousels, /shorts) avec ses analytics propres.
 *
 * KPIs : 5 chiffres cross-format + section Top 3 hooks performers (mix des
 * deux formats, tri par vuesJ7 desc). DimensionChart et chart configurable
 * sont différés au Batch E.
 */
export default function DashboardPage() {
  const publications = useQuery(api.publications.listPublications);
  if (publications === undefined) return <LoadingState />;

  const today = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Dashboard
        </h1>
        <p className="text-sm text-slate-500">
          {today} — vue d&apos;ensemble cross-format
        </p>
      </header>

      {publications.length === 0 ? (
        <EmptyState />
      ) : (
        // useSearchParams suspendu jusqu'à hydratation.
        <Suspense fallback={null}>
          <DashboardContent publications={publications} />
        </Suspense>
      )}
    </div>
  );
}

function DashboardContent({
  publications,
}: {
  publications: NonNullable<
    ReturnType<typeof useQuery<typeof api.publications.listPublications>>
  >;
}) {
  // Batch E — filtre mécanique top-level retiré (cf cleanup dashboard).
  // Si on veut filtrer, on va sur la page format dédiée qui a son propre
  // FilterMultiSelect "Mécanique" interne.
  const publishedAll = publications.filter(isPublished);
  const filteredPublications = publications;
  const carouselPubs = publishedAll.filter(
    (p) => getMediaType(p) === "carousel",
  );
  const shortPubs = publishedAll.filter((p) => getMediaType(p) === "short");
  // Batch D — ScreenRecorder partage le shape métriques de Short
  // (likes/subsGained/comments) → mêmes helpers stats côté pages format.
  // Ici on ne distingue pas, on agrège tout via les helpers Shorts.
  const screenRecorderPubs = publishedAll.filter(
    (p) => getMediaType(p) === "screenrecorder",
  );

  // KPIs cross-format dérivés des helpers existants pour cohérence avec les
  // pages format (pas de re-calcul ad-hoc qui pourrait dériver des stats par
  // format). Save rate carousel-only ; Subs short + screenrecorder.
  const carouselStats = getGlobalStats(carouselPubs);
  const shortsStats = getGlobalStatsShorts(shortPubs);
  const screenRecorderStats = getGlobalStatsShorts(screenRecorderPubs);

  const totalPublished =
    carouselStats.total + shortsStats.total + screenRecorderStats.total;
  const totalDrafts = filteredPublications.length - totalPublished;
  const totalVues =
    carouselStats.totalVues +
    shortsStats.totalVuesJ7 +
    screenRecorderStats.totalVuesJ7;
  const totalSubsGained =
    shortsStats.totalSubsGained + screenRecorderStats.totalSubsGained;

  // Engagement rate cross-format : (likes + comments) / vues, agrégé sum.
  // Likes et subsGained existent uniquement sur les Shorts (carousel n'a
  // pas de likes saisis). Comments présents sur tous formats.
  let totalLikes = 0;
  let totalComments = 0;
  for (const p of publishedAll) {
    if (p.likes !== null && p.likes !== undefined) totalLikes += p.likes;
    if (p.commentsTotal !== null) totalComments += p.commentsTotal;
  }
  const engagementRate =
    totalVues > 0 ? (totalLikes + totalComments) / totalVues : null;

  // Top 3 cross-format : on prend les 10 meilleurs de chaque côté puis on
  // trie le mix par vuesJ7 desc et garde 3. Déterministe et représentatif
  // sans nécessiter une métrique commune (saveRate vs ratioSubsViews ne
  // sont pas comparables en absolu). Pas de useMemo manuel — le React
  // Compiler s'en charge ; un useMemo explicite ici est rejeté avec
  // "Compilation Skipped: Existing memoization could not be preserved".
  type TopRow = {
    hookText: string;
    carouselId: string;
    plateforme: string;
    vuesJ7: number;
    mediaType: "carousel" | "short" | "screenrecorder";
  };
  const carouselTopRows: TopRow[] = getTopHooks(carouselPubs, 10).map((h) => ({
    hookText: h.hookText,
    carouselId: h.carouselId,
    plateforme: h.plateforme,
    vuesJ7: h.vuesJ7,
    mediaType: "carousel",
  }));
  const shortTopRows: TopRow[] = getTopHooksShorts(shortPubs, 10).map((h) => ({
    hookText: h.hookText,
    carouselId: h.carouselId,
    plateforme: h.plateforme,
    vuesJ7: h.vuesJ7,
    mediaType: "short",
  }));
  const screenRecorderTopRows: TopRow[] = getTopHooksShorts(
    screenRecorderPubs,
    10,
  ).map((h) => ({
    hookText: h.hookText,
    carouselId: h.carouselId,
    plateforme: h.plateforme,
    vuesJ7: h.vuesJ7,
    mediaType: "screenrecorder",
  }));
  const topMix = [
    ...carouselTopRows,
    ...shortTopRows,
    ...screenRecorderTopRows,
  ]
    .sort((a, b) => b.vuesJ7 - a.vuesJ7)
    .slice(0, 3);

  return (
    <>
      {/*
        Batch E — dashboard cleanup : filtres top-level retirés (la
        granularité des filtres vit désormais sur les pages format
        /carrousels, /shorts, /screenrecorder). Le dashboard reste un
        résumé strict cross-format.
      */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Publiés"
          value={String(totalPublished)}
          secondary={totalDrafts > 0 ? `+${totalDrafts} à venir` : undefined}
        />
        <KpiCard label="Vues totales (J+7)" value={formatNumber(totalVues)} />
        <KpiCard
          label="Save rate moyen"
          value={
            carouselPubs.length === 0
              ? "—"
              : formatPercent(carouselStats.avgSaveRate)
          }
          secondary={
            carouselPubs.length === 0 ? undefined : "Carrousels uniquement"
          }
        />
        <KpiCard
          label="Winners"
          value={
            carouselPubs.length === 0
              ? "—"
              : String(carouselStats.winners)
          }
          secondary={
            carouselPubs.length === 0 ? undefined : "Carrousels uniquement"
          }
          highlight={carouselStats.winners > 0}
        />
        <KpiCard
          label="Subs gagnés"
          value={
            shortPubs.length + screenRecorderPubs.length === 0
              ? "—"
              : formatNumber(totalSubsGained)
          }
          secondary={
            shortPubs.length + screenRecorderPubs.length === 0
              ? undefined
              : "Shorts + SR"
          }
          highlight={
            shortPubs.length + screenRecorderPubs.length > 0 &&
            totalSubsGained > 0
          }
        />
        <KpiCard
          label="Engagement rate"
          value={formatPercent(engagementRate, 2)}
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
                    <TableHead className="text-right">Vues J+7</TableHead>
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
                        {formatNumber(h.vuesJ7)}
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
      <div className="space-y-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
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
