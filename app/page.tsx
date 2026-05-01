"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VerdictBadge, PlatformBadge } from "@/components/VerdictBadge";
import {
  aggregateByAngle,
  aggregateByFormat,
  aggregateByMecanique,
  aggregateByNiveau,
  aggregateByPlateforme,
  getGlobalStats,
  getTopHooks,
  type AggregateRow,
} from "@/lib/dashboard-stats";
import { formatNumber, formatPercent } from "@/lib/verdict";
import { cn } from "@/lib/utils";
import { FileTextIcon, PlusIcon } from "lucide-react";

const COLOR_WINNER = "#10b981"; // emerald-500
const COLOR_MOYEN = "#f59e0b"; // amber-500
const COLOR_FOLD = "#f43f5e"; // rose-500
const COLOR_PENDING = "#cbd5e1"; // slate-300

function getBarColor(rate: number | null): string {
  if (rate === null) return COLOR_PENDING;
  if (rate >= 0.03) return COLOR_WINNER;
  if (rate >= 0.01) return COLOR_MOYEN;
  return COLOR_FOLD;
}

export default function Dashboard() {
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
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Dashboard
        </h1>
        <p className="text-sm text-slate-500">
          {today} — vue d&apos;ensemble du portfolio de carrousels
        </p>
      </header>

      {publications.length === 0 ? (
        <EmptyState />
      ) : (
        <DashboardContent publications={publications} />
      )}
    </div>
  );
}

function DashboardContent({
  publications,
}: {
  publications: NonNullable<ReturnType<typeof useQuery<typeof api.publications.listPublications>>>;
}) {
  const stats = getGlobalStats(publications);
  const byMecanique = aggregateByMecanique(publications);
  const byNiveau = aggregateByNiveau(publications);
  const byFormat = aggregateByFormat(publications);
  const byAngle = aggregateByAngle(publications);
  const byPlateforme = aggregateByPlateforme(publications);
  const topHooks = getTopHooks(publications, 10);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Publications" value={String(stats.total)} />
        <KpiCard
          label="Vues totales (J+7)"
          value={formatNumber(stats.totalVues)}
        />
        <KpiCard
          label="Save rate moyen"
          value={formatPercent(stats.avgSaveRate)}
        />
        <KpiCard
          label="Winners"
          value={String(stats.winners)}
          highlight={stats.winners > 0}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DimensionChart title="Save rate moyen par mécanique" data={byMecanique} />
        <DimensionChart title="Save rate moyen par niveau" data={byNiveau} />
        <DimensionChart title="Save rate moyen par format" data={byFormat} />
        <DimensionChart title="Save rate moyen par angle tonal" data={byAngle} />
      </div>

      <PlateformeComparison rows={byPlateforme} />

      {topHooks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top {topHooks.length} hooks performers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Hook</TableHead>
                    <TableHead className="font-mono">Carousel</TableHead>
                    <TableHead>Plateforme</TableHead>
                    <TableHead className="text-right">Vues J+7</TableHead>
                    <TableHead className="text-right">Save rate</TableHead>
                    <TableHead>Verdict</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topHooks.map((h, i) => (
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
                      <TableCell className="font-mono text-xs">
                        {h.carouselId}
                      </TableCell>
                      <TableCell>
                        <PlatformBadge plateforme={h.plateforme} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {formatNumber(h.vuesJ7)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">
                        {formatPercent(h.saveRate)}
                      </TableCell>
                      <TableCell>
                        <VerdictBadge verdict={h.verdict} />
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

function DimensionChart({
  title,
  data,
}: {
  title: string;
  data: AggregateRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            Aucune donnée
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#e2e8f0"
                vertical={false}
              />
              <XAxis
                dataKey="key"
                tick={{ fontSize: 12, fill: "#475569" }}
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                tick={{ fontSize: 11, fill: "#475569" }}
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
                width={50}
              />
              <Tooltip
                cursor={{ fill: "rgba(148, 163, 184, 0.1)" }}
                content={<ChartTooltip />}
              />
              <Bar dataKey="avgSaveRate" radius={[4, 4, 0, 0]}>
                {data.map((d) => (
                  <Cell key={d.key} fill={getBarColor(d.avgSaveRate)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: AggregateRow }>;
  label?: string;
}) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-xs shadow-md">
      <div className="font-medium text-slate-900">{label}</div>
      <div className="mt-1 space-y-0.5 text-slate-600">
        <div>
          Publications : <span className="font-medium">{d.count}</span>
        </div>
        <div>
          Save rate moyen :{" "}
          <span className="font-medium">{formatPercent(d.avgSaveRate)}</span>
        </div>
        <div>
          Winners : <span className="font-medium">{d.winners}</span> · Folds :{" "}
          <span className="font-medium">{d.folds}</span>
        </div>
      </div>
    </div>
  );
}

function PlateformeComparison({ rows }: { rows: AggregateRow[] }) {
  const tiktok = rows.find((r) => r.key === "TikTok");
  const instagram = rows.find((r) => r.key === "Instagram");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparaison cross-plateforme</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PlateformeCard plateforme="TikTok" row={tiktok} />
          <PlateformeCard plateforme="Instagram" row={instagram} />
        </div>
      </CardContent>
    </Card>
  );
}

function PlateformeCard({
  plateforme,
  row,
}: {
  plateforme: string;
  row: AggregateRow | undefined;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <PlatformBadge plateforme={plateforme} />
      </div>
      {!row ? (
        <p className="text-sm text-slate-400">Pas de publication</p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Publications" value={String(row.count)} />
          <Stat label="Vues totales" value={formatNumber(row.totalVues)} />
          <Stat label="Save rate moyen" value={formatPercent(row.avgSaveRate)} />
          <Stat
            label="Winners"
            value={String(row.winners)}
            highlight={row.winners > 0 ? "emerald" : null}
          />
          <Stat label="Moyens" value={String(row.moyens)} />
          <Stat
            label="Folds"
            value={String(row.folds)}
            highlight={row.folds > 0 ? "rose" : null}
          />
        </dl>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "emerald" | "rose" | null;
}) {
  const color =
    highlight === "emerald"
      ? "text-emerald-600"
      : highlight === "rose"
        ? "text-rose-600"
        : "text-slate-900";
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={cn("mt-0.5 text-lg font-semibold tabular-nums", color)}>
        {value}
      </dd>
    </div>
  );
}

function KpiCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div
          className={cn(
            "text-3xl font-bold tabular-nums",
            highlight ? "text-emerald-600" : "text-slate-900",
          )}
        >
          {value}
        </div>
        <div className="mt-1 text-sm text-slate-500">{label}</div>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="h-12 w-48 animate-pulse rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-72 animate-pulse rounded-lg border border-slate-200 bg-white"
          />
        ))}
      </div>
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
            Crée ton premier carrousel pour faire apparaître les KPIs et les
            graphiques.
          </p>
        </div>
        <Link href="/nouveau" className={cn(buttonVariants({ size: "sm" }))}>
          <PlusIcon />
          Créer le premier carrousel
        </Link>
      </CardContent>
    </Card>
  );
}
