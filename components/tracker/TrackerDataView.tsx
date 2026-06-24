"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlatformBadge } from "@/components/VerdictBadge";
import { formatNumber, formatPercent, formatDate } from "@/lib/format";
import { FORMAT_CONFIGS, type FormatKey } from "@/lib/format-config";
import {
  aggregateByCategory,
  computeGlobalStats,
  engagementRate,
  type CategoryItem,
} from "@/lib/tracker-data";
import { cn } from "@/lib/utils";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ExternalLinkIcon,
  BarChart3Icon,
  ListIcon,
} from "lucide-react";

const ALL = "all";

type TrackerPost = {
  _id: Id<"publications">;
  carouselId: string;
  label: string;
  plateforme: "TikTok" | "Instagram" | "YouTube";
  mediaType: FormatKey;
  compte: string;
  creatorId: Id<"creators"> | null;
  creatorName: string | null;
  datePubli: number;
  postUrl: string | null;
  vues: number;
  likes: number;
  comments: number;
};

const PLATFORMS = ["TikTok", "Instagram", "YouTube"] as const;
const MEDIA_TYPES: FormatKey[] = ["carousel", "short", "screenrecorder"];
const CREATOR_NONE = "__none__";

type SortKey = "vues" | "date" | "likes" | "engagement";
type SortDir = "asc" | "desc";
type ViewMode = "list" | "charts";

/** "YYYY-MM-DD" (input date, heure locale) → ms au début du jour. */
function startOfDayMs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getTime();
}
/** "YYYY-MM-DD" → ms à la toute fin du jour (borne haute inclusive). */
function endOfDayMs(dateStr: string): number {
  return new Date(`${dateStr}T23:59:59.999`).getTime();
}

/**
 * Vue TRACKER refondue : data des posts publiés. Un SEUL état de filtres
 * (dates libres Du/Au + créateur/compte/plateforme/format/campagne) pilote À LA
 * FOIS les stats globales (zone 2), la liste (zone 3 mode Liste) et les charts
 * (zone 3 mode Charts). Latest dénormalisé pour stats/liste ; snapshots bornés
 * (range-scan) seulement pour la courbe vues/jour.
 */
export function TrackerDataView() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [creatorId, setCreatorId] = useState<string>(ALL);
  const [compte, setCompte] = useState<string>(ALL);
  const [plateforme, setPlateforme] = useState<string>(ALL);
  const [mediaType, setMediaType] = useState<string>(ALL);
  const [campaignId, setCampaignId] = useState<string>(ALL);

  const [mode, setMode] = useState<ViewMode>("list");
  const [sortKey, setSortKey] = useState<SortKey>("vues");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Options des filtres (indépendantes des filtres actifs → toujours switchables).
  const creators = useProjectQuery(api.creators.listCreators, {});
  const comptes = useProjectQuery(api.comptes.listComptes, {});
  const campaigns = useProjectQuery(api.scripts.listCampaigns, {});

  const queryArgs = useMemo(() => {
    const a: {
      dateFrom?: number;
      dateTo?: number;
      creatorId?: Id<"creators">;
      compte?: string;
      plateforme?: "TikTok" | "Instagram" | "YouTube";
      mediaType?: FormatKey;
      campaignId?: Id<"scriptCampaigns">;
    } = {};
    if (dateFrom) a.dateFrom = startOfDayMs(dateFrom);
    if (dateTo) a.dateTo = endOfDayMs(dateTo);
    if (creatorId !== ALL) a.creatorId = creatorId as Id<"creators">;
    if (compte !== ALL) a.compte = compte;
    if (plateforme !== ALL)
      a.plateforme = plateforme as "TikTok" | "Instagram" | "YouTube";
    if (mediaType !== ALL) a.mediaType = mediaType as FormatKey;
    if (campaignId !== ALL) a.campaignId = campaignId as Id<"scriptCampaigns">;
    return a;
  }, [dateFrom, dateTo, creatorId, compte, plateforme, mediaType, campaignId]);

  const posts = useProjectQuery(
    api.trackerData.listTrackerPosts,
    queryArgs,
  ) as TrackerPost[] | undefined;

  // La courbe (et donc la query snapshots bornée) n'est chargée qu'en mode Charts.
  const daily = useProjectQuery(
    api.trackerData.trackerViewsDaily,
    mode === "charts" ? queryArgs : "skip",
  );

  const filtersActive =
    dateFrom !== "" ||
    dateTo !== "" ||
    creatorId !== ALL ||
    compte !== ALL ||
    plateforme !== ALL ||
    mediaType !== ALL ||
    campaignId !== ALL;

  function resetFilters() {
    setDateFrom("");
    setDateTo("");
    setCreatorId(ALL);
    setCompte(ALL);
    setPlateforme(ALL);
    setMediaType(ALL);
    setCampaignId(ALL);
  }

  const stats = useMemo(() => computeGlobalStats(posts ?? []), [posts]);

  const byPlatform = useMemo(
    () =>
      aggregateByCategory(
        (posts ?? []).map(
          (p): CategoryItem => ({
            key: p.plateforme,
            label: p.plateforme,
            vues: p.vues,
            likes: p.likes,
            comments: p.comments,
          }),
        ),
      ),
    [posts],
  );
  const byCreator = useMemo(
    () =>
      aggregateByCategory(
        (posts ?? []).map(
          (p): CategoryItem => ({
            key: p.creatorId ?? CREATOR_NONE,
            label: p.creatorName ?? "Sans créateur",
            vues: p.vues,
            likes: p.likes,
            comments: p.comments,
          }),
        ),
      ),
    [posts],
  );
  const byFormat = useMemo(
    () =>
      aggregateByCategory(
        (posts ?? []).map(
          (p): CategoryItem => ({
            key: p.mediaType,
            label: FORMAT_CONFIGS[p.mediaType].singular,
            vues: p.vues,
            likes: p.likes,
            comments: p.comments,
          }),
        ),
      ),
    [posts],
  );

  const sortedPosts = useMemo(() => {
    const list = [...(posts ?? [])];
    list.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      let cmp: number;
      if (va === null && vb === null) cmp = 0;
      else if (va === null) cmp = 1;
      else if (vb === null) cmp = -1;
      else cmp = va - vb;
      const directional = sortDir === "asc" ? cmp : -cmp;
      if (directional !== 0) return directional;
      return b.datePubli - a.datePubli; // tiebreak: plus récent d'abord
    });
    return list;
  }, [posts, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const creatorOptions = useMemo(
    () =>
      (creators ?? []).map((c) => ({ value: c._id as string, label: c.name })),
    [creators],
  );
  const compteOptions = useMemo(
    () => (comptes ?? []).map((c) => ({ value: c.handle, label: c.handle })),
    [comptes],
  );
  const campaignOptions = useMemo(
    () =>
      (campaigns ?? []).map((c) => ({
        value: c._id as string,
        label: c.status === "archived" ? `${c.name} (archivée)` : c.name,
      })),
    [campaigns],
  );

  return (
    <div className="space-y-6">
      {/* ZONE 1 — Filtres libres */}
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tracker-from" className="text-xs text-slate-600">
              Du
            </Label>
            <Input
              id="tracker-from"
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tracker-to" className="text-xs text-slate-600">
              Au
            </Label>
            <Input
              id="tracker-to"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <FilterDropdown
            label="Créateur"
            value={creatorId}
            onChange={setCreatorId}
            options={creatorOptions}
            allLabel="Tous"
          />
          <FilterDropdown
            label="Compte"
            value={compte}
            onChange={setCompte}
            options={compteOptions}
            allLabel="Tous"
          />
          <FilterDropdown
            label="Plateforme"
            value={plateforme}
            onChange={setPlateforme}
            options={PLATFORMS.map((p) => ({ value: p, label: p }))}
            allLabel="Toutes"
          />
          <FilterDropdown
            label="Format"
            value={mediaType}
            onChange={setMediaType}
            options={MEDIA_TYPES.map((m) => ({
              value: m,
              label: FORMAT_CONFIGS[m].singular,
            }))}
            allLabel="Tous"
          />
          <FilterDropdown
            label="Campagne"
            value={campaignId}
            onChange={setCampaignId}
            options={campaignOptions}
            allLabel="Toutes"
          />
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={resetFilters}
            disabled={!filtersActive}
          >
            Réinitialiser
          </Button>
        </div>
      </div>

      {/* ZONE 2 — Stats globales */}
      {posts === undefined ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Vues" value={formatNumber(stats.vues)} />
          <StatCard label="Likes" value={formatNumber(stats.likes)} />
          <StatCard label="Commentaires" value={formatNumber(stats.comments)} />
          <StatCard
            label="Engagement rate"
            value={formatPercent(stats.engagement, 2)}
            secondary="(likes + comments) / vues"
          />
        </div>
      )}

      {/* ZONE 3 — Toggle Liste / Charts */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {posts === undefined
            ? "Chargement…"
            : `${posts.length} post${posts.length > 1 ? "s" : ""} publié${posts.length > 1 ? "s" : ""}`}
        </p>
        <ModeToggle value={mode} onChange={setMode} />
      </div>

      {posts === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : posts.length === 0 ? (
        <EmptyState filtersActive={filtersActive} onReset={resetFilters} />
      ) : mode === "list" ? (
        <PostsList
          posts={sortedPosts}
          sortKey={sortKey}
          sortDir={sortDir}
          onToggleSort={toggleSort}
        />
      ) : (
        <ChartsPanel
          daily={daily}
          byPlatform={byPlatform}
          byCreator={byCreator}
          byFormat={byFormat}
        />
      )}
    </div>
  );
}

function sortValue(p: TrackerPost, key: SortKey): number | null {
  switch (key) {
    case "vues":
      return p.vues;
    case "date":
      return p.datePubli;
    case "likes":
      return p.likes;
    case "engagement":
      return engagementRate(p.likes, p.comments, p.vues);
  }
}

function FilterDropdown({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <Select value={value} onValueChange={(v) => v !== null && onChange(v)}>
        <SelectTrigger className="w-full">
          <SelectValue>
            <span className="truncate">
              {value === ALL ? allLabel : (selected?.label ?? value)}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const options: { value: ViewMode; label: string; icon: typeof ListIcon }[] = [
    { value: "list", label: "Liste", icon: ListIcon },
    { value: "charts", label: "Charts", icon: BarChart3Icon },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Mode d'affichage"
      className="inline-flex rounded-md border border-slate-200 bg-white p-0.5"
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors",
              value === opt.value
                ? "bg-primary text-primary-foreground"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            <Icon className="size-3.5" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function PostsList({
  posts,
  sortKey,
  sortDir,
  onToggleSort,
}: {
  posts: TrackerPost[];
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (k: SortKey) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              active={sortKey === "date"}
              dir={sortDir}
              onClick={() => onToggleSort("date")}
            >
              Post
            </SortableHead>
            <SortableHead
              active={sortKey === "vues"}
              dir={sortDir}
              onClick={() => onToggleSort("vues")}
              className="text-right"
            >
              Vues
            </SortableHead>
            <SortableHead
              active={sortKey === "likes"}
              dir={sortDir}
              onClick={() => onToggleSort("likes")}
              className="text-right"
            >
              Likes
            </SortableHead>
            <TableHead className="text-right">Comm.</TableHead>
            <SortableHead
              active={sortKey === "engagement"}
              dir={sortDir}
              onClick={() => onToggleSort("engagement")}
              className="text-right"
            >
              Engagement
            </SortableHead>
            <TableHead className="w-10 text-center">Lien</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {posts.map((p) => {
            const eng = engagementRate(p.likes, p.comments, p.vues);
            return (
              <TableRow key={p._id}>
                <TableCell className="max-w-[420px]">
                  <div
                    className="truncate text-sm font-medium text-slate-900"
                    title={p.label}
                  >
                    {p.label || (
                      <span className="text-slate-400">(sans titre)</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500">
                    <PlatformBadge plateforme={p.plateforme} />
                    <span>{p.creatorName ?? "Sans créateur"}</span>
                    <span aria-hidden>·</span>
                    <span>{FORMAT_CONFIGS[p.mediaType].singular}</span>
                    <span aria-hidden>·</span>
                    <span className="whitespace-nowrap">
                      {formatDate(p.datePubli)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatNumber(p.vues)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatNumber(p.likes)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatNumber(p.comments)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatPercent(eng, 2)}
                </TableCell>
                <TableCell className="text-center">
                  {p.postUrl ? (
                    <a
                      href={p.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-slate-400 hover:text-primary"
                      aria-label={`Ouvrir le post ${p.carouselId} sur ${p.plateforme}`}
                      title="Ouvrir le post"
                    >
                      <ExternalLinkIcon className="size-4" />
                    </a>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHead({
  children,
  active,
  dir,
  onClick,
  className,
}: {
  children: React.ReactNode;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-slate-900"
      >
        {children}
        {active ? (
          dir === "asc" ? (
            <ArrowUpIcon className="size-3" />
          ) : (
            <ArrowDownIcon className="size-3" />
          )
        ) : (
          <ArrowUpDownIcon className="size-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

type CategoryAggregate = ReturnType<typeof aggregateByCategory>[number];

function ChartsPanel({
  daily,
  byPlatform,
  byCreator,
  byFormat,
}: {
  daily: { date: string; value: number }[] | undefined;
  byPlatform: CategoryAggregate[];
  byCreator: CategoryAggregate[];
  byFormat: CategoryAggregate[];
}) {
  return (
    <div className="space-y-4">
      {/* Graphique 1 — Évolution : vues GAGNÉES par jour (deltas, pas cumulé). */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Vues gagnées par jour
            </h3>
            <p className="text-xs text-slate-500">
              Delta des vues entre snapshots consécutifs, agrégé sur les posts
              filtrés (rythme réel, non cumulé).
            </p>
          </div>
          {daily === undefined ? (
            <ChartPlaceholder>Chargement…</ChartPlaceholder>
          ) : daily.length === 0 ? (
            <ChartPlaceholder>
              Pas assez d&apos;historique pour tracer l&apos;évolution.
            </ChartPlaceholder>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart
                data={daily}
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
                  tickFormatter={shortDay}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#475569" }}
                  axisLine={{ stroke: "#cbd5e1" }}
                  tickLine={false}
                  width={50}
                  tickFormatter={(v: number) => formatNumber(v)}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 6,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                  formatter={(v) => [formatNumber(Number(v)), "Vues gagnées"]}
                  labelFormatter={(l) => fullDay(String(l))}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Vues gagnées"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Graphiques 2-5 — comparaisons par catégorie. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ComparisonChart
          title="Vues par plateforme"
          rows={byPlatform}
          metric="vues"
        />
        <ComparisonChart
          title="Engagement par plateforme"
          rows={byPlatform}
          metric="engagement"
        />
        <ComparisonChart
          title="Vues par créateur"
          rows={byCreator}
          metric="vues"
        />
        <ComparisonChart title="Vues par format" rows={byFormat} metric="vues" />
      </div>
    </div>
  );
}

const BAR_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#8b5cf6",
  "#ef4444",
  "#84cc16",
];

function ComparisonChart({
  title,
  rows,
  metric,
}: {
  title: string;
  rows: CategoryAggregate[];
  metric: "vues" | "engagement";
}) {
  // Barres horizontales (catégories à gauche). Engagement → valeur en % (×100),
  // null traité comme 0 pour la barre mais formaté "—" au tooltip.
  const data = rows.map((r) => ({
    label: r.label,
    value:
      metric === "vues"
        ? r.vues
        : r.engagement === null
          ? 0
          : r.engagement * 100,
    raw: metric === "vues" ? r.vues : r.engagement,
  }));
  const height = Math.max(140, data.length * 40 + 40);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {data.length === 0 ? (
          <ChartPlaceholder small>Aucune donnée.</ChartPlaceholder>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#e2e8f0"
                horizontal={false}
              />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "#475569" }}
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
                tickFormatter={(v: number) =>
                  metric === "engagement"
                    ? `${v.toFixed(0)}%`
                    : formatNumber(v)
                }
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 11, fill: "#334155" }}
                axisLine={false}
                tickLine={false}
                width={96}
                tickFormatter={(v: string) =>
                  v.length > 14 ? `${v.slice(0, 13)}…` : v
                }
              />
              <Tooltip
                cursor={{ fill: "#f1f5f9" }}
                contentStyle={{
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                }}
                formatter={(_v, _n, item) => {
                  const raw = (item?.payload as { raw: number | null })?.raw;
                  return [
                    metric === "engagement"
                      ? formatPercent(raw, 2)
                      : formatNumber(raw),
                    metric === "engagement" ? "Engagement" : "Vues",
                  ];
                }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {data.map((_, i) => (
                  <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function ChartPlaceholder({
  children,
  small,
}: {
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-md border border-dashed border-slate-200 text-sm text-slate-400",
        small ? "h-32" : "h-[280px]",
      )}
    >
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold tabular-nums text-slate-900 sm:text-3xl">
          {value}
        </div>
        <div className="mt-1 text-sm text-slate-500">{label}</div>
        {secondary && (
          <div className="mt-0.5 text-xs text-slate-400">{secondary}</div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({
  filtersActive,
  onReset,
}: {
  filtersActive: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white py-16 text-center">
      <p className="text-sm text-slate-500">
        {filtersActive
          ? "Aucun post publié ne correspond à ces filtres."
          : "Aucun post publié pour l'instant."}
      </p>
      {filtersActive && (
        <Button variant="outline" size="sm" onClick={onReset}>
          Réinitialiser les filtres
        </Button>
      )}
    </div>
  );
}

/** "2026-03-05" → "05/03". */
function shortDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}
/** "2026-03-05" → "05/03/2026". */
function fullDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
