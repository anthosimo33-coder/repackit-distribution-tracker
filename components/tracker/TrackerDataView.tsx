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
  Area,
  AreaChart,
  Legend,
} from "recharts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { isoCountryLabel } from "@/lib/country-name";
import { DayDetailSheet } from "./DayDetailSheet";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterMultiSelect } from "@/components/filters/FilterMultiSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  aggregateByCategory,
  computeGlobalStats,
  countPostsByPlatform,
  DEFAULT_WARMUP_FILTER,
  TRACKER_PLATFORMS,
  type TrackerPlatform,
  type CategoryItem,
  type DailyPoint,
  type DailyByGroup,
  type WarmupFilter,
  shapeCampaignRows,
} from "@/lib/tracker-data";
import { QuadrantChart } from "./QuadrantChart";
import {
  PostsList,
  sortTrackerPosts,
  type TrackerPost,
  type SortKey,
  type SortDir,
} from "./PostsList";
import {
  PublicationDetailDialog,
  type PublicationWithImage,
} from "@/components/PublicationDetailDialog";
import { PublicationEditDialog } from "@/components/PublicationEditDialog";
import { formatNumber, formatPercent } from "@/lib/format";
import { MAX_QUADRANT_PERIOD_DAYS } from "@/convex/quadrantSettings";
import { cn } from "@/lib/utils";
import { BarChart3Icon, InfoIcon, ListIcon, XIcon } from "lucide-react";
import {
  Tooltip as HintTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";

const CREATOR_NONE = "__none__";
const FORMAT_NONE = "__none__";
const CAMPAIGN_NONE = "__none__";

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
/**
 * Teintes d'empilement par marché — assez contrastées côte à côte pour qu'une
 * tranche fine reste distincte de sa voisine, et stables d'un rendu à l'autre
 * (l'ordre des marchés est figé sur toute la fenêtre, cf `groupes`).
 */
/**
 * Clé de série pour les publications SANS marché visé.
 *
 * Le serveur les range sous la chaîne VIDE — c'est l'absence, pas un nom. Mais
 * une chaîne vide passée en `dataKey` à recharts est un identifiant qui n'en est
 * pas un : elle fonctionne aujourd'hui, et c'est exactement le genre de détail
 * qui casse à la montée de version. L'écran lui donne donc un nom, et c'est le
 * seul endroit où il existe.
 */
const SANS_MARCHE = "__sans_marche__";

const TEINTES_MARCHE = [
  "#6366f1",
  "#0d9488",
  "#e11d48",
  "#d97706",
  "#2563eb",
  "#7c3aed",
  "#0891b2",
  "#94a3b8",
];

/** Les filtres du tracker, tels que les queries les attendent. */
export type TrackerQueryArgs = {
  dateFrom?: number;
  dateTo?: number;
  creatorIds?: Id<"creators">[];
  comptes?: string[];
  plateformes?: ("TikTok" | "Instagram" | "YouTube")[];
  formatIds?: Id<"formats">[];
  campaignIds?: Id<"scriptCampaigns">[];
  warmup?: WarmupFilter;
};

/**
 * L'état des filtres du Tracker, REMONTÉ dans la page (dashboard/page.tsx).
 *
 * Deux raisons : le mode partage démonte la vue, et les filtres doivent
 * survivre à l'aller-retour ; et le mode partage PART des filtres en cours
 * (« je partage ce que je regarde »), il doit donc pouvoir les lire.
 */
export function useTrackerFilterState() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Filtres de dimension MULTI-SELECT : Set vide = pas de filtre (tous).
  const [creatorIds, setCreatorIds] = useState<Set<string>>(new Set());
  const [comptes_, setComptes] = useState<Set<string>>(new Set());
  const [plateformes, setPlateformes] = useState<Set<string>>(new Set());
  const [formatIds, setFormatIds] = useState<Set<string>>(new Set());
  const [campaignIds, setCampaignIds] = useState<Set<string>>(new Set());
  // Warmup : tri-état, défaut "Hors warmup" (cf DEFAULT_WARMUP_FILTER) — les
  // posts de chauffe gonflaient vues/likes/commentaires et faussaient
  // l'engagement. Filtre d'AFFICHAGE : le flag et la paie ne bougent pas.
  const [warmup, setWarmup] = useState<WarmupFilter>(DEFAULT_WARMUP_FILTER);
  return {
    dateFrom, setDateFrom, dateTo, setDateTo,
    creatorIds, setCreatorIds, comptes_, setComptes,
    plateformes, setPlateformes, formatIds, setFormatIds,
    campaignIds, setCampaignIds, warmup, setWarmup,
  };
}

export type TrackerFilterState = ReturnType<typeof useTrackerFilterState>;

export function TrackerDataView({ filters }: { filters: TrackerFilterState }) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.dashboard.TrackerDataView");
  const {
    dateFrom, setDateFrom, dateTo, setDateTo,
    creatorIds, setCreatorIds, comptes_, setComptes,
    plateformes, setPlateformes, formatIds, setFormatIds,
    campaignIds, setCampaignIds, warmup, setWarmup,
  } = filters;

  const [mode, setMode] = useState<ViewMode>("list");
  const [sortKey, setSortKey] = useState<SortKey>("vues");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Options des filtres (indépendantes des filtres actifs → toujours switchables).
  const creators = useProjectQuery(api.creators.listCreators, {});
  const comptes = useProjectQuery(api.comptes.listComptesChoix, {});
  const campaigns = useProjectQuery(api.scripts.listCampaigns, {});
  const formats = useProjectQuery(api.formats.listFormats, {});

  const queryArgs = useMemo(() => {
    const a: TrackerQueryArgs = {};
    if (dateFrom) a.dateFrom = startOfDayMs(dateFrom);
    if (dateTo) a.dateTo = endOfDayMs(dateTo);
    if (creatorIds.size) a.creatorIds = [...creatorIds] as Id<"creators">[];
    if (comptes_.size) a.comptes = [...comptes_];
    if (plateformes.size)
      a.plateformes = [...plateformes] as (
        | "TikTok"
        | "Instagram"
        | "YouTube"
      )[];
    if (formatIds.size) a.formatIds = [...formatIds] as Id<"formats">[];
    if (campaignIds.size)
      a.campaignIds = [...campaignIds] as Id<"scriptCampaigns">[];
    // Toujours transmis (y compris le défaut) : la lecture affichée ne doit pas
    // dépendre d'un défaut implicite côté serveur.
    a.warmup = warmup;
    return a;
  }, [
    dateFrom,
    dateTo,
    creatorIds,
    comptes_,
    plateformes,
    formatIds,
    campaignIds,
    warmup,
  ]);

  const posts = useProjectQuery(
    api.trackerData.listTrackerPosts,
    queryArgs,
  ) as TrackerPost[] | undefined;

  // La courbe (et donc la query snapshots bornée) n'est chargée qu'en mode Charts.
  const series = useProjectQuery(
    api.trackerData.trackerViewsDaily,
    mode === "charts" ? queryArgs : "skip",
  );
  const daily = series?.daily;

  // DATES des posts que le filtre warmup retire de la lecture. La carte quadrant
  // ne peut pas les déduire de ses lignes : elles lui arrivent déjà filtrées.
  // Des dates et pas un compte — c'est la carte qui leur applique SA période,
  // sinon on additionne deux fenêtres différentes. Même portée que la courbe
  // (mode Charts), et pas de lecture du tout quand rien n'est caché (« Tous »).
  //
  // La borne est FIGÉE au montage : recalculée à chaque rendu, elle changerait
  // les arguments de la query en permanence et en annulerait le cache.
  const [quadrantSince] = useState(
    () => Date.now() - MAX_QUADRANT_PERIOD_DAYS * 86_400_000,
  );
  const warmupHiddenDates = useProjectQuery(
    api.trackerData.trackerWarmupHiddenDates,
    mode === "charts" && warmup !== "all"
      ? { ...queryArgs, since: quadrantSince }
      : "skip",
  );

  // Docs complets (enrichis) pour ouvrir PublicationDetailDialog au clic sur une
  // ligne → accès au toggle warmup. Même pattern que ShortSourcesTable :
  // listPublications est déjà dédupliqué/caché par Convex. Cette vue tracker
  // n'est montée que sur l'onglet "Tracker" du dashboard (pas la landing page).
  const allPubs = useProjectQuery(api.publications.listPublications, {});
  const pubMap = useMemo(() => {
    const m = new Map<Id<"publications">, PublicationWithImage>();
    for (const p of allPubs ?? []) m.set(p._id, p);
    return m;
  }, [allPubs]);
  const [viewingPub, setViewingPub] = useState<PublicationWithImage | null>(
    null,
  );
  const [editingPub, setEditingPub] = useState<PublicationWithImage | null>(
    null,
  );

  function openDetail(publicationId: Id<"publications">) {
    const doc = pubMap.get(publicationId);
    if (doc) setViewingPub(doc);
  }

  const filtersActive =
    dateFrom !== "" ||
    dateTo !== "" ||
    creatorIds.size > 0 ||
    comptes_.size > 0 ||
    plateformes.size > 0 ||
    formatIds.size > 0 ||
    campaignIds.size > 0 ||
    // "Hors warmup" est le défaut : seul un écart au défaut compte comme filtre actif.
    warmup !== DEFAULT_WARMUP_FILTER;
  // Pastille du bouton : la période (Du/Au) compte pour UN filtre.
  const activeFilterCount =
    Number(dateFrom !== "" || dateTo !== "") +
    [creatorIds, comptes_, plateformes, formatIds, campaignIds].filter(
      (f) => f.size > 0,
    ).length +
    Number(warmup !== DEFAULT_WARMUP_FILTER);

  function resetFilters() {
    setDateFrom("");
    setDateTo("");
    setCreatorIds(new Set());
    setComptes(new Set());
    setPlateformes(new Set());
    setFormatIds(new Set());
    setCampaignIds(new Set());
    setWarmup(DEFAULT_WARMUP_FILTER);
  }

  const stats = useMemo(
    () => computeGlobalStats(posts ?? [], warmup),
    [posts, warmup],
  );

  const postsByPlatform = useMemo(
    () => countPostsByPlatform(posts ?? []),
    [posts],
  );

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
            isWarmup: p.isWarmup,
          }),
        ),
        warmup,
      ),
    [posts, warmup],
  );
  const byCreator = useMemo(
    () =>
      aggregateByCategory(
        (posts ?? []).map(
          (p): CategoryItem => ({
            key: p.creatorId ?? CREATOR_NONE,
            label: p.creatorName ?? tr("sansCreateur"),
            vues: p.vues,
            likes: p.likes,
            comments: p.comments,
            isWarmup: p.isWarmup,
          }),
        ),
        warmup,
      ),
    [posts, warmup],
  );
  // "Vues par format" = par format NOMMÉ (cohérent avec le filtre Format) ; les
  // posts sans format nommé tombent dans un bucket "Sans format".
  const byFormat = useMemo(
    () =>
      aggregateByCategory(
        (posts ?? []).map(
          (p): CategoryItem => ({
            key: p.formatId ?? FORMAT_NONE,
            label: p.formatName ?? tr("sansFormat"),
            vues: p.vues,
            likes: p.likes,
            comments: p.comments,
            isWarmup: p.isWarmup,
          }),
        ),
        warmup,
      ),
    [posts, warmup],
  );

  // "Vues par campagne" — même agrégation cliente que les autres graphes, sur les
  // posts DÉJÀ chargés : aucune query supplémentaire, et le graphe hérite donc
  // automatiquement de TOUS les filtres actifs de la page (dates, créateur,
  // compte, plateforme, format, warmup, et le multi-select campagne lui-même).
  const byCampaign = useMemo(
    () =>
      shapeCampaignRows(
        aggregateByCategory(
          (posts ?? []).map(
            (p): CategoryItem => ({
              key: p.campaignId ?? CAMPAIGN_NONE,
              label: p.campaignName ?? tr("horsCampagne"),
              vues: p.vues,
              likes: p.likes,
              comments: p.comments,
              isWarmup: p.isWarmup,
            }),
          ),
          warmup,
        ),
        undefined,
        tr("horsCampagne"),
        tr("autres"),
      ),
    [posts, warmup, tr],
  );

  const sortedPosts = useMemo(
    () => sortTrackerPosts(posts ?? [], sortKey, sortDir),
    [posts, sortKey, sortDir],
  );

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
        label: c.status === "archived" ? tr("archivee", { name: c.name }) : c.name,
      })),
    [campaigns],
  );
  const formatOptions = useMemo(
    () =>
      (formats ?? []).map((f) => ({
        value: f._id as string,
        label: f.status === "archived" ? tr("archive", { name: f.name }) : f.name,
      })),
    [formats],
  );

  return (
    <div className="space-y-6">
      {/* ZONE 1 — Filtres libres */}
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-[repeat(8,minmax(0,1fr))_auto] xl:gap-x-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tracker-from" className="text-xs text-slate-600">
              {tr("du")}
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
              {tr("au")}
            </Label>
            <Input
              id="tracker-to"
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <FilterMultiSelect
            label={tr("createur")}
            selectedValues={creatorIds}
            onChange={setCreatorIds}
            options={creatorOptions}
            allLabel={tr("tous")}
            width="w-full"
          />
          <FilterMultiSelect
            label={tr("compte")}
            selectedValues={comptes_}
            onChange={setComptes}
            options={compteOptions}
            allLabel={tr("tous")}
            width="w-full"
          />
          <FilterMultiSelect
            label={tr("plateforme")}
            selectedValues={plateformes}
            onChange={setPlateformes}
            options={TRACKER_PLATFORMS.map((p) => ({ value: p, label: p }))}
            allLabel={tr("toutes")}
            width="w-full"
          />
          <FilterMultiSelect
            label={tr("format")}
            selectedValues={formatIds}
            onChange={setFormatIds}
            options={formatOptions}
            allLabel={tr("tous")}
            width="w-full"
          />
          <FilterMultiSelect
            label={tr("campagne")}
            selectedValues={campaignIds}
            onChange={setCampaignIds}
            options={campaignOptions}
            allLabel={tr("toutes")}
            width="w-full"
          />
          <WarmupFilterSelect value={warmup} onChange={setWarmup} />
          {/* Dernière cellule de la grille (plus de ligne à lui seul) : en xl une
              colonne `auto` en bout de ligne, réduite à l'icône + pastille pour
              ne pas rogner les 8 filtres ; ailleurs une case comme un filtre. */}
          <div className="flex items-end">
            <Button
              variant="outline"
              onClick={resetFilters}
              disabled={!filtersActive}
              title={tr("reinitialiser")}
              className="w-full xl:w-auto xl:px-2"
            >
              <XIcon aria-hidden="true" />
              <span className="xl:sr-only">{tr("reinitialiser")}</span>
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 text-xs tabular-nums text-primary">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* ZONE 2 — Stats globales */}
      {posts === undefined ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <PostCountCard total={posts.length} byPlatform={postsByPlatform} />
          <StatCard label={tr("vues")} value={formatNumber(stats.vues, loc)} />
          <StatCard label={tr("likes")} value={formatNumber(stats.likes, loc)} />
          <StatCard label={tr("commentaires")} value={formatNumber(stats.comments, loc)} />
          <StatCard
            label={tr("engagementRate")}
            value={formatPercent(stats.engagement, 2, loc)}
            hint={tr("engagementFormule", {
              views: formatNumber(stats.engagementVues, loc),
              scope: warmup === "only" ? "only" : "exclude",
            })}
          />
        </div>
      )}

      {/* ZONE 3 — Toggle Liste / Charts */}
      <div className="flex items-center justify-end gap-3">
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
          onRowClick={openDetail}
        />
      ) : (
        <ChartsPanel
          daily={daily}
          byMarket={series?.byMarket}
          marketLabels={series?.marketLabels}
          queryArgs={queryArgs}
          posts={posts}
          warmup={warmup}
          hiddenWarmupDates={
            warmup === "all" ? [] : (warmupHiddenDates ?? null)
          }
          onSelectPost={openDetail}
          byPlatform={byPlatform}
          byCreator={byCreator}
          byFormat={byFormat}
          byCampaign={byCampaign}
        />
      )}

      {/* Détail d'un post publié — porte le toggle warmup (WarmupControl) via
          PublishedView. Réutilise le dialog existant (aucune logique warmup
          dupliquée). onEdit bascule vers l'édition des stats, comme ailleurs. */}
      {viewingPub && (
        <PublicationDetailDialog
          key={viewingPub._id}
          publication={viewingPub}
          open
          onOpenChange={(o) => !o && setViewingPub(null)}
          onEdit={() => {
            setEditingPub(viewingPub);
            setViewingPub(null);
          }}
        />
      )}
      {editingPub && (
        <PublicationEditDialog
          key={editingPub._id}
          publication={editingPub}
          open
          onOpenChange={(o) => !o && setEditingPub(null)}
        />
      )}
    </div>
  );
}

// Libellés dans `admin.dashboard.warmupFilter.*`.
const WARMUP_OPTIONS = ["exclude", "all", "only"] as const satisfies readonly WarmupFilter[];

/**
 * Filtre warmup tri-état. Single-select : <FilterSelect> n'est pas réutilisable
 * ici (il impose le sentinel "all" = « aucun filtre » et rend la valeur comme
 * son propre libellé) alors que le défaut est ici « Hors warmup », pas « Tous ».
 * Le gabarit (wrapper + label) est celui des autres filtres de la barre.
 */
function WarmupFilterSelect({
  value,
  onChange,
}: {
  value: WarmupFilter;
  onChange: (v: WarmupFilter) => void;
}) {
  const tr = useTranslations("admin.dashboard.WarmupFilterSelect");
  const tw = useTranslations("admin.dashboard.warmupFilter");
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-slate-600">{tr("warmup")}</label>
      <Select
        value={value}
        onValueChange={(v) => v !== null && onChange(v as WarmupFilter)}
      >
        <SelectTrigger className="w-full">
          <SelectValue>{tw(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {WARMUP_OPTIONS.map((o) => (
            <SelectItem key={o} value={o}>
              {tw(o)}
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
  const tr = useTranslations("admin.dashboard.ModeToggle");
  const options: { value: ViewMode; label: string; icon: typeof ListIcon }[] = [
    { value: "list", label: tr("liste"), icon: ListIcon },
    { value: "charts", label: tr("charts"), icon: BarChart3Icon },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={tr("modeDAffichage")}
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

type CategoryAggregate = ReturnType<typeof aggregateByCategory>[number];

function ChartsPanel({
  daily,
  posts,
  warmup,
  hiddenWarmupDates,
  onSelectPost,
  byMarket,
  marketLabels,
  queryArgs,
  byPlatform,
  byCreator,
  byFormat,
  byCampaign,
}: {
  daily: DailyPoint[] | undefined;
  /** La même série, ventilée par marché (somme des tranches = total du jour). */
  byMarket: DailyByGroup[] | undefined;
  /** Clé de groupe → libellé lisible. */
  marketLabels: { key: string; label: string }[] | undefined;
  /** Les filtres courants — le détail d'un jour doit lire la MÊME sélection. */
  queryArgs: TrackerQueryArgs;
  posts: TrackerPost[];
  warmup: WarmupFilter;
  hiddenWarmupDates: readonly number[] | null;
  onSelectPost: (id: Id<"publications">) => void;
  byPlatform: CategoryAggregate[];
  byCreator: CategoryAggregate[];
  byFormat: CategoryAggregate[];
  byCampaign: CategoryAggregate[];
}) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.dashboard.ChartsPanel");
  const [ventile, setVentile] = useState(false);
  const [jourOuvert, setJourOuvert] = useState<string | null>(null);

  /**
   * Les marchés à empiler, du plus gros au plus petit sur la fenêtre entière.
   * L'ordre est FIGÉ pour toute la série : un empilement dont les tranches
   * changent d'ordre d'un jour à l'autre ne se lit plus.
   */
  const groupes = useMemo(() => {
    const total = new Map<string, number>();
    for (const jour of byMarket ?? []) {
      for (const p of jour.parts) total.set(p.group, (total.get(p.group) ?? 0) + p.value);
    }
    const libelle = new Map((marketLabels ?? []).map((l) => [l.key, l.label]));
    return [...total.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => ({
        key: key === "" ? SANS_MARCHE : key,
        // Un code pays devient un nom ; un marché composé porte déjà le sien ;
        // l'absence de marché se DIT, elle ne reste pas une case vide.
        label:
          key === ""
            ? tr("sansMarche")
            : (libelle.get(key) ?? key).length === 2
              ? isoCountryLabel(libelle.get(key) ?? key, loc)
              : (libelle.get(key) ?? key),
      }));
  }, [byMarket, marketLabels]);

  /** Une ligne par jour, une colonne par marché — la forme qu'attend recharts. */
  const empile = useMemo(
    () =>
      (byMarket ?? []).map((jour) => {
        const ligne: Record<string, string | number> = { date: jour.date };
        for (const g of groupes) ligne[g.key] = 0;
        for (const p of jour.parts) {
          ligne[p.group === "" ? SANS_MARCHE : p.group] = p.value;
        }
        return ligne;
      }),
    [byMarket, groupes],
  );

  return (
    <div className="space-y-4">
      {/* Graphique 1 — Évolution : vues GAGNÉES par jour (deltas, pas cumulé). */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                {tr("vuesGagneesParJour")}
              </h3>
              <p className="text-xs text-slate-500">
                {tr("deltaDesVuesEntreSnapshots")}
              </p>
            </div>
            {groupes.length > 1 ? (
              <div
                role="group"
                aria-label={tr("decoupageDeLaCourbe")}
                className="inline-flex shrink-0 rounded-full border border-slate-200 bg-slate-50 p-0.5"
              >
                {([false, true] as const).map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    aria-pressed={ventile === v}
                    onClick={() => setVentile(v)}
                    className={
                      ventile === v
                        ? "rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-900 shadow-sm"
                        : "rounded-full px-3 py-1 text-xs text-slate-500 hover:text-slate-700"
                    }
                  >
                    {v ? tr("parMarche") : tr("total")}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {daily === undefined ? (
            <ChartPlaceholder>{tr("chargement")}</ChartPlaceholder>
          ) : daily.length === 0 ? (
            <ChartPlaceholder>
              {tr("pasAssezDHistoriquePour")}
            </ChartPlaceholder>
          ) : ventile ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart
                data={empile}
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                onClick={(e: { activeLabel?: string | number }) => {
                  const jour = e?.activeLabel;
                  if (typeof jour === "string") setJourOuvert(jour);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
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
                  tickFormatter={(v: number) => formatNumber(v, loc)}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }}
                  formatter={(v, nom) => [formatNumber(Number(v), loc), String(nom)]}
                  labelFormatter={(l) => fullDay(String(l))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {groupes.map((g, i) => (
                  <Area
                    key={g.key}
                    type="monotone"
                    dataKey={g.key}
                    name={g.label}
                    stackId="marche"
                    stroke={TEINTES_MARCHE[i % TEINTES_MARCHE.length]}
                    fill={TEINTES_MARCHE[i % TEINTES_MARCHE.length]}
                    fillOpacity={0.75}
                    strokeWidth={1}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart
                data={daily}
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                onClick={(e: { activeLabel?: string | number }) => {
                  const jour = e?.activeLabel;
                  if (typeof jour === "string") setJourOuvert(jour);
                }}
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
                  tickFormatter={(v: number) => formatNumber(v, loc)}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 6,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                  }}
                  formatter={(v) => [formatNumber(Number(v), loc), tr("vuesGagnees")]}
                  labelFormatter={(l, payload) => (
                    <>
                      {fullDay(String(l))}
                      {isEstimatedDay(payload) ? (
                        <span className="mt-0.5 block text-[11px] font-normal text-slate-500">
                          {tr("estimeAuProrataEntreSyncs")}
                        </span>
                      ) : null}
                    </>
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={tr("vuesGagnees")}
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

      {/* Quadrant « Vues × Intent » — la seule carte DÉCISIONNELLE de la vue :
          les autres décrivent le volume, celle-ci répond « on reconduit ou
          pas ». Elle consomme la MÊME liste de posts que les graphes ci-dessus
          (aucune query en plus), donc les mêmes filtres de page ; ses scores,
          eux, sont écrits par le relevé nocturne et ne dépendent d'aucun filtre. */}
      <QuadrantChart
        posts={posts}
        hiddenWarmupDates={hiddenWarmupDates}
        onSelectPost={onSelectPost}
      />

      {/* Graphiques 2-5 — comparaisons par catégorie. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ComparisonChart
          title={tr("vuesParPlateforme")}
          rows={byPlatform}
          metric="vues"
        />
        <ComparisonChart
          title={tr("engagementParPlateforme")}
          rows={byPlatform}
          metric="engagement"
        />
        <ComparisonChart
          title={tr("vuesParCreateur")}
          rows={byCreator}
          metric="vues"
        />
        <ComparisonChart title={tr("vuesParFormat")} rows={byFormat} metric="vues" />
        <ComparisonChart
          title={tr("vuesParCampagne")}
          rows={byCampaign}
          metric="vues"
        />
      </div>
      <DayDetailSheet
        day={jourOuvert}
        queryArgs={queryArgs}
        onClose={() => setJourOuvert(null)}
        onSelectPost={(id) => {
          setJourOuvert(null);
          onSelectPost(id);
        }}
      />
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
  const loc = useIntlLocale();
  const tr = useTranslations("admin.dashboard.ComparisonChart");
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
    engVues: r.engagementVues,
  }));
  const height = Math.max(140, data.length * 40 + 40);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {data.length === 0 ? (
          <ChartPlaceholder small>{tr("aucuneDonnee")}</ChartPlaceholder>
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
                    : formatNumber(v, loc)
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
                  const payload = item?.payload as {
                    raw: number | null;
                    engVues: number;
                  };
                  return [
                    metric === "engagement"
                      ? formatPercent(payload?.raw ?? null, 2, loc)
                      : formatNumber(payload?.raw ?? null, loc),
                    metric === "engagement"
                      ? tr("engagementVues", { count: formatNumber(payload?.engVues ?? 0, loc) })
                      : "Vues",
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

/** Pastille de la barre : TikTok en noir comme son badge dans la liste. */
const PLATFORM_SWATCH: Record<TrackerPlatform, string> = {
  TikTok: "bg-slate-900",
  Instagram: "bg-pink-500",
  YouTube: "bg-red-500",
};

/**
 * Nombre de posts + répartition par plateforme (barre segmentée + légende).
 * Suit les filtres : filtrer sur une plateforme la réduit à un seul segment,
 * ce qui confirme d'un coup d'œil ce que couvrent les autres cartes.
 */
function PostCountCard({
  total,
  byPlatform,
}: {
  total: number;
  byPlatform: ReturnType<typeof countPostsByPlatform>;
}) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.dashboard.TrackerDataView");
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold tabular-nums text-slate-900 sm:text-3xl">
          {formatNumber(total, loc)}
        </div>
        <div className="mt-1 text-sm text-slate-500">
          {tr("postsPublies", { count: total })}
        </div>
        {byPlatform.length > 0 && (
          <>
            <div
              className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full"
              aria-hidden="true"
            >
              {byPlatform.map((r) => (
                <div
                  key={r.platform}
                  className={PLATFORM_SWATCH[r.platform]}
                  style={{ width: `${r.share * 100}%` }}
                />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              {byPlatform.map((r) => (
                <li key={r.platform} className="flex items-center gap-1.5">
                  <span
                    className={cn("size-2 rounded-sm", PLATFORM_SWATCH[r.platform])}
                    aria-hidden="true"
                  />
                  {r.platform}
                  <span className="tabular-nums text-slate-700">
                    {formatNumber(r.count, loc)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** `hint` : précision (formule, périmètre) derrière une icône ⓘ, pour que
 *  toutes les cartes gardent la même structure chiffre + libellé. */
function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const tr = useTranslations("admin.dashboard.TrackerDataView");
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold tabular-nums text-slate-900 sm:text-3xl">
          {value}
        </div>
        <div className="mt-1 flex items-center gap-1 text-sm text-slate-500">
          {label}
          {hint && (
            <HintTooltip>
              <TooltipTrigger
                aria-label={tr("voirLaFormule")}
                className="rounded-full text-slate-400 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <InfoIcon className="size-3.5" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent side="bottom">{hint}</TooltipContent>
            </HintTooltip>
          )}
        </div>
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
  const tr = useTranslations("admin.dashboard.EmptyState");
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white py-16 text-center">
      <p className="text-sm text-slate-500">
        {filtersActive
          ? tr("aucunPostPublieNeCorrespond")
          : tr("aucunPostPubliePourL")}
      </p>
      {filtersActive && (
        <Button variant="outline" size="sm" onClick={onReset}>
          {tr("reinitialiserLesFiltres")}
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

/**
 * Le point survolé a-t-il été reconstruit à partir d'un intervalle de sync trop
 * large (> 30 h, cf ESTIMATED_SPAN_MS) ? Le serveur pose le drapeau par jour ;
 * on ne fait que le lire dans le payload recharts pour afficher la réserve en
 * tooltip — un point estimé ne doit pas se lire comme une mesure.
 */
function isEstimatedDay(payload: unknown): boolean {
  if (!Array.isArray(payload)) return false;
  return payload.some(
    (entry: { payload?: Partial<DailyPoint> }) =>
      entry?.payload?.estimated === true,
  );
}
