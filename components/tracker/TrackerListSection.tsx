"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/filters/FilterSelect";
import { FilterMultiSelect } from "@/components/filters/FilterMultiSelect";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { VerdictBadge, PlatformBadge } from "@/components/VerdictBadge";
import { PublicationEditDialog } from "@/components/PublicationEditDialog";
import { PublicationDetailDialog } from "@/components/PublicationDetailDialog";
import { calculateSaveRate, calculateVerdict } from "@/lib/verdict";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { isPublished } from "@/lib/publication-status";
import {
  getMediaType,
  ALLOWED_PLATFORMS_FOR_CAROUSEL,
  ALLOWED_PLATFORMS_FOR_SCREENRECORDER,
  ALLOWED_PLATFORMS_FOR_SHORT,
  type MediaType,
} from "@/lib/media-type";
import {
  FORMAT_CONFIGS,
  getIdColumnLabel,
  RECORDING_DEVICES,
  RECORDING_DEVICE_ICONS,
  RECORDING_DEVICE_LABELS,
  type RecordingDevice,
} from "@/lib/format-config";
import { getFolderColor } from "@/lib/folder-colors";
import { AnalyticsSection } from "@/components/analytics/AnalyticsSection";
import {
  useSnapshotAge,
  snapshotQueryArgs,
} from "@/components/snapshot-age-selector/SnapshotAgeContext";
import { SnapshotAgeSelector } from "@/components/snapshot-age-selector/SnapshotAgeSelector";
import type { DisplayMetrics } from "@/convex/metricsDisplay";
import {
  DEFAULT_SORT,
  filtersEqual,
  isDefaultFilters,
  sortsEqual,
  type TrackerFilters,
  type TrackerSort,
} from "@/lib/tracker-filters";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  BookmarkIcon,
  ChevronDownIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

const ALL = "all";
const PENDING = "Pending";
const STATUT_PUBLISHED = "Publié";
const STATUT_DRAFT = "À venir";
const MECANIQUES = [
  "Erreur",
  "Volume",
  "Comparaison",
  "Contradiction",
  "Universalité",
  "Question",
] as const;
const FORMATS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

// Batch B (preset v4) — strip silencieux des presets pré-v4 côté client.
const PRESET_SCHEMA_VERSION = 4;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function setToSortedArray(s: Set<string>): string[] {
  return Array.from(s).sort();
}

type SortKey =
  | "date"
  | "saveRate"
  | "vues"
  | "likes"
  | "comments"
  | "subsGained";
type SortDir = "asc" | "desc";

const NO_METRICS: DisplayMetrics = {
  vues: null,
  likes: null,
  saves: null,
  subsGained: null,
  comments: null,
  snapshotUsed: null,
  matchExact: false,
};

/** displayMetrics de la row (enrichie par listPublications) ou tout-null.
 *  Même pattern de cast que icp/imageUrl déjà utilisé dans ce fichier. */
function metricsOf(p: Doc<"publications">): DisplayMetrics {
  return (
    (p as Doc<"publications"> & { displayMetrics?: DisplayMetrics })
      .displayMetrics ?? NO_METRICS
  );
}

function getSortValue(
  p: Doc<"publications">,
  key: SortKey,
): number | null {
  const dm = metricsOf(p);
  switch (key) {
    case "date":
      return p.datePubli;
    case "saveRate":
      return isPublished(p) ? calculateSaveRate(dm.saves, dm.vues) : null;
    case "vues":
      return dm.vues;
    case "likes":
      return dm.likes;
    case "comments":
      return dm.comments;
    case "subsGained":
      return dm.subsGained;
  }
}

// Colonnes du tableau publications. Identifiant typé strict pour qu'un futur
// ajout/suppression force la mise à jour synchrone des deux callsites.
// Batch D — ajout image (thumbnail) et titre, ScreenRecorder uniquement.
// Refinement SR — ajout recordingDevice et isRepackaging (SR uniquement).
type ColumnKey =
  | "date"
  | "image"
  | "carouselId"
  | "source"
  | "hook"
  | "titre"
  | "plateforme"
  | "compte"
  | "icp"
  | "mecanique"
  | "format"
  | "angle"
  | "vues"
  | "saves"
  | "saveRate"
  | "verdict"
  | "likes"
  | "subsGained"
  | "recordingDevice"
  | "isRepackaging"
  | "actions";

const CAROUSEL_COLUMNS: readonly ColumnKey[] = [
  "date",
  "carouselId",
  "hook",
  "plateforme",
  "compte",
  "mecanique",
  "format",
  "angle",
  "vues",
  "saves",
  "saveRate",
  "verdict",
  "actions",
];

// Refinement Shorts — Mécanique et Angle retirés (concepts hook-level non
// pertinents pour les Shorts). Ajout de la colonne ICP (audience ciblée).
const SHORT_COLUMNS: readonly ColumnKey[] = [
  "date",
  "carouselId",
  "source",
  "hook",
  "plateforme",
  "compte",
  "icp",
  "vues",
  "likes",
  "subsGained",
  "actions",
];

// Batch D + Refinement SR — ScreenRecorder columns. Hook, mécanique et
// angle retirés (étape Hook skip pour SR, concepts hook-level inertes).
// Ajout recordingDevice (badge avec icône) et isRepackaging (badge type).
const SCREENRECORDER_COLUMNS: readonly ColumnKey[] = [
  "date",
  "image",
  "carouselId",
  "titre",
  "recordingDevice",
  "isRepackaging",
  "plateforme",
  "compte",
  "vues",
  "likes",
  "subsGained",
  "actions",
];

function columnsForMediaType(mediaType: MediaType): readonly ColumnKey[] {
  if (mediaType === "carousel") return CAROUSEL_COLUMNS;
  if (mediaType === "screenrecorder") return SCREENRECORDER_COLUMNS;
  return SHORT_COLUMNS;
}

/**
 * Refinement SR — badge compact "Téléphone" ou "Ordinateur" avec icône
 * Lucide. Couleurs neutres slate (l'info n'est pas un verdict).
 */
function RecordingDeviceBadge({ device }: { device: RecordingDevice }) {
  const Icon = RECORDING_DEVICE_ICONS[device];
  return (
    <Badge variant="outline" className="gap-1 text-slate-700">
      <Icon className="size-3" />
      {RECORDING_DEVICE_LABELS[device]}
    </Badge>
  );
}

/**
 * TrackerListSection — composant de listing tracker paramétré par mediaType.
 *
 * Utilisé par /carrousels (mediaType="carousel") et /shorts (mediaType="short").
 * mediaType est implicite : pas de filtre top-level Format dans la barre, pas
 * de mode "Tous". Les colonnes et axes de tri sont dérivés directement du
 * prop. Les presets sont scopés par mediaType au niveau Convex (cf
 * mediaTypeScope dans createPreset / listPresets).
 *
 * Stratégie d'extraction depuis l'ancien app/tracker/page.tsx (1721 lignes) :
 * filtre interne mediaType (vs prop publications préfiltrées) — choix B des
 * 2 options de la spec. Avantage : 1 seul useQuery par page, pas de prop
 * drilling de la collection complète, et le composant reste self-contained
 * (le filtre par mediaType est sa responsabilité, pas celle du parent).
 */
export function TrackerListSection({
  mediaType,
}: {
  mediaType: MediaType;
}) {
  const router = useRouter();
  const projectPath = useProjectPath();
  const searchParams = useSearchParams();
  const carouselIdParam = searchParams.get("carouselId");

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [plateforme, setPlateforme] = useState<string>(ALL);
  const [statutFilter, setStatutFilter] = useState<string>(ALL);
  const [compteFilter, setCompteFilter] = useState<Set<string>>(new Set());
  const [mecanique, setMecanique] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<Set<string>>(new Set());
  const [verdictFilter, setVerdictFilter] = useState<Set<string>>(new Set());
  // Refinement SR — filtres SR-specific, session-only (non persistés dans
  // presets v4 — la décision de migrer le schéma presets pour ces 2 filtres
  // est reportée). recordingDeviceFilter = multi-select ("phone"|"desktop").
  // repackagingFilter = single-select : "all" | "repack" | "other".
  const [recordingDeviceFilter, setRecordingDeviceFilter] = useState<
    Set<string>
  >(new Set());
  const [repackagingFilter, setRepackagingFilter] = useState<string>(ALL);
  // Refinement Shorts — filtre ICP (multi), session-only (non persisté dans
  // les presets v4, comme les filtres SR). Vide = "tous".
  const [icpFilter, setIcpFilter] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [editingPub, setEditingPub] = useState<Doc<"publications"> | null>(
    null,
  );
  const [viewingPub, setViewingPub] = useState<Doc<"publications"> | null>(
    null,
  );
  const [deletingPub, setDeletingPub] = useState<Doc<"publications"> | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [markingPub, setMarkingPub] = useState<Doc<"publications"> | null>(
    null,
  );
  const [duplicatingPub, setDuplicatingPub] =
    useState<Doc<"publications"> | null>(null);

  const { age, customDay } = useSnapshotAge();
  const publications = useProjectQuery(
    api.publications.listPublications,
    snapshotQueryArgs({ age, customDay }),
  );
  const comptes = useProjectQuery(api.comptes.listComptes, { actifOnly: true });
  // Options du filtre ICP (Short uniquement). Query inconditionnelle (légère).
  const icps = useProjectQuery(api.icps.listIcps, {});
  // Batch B — listPresets sans args. Le filtre par mediaTypeScope se fait
  // côté client (cf `presets` ci-dessous). Le serveur Convex actuel attend
  // `args: {}` ; passer un arg avant le deploy v4 ferait reject le validator
  // strict. Une fois Convex déployé, on pourra repasser au filter serveur
  // (1 ligne à changer + index by_mediaTypeScope).
  const allPresets = useProjectQuery(api.filterPresets.listPresets, {});
  const deletePub = useProjectMutation(api.publications.deletePublication);
  const createPreset = useProjectMutation(api.filterPresets.createPreset);
  const deletePreset = useProjectMutation(api.filterPresets.deletePreset);

  // Strip v1/v2/v3 + filter par mediaType scope (v4 only). Avant deploy v4,
  // les presets existants n'ont ni schemaVersion=4 ni mediaTypeScope → la
  // PresetBar affiche "Aucun preset sauvegardé" temporairement, ce qui est
  // le comportement attendu de la migration.
  const presets = useMemo(
    () =>
      allPresets?.filter(
        (p) =>
          p.schemaVersion === PRESET_SCHEMA_VERSION &&
          p.mediaTypeScope === mediaType,
      ) ?? [],
    [allPresets, mediaType],
  );

  const currentFilters: TrackerFilters = useMemo(
    () => ({
      search,
      plateforme,
      statut: statutFilter,
      compte: setToSortedArray(compteFilter),
      mecanique: setToSortedArray(mecanique),
      format: setToSortedArray(format),
      verdict: setToSortedArray(verdictFilter),
    }),
    [
      search,
      plateforme,
      compteFilter,
      statutFilter,
      mecanique,
      format,
      verdictFilter,
    ],
  );
  const currentSort: TrackerSort = useMemo(
    () => ({ key: sortKey, dir: sortDir }),
    [sortKey, sortDir],
  );

  const matchingPreset = useMemo(() => {
    if (!presets.length) return null;
    return (
      presets.find(
        (p) =>
          filtersEqual(currentFilters, p.filters) &&
          sortsEqual(currentSort, p.sort),
      ) ?? null
    );
  }, [presets, currentFilters, currentSort]);

  const filtersAtDefault = isDefaultFilters(currentFilters);
  const sortAtDefault = sortsEqual(currentSort, DEFAULT_SORT);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetPopoverOpen, setPresetPopoverOpen] = useState(false);

  function applyPreset(p: (typeof presets)[number]) {
    setSearch(p.filters.search);
    setPlateforme(p.filters.plateforme);
    setStatutFilter(p.filters.statut);
    setCompteFilter(new Set(p.filters.compte));
    setMecanique(new Set(p.filters.mecanique));
    setFormat(new Set(p.filters.format));
    setVerdictFilter(new Set(p.filters.verdict));
    setSortKey(p.sort.key);
    setSortDir(p.sort.dir);
    setPresetPopoverOpen(false);
  }

  async function handleSavePreset() {
    setSavingPreset(true);
    try {
      await createPreset({
        name: presetName,
        mediaTypeScope: mediaType,
        filters: currentFilters,
        sort: currentSort,
      });
      toast.success(`Preset « ${presetName.trim()} » sauvegardé`);
      setSaveDialogOpen(false);
      setPresetName("");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Impossible de sauvegarder le preset",
      );
    } finally {
      setSavingPreset(false);
    }
  }

  async function handleDeletePreset(id: Id<"filterPresets">, name: string) {
    try {
      await deletePreset({ id });
      toast.success(`Preset « ${name} » supprimé`);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Impossible de supprimer le preset",
      );
    }
  }

  // Axes de tri désactivés selon le mediaType (Batch B : implicite par prop,
  // plus dérivé d'un filtre top-level). Carousel masque likes/subsGained ;
  // Short masque saveRate.
  const disabledSortKeys = useMemo<ReadonlySet<SortKey>>(() => {
    if (mediaType === "carousel") {
      return new Set<SortKey>(["likes", "subsGained"]);
    }
    // Short ET ScreenRecorder : pas de saveRate (carousel-only).
    return new Set<SortKey>(["saveRate"]);
  }, [mediaType]);

  // Auto-reset du tri si l'axe courant devient inapplicable. Au mount avec
  // un sortKey qu'on aurait restauré d'un preset périmé, ou si TrackerListSection
  // est remonté sur un autre format. Handler-only suffirait normalement, mais
  // on protège aussi au mount initial.
  useEffect(() => {
    if (disabledSortKeys.has(sortKey)) {
      // Reset coordonné des 2 axes : un seul disable couvre les 2 setState
      // consécutifs (eslint signale le 1er seulement si non disabled).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSortKey("date");
      setSortDir("desc");
    }
  }, [disabledSortKeys, sortKey]);

  const visibleColumns = useMemo<ReadonlySet<ColumnKey>>(
    () => new Set(columnsForMediaType(mediaType)),
    [mediaType],
  );

  // Batch E — publications du format (non filtrées par les filtres internes).
  // Source de vérité pour AnalyticsSection. `filtered` ci-dessous applique en
  // plus la barre de filtres et nourrit la liste tracker uniquement.
  const publicationsForFormat = useMemo(
    () =>
      (publications ?? []).filter((p) => getMediaType(p) === mediaType),
    [publications, mediaType],
  );

  const filtered = useMemo(() => {
    if (!publications) return [];
    // Filtre format implicite : 1ère étape du pipeline.
    let list = publications.filter((p) => getMediaType(p) === mediaType);
    if (carouselIdParam) {
      list = list.filter((p) => p.carouselId === carouselIdParam);
    }
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      // Recherche étendue : hook + carouselId + sourceId (anti-shadowban).
      list = list.filter((p) =>
        `${p.hookText} ${p.carouselId} ${p.sourceId ?? ""}`
          .toLowerCase()
          .includes(q),
      );
    }
    if (plateforme !== ALL)
      list = list.filter((p) => p.plateforme === plateforme);
    if (compteFilter.size > 0)
      list = list.filter((p) => compteFilter.has(p.compte));
    if (statutFilter !== ALL) {
      list = list.filter((p) =>
        statutFilter === STATUT_PUBLISHED ? isPublished(p) : !isPublished(p),
      );
    }
    if (mecanique.size > 0)
      list = list.filter((p) => mecanique.has(p.mecanique));
    if (format.size > 0) list = list.filter((p) => format.has(p.format ?? ""));
    if (verdictFilter.size > 0) {
      list = list.filter((p) => {
        const dm = metricsOf(p);
        const v = isPublished(p)
          ? calculateVerdict(calculateSaveRate(dm.saves, dm.vues))
          : null;
        if (v === null) return verdictFilter.has(PENDING);
        return verdictFilter.has(v);
      });
    }
    // Refinement SR — filtres SR-specific. N'ont d'effet que sur
    // mediaType=screenrecorder (les autres rows n'ont pas ces champs).
    if (recordingDeviceFilter.size > 0) {
      list = list.filter(
        (p) =>
          p.recordingDevice !== undefined &&
          recordingDeviceFilter.has(p.recordingDevice),
      );
    }
    if (repackagingFilter !== ALL) {
      const wantRepack = repackagingFilter === "repack";
      list = list.filter((p) => p.isRepackaging === wantRepack);
    }
    // Refinement Shorts — filtre ICP (n'a d'effet que pour les Shorts ; les
    // autres formats n'ont pas d'icpId).
    if (icpFilter.size > 0) {
      list = list.filter(
        (p) => p.icpId !== undefined && icpFilter.has(p.icpId),
      );
    }

    const sorted = [...list].sort((a, b) => {
      const ra = getSortValue(a, sortKey);
      const rb = getSortValue(b, sortKey);
      let cmp = 0;
      if (ra === null && rb === null) cmp = 0;
      else if (ra === null) cmp = 1;
      else if (rb === null) cmp = -1;
      else cmp = ra - rb;
      const directional = sortDir === "asc" ? cmp : -cmp;
      if (directional !== 0 || sortKey === "date") return directional;
      return b.datePubli - a.datePubli;
    });
    return sorted;
  }, [
    publications,
    mediaType,
    carouselIdParam,
    debouncedSearch,
    plateforme,
    compteFilter,
    statutFilter,
    mecanique,
    format,
    verdictFilter,
    recordingDeviceFilter,
    repackagingFilter,
    icpFilter,
    sortKey,
    sortDir,
  ]);

  const drafts = useMemo(
    () => filtered.filter((p) => !isPublished(p)),
    [filtered],
  );
  const published = useMemo(
    () => filtered.filter((p) => isPublished(p)),
    [filtered],
  );

  const stats = useMemo(() => {
    if (!publications) {
      return {
        publishedCount: 0,
        draftCount: 0,
        vuesTotal: 0,
        avgSaveRate: null as number | null,
        winners: 0,
      };
    }
    const formatPubs = publications.filter(
      (p) => getMediaType(p) === mediaType,
    );
    const publishedPubs = formatPubs.filter(isPublished);
    const draftCount = formatPubs.length - publishedPubs.length;
    let vuesTotal = 0;
    const rates: number[] = [];
    let winners = 0;
    for (const p of publishedPubs) {
      const dm = metricsOf(p);
      if (dm.vues !== null) vuesTotal += dm.vues;
      const r = calculateSaveRate(dm.saves, dm.vues);
      if (r !== null) rates.push(r);
      if (calculateVerdict(r) === "WINNER") winners++;
    }
    const avgSaveRate =
      rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
    return {
      publishedCount: publishedPubs.length,
      draftCount,
      vuesTotal,
      avgSaveRate,
      winners,
    };
  }, [publications, mediaType]);

  function reset() {
    setSearch("");
    setPlateforme(ALL);
    setStatutFilter(ALL);
    setCompteFilter(new Set());
    setMecanique(new Set());
    setFormat(new Set());
    setVerdictFilter(new Set());
    setRecordingDeviceFilter(new Set());
    setRepackagingFilter(ALL);
    setIcpFilter(new Set());
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  async function handleConfirmDelete() {
    if (!deletingPub) return;
    setDeleting(true);
    try {
      await deletePub({ id: deletingPub._id });
      toast.success(
        `${deletingPub.carouselId} (${deletingPub.plateforme}) supprimé`,
      );
      setDeletingPub(null);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Erreur lors de la suppression",
      );
    } finally {
      setDeleting(false);
    }
  }

  if (publications === undefined) return <LoadingState />;

  // Plateformes éligibles dans le filtre selon le format. Carousel masque
  // YouTube ; short et screenrecorder autorisent les 3.
  const platformOptions =
    mediaType === "carousel"
      ? [...ALLOWED_PLATFORMS_FOR_CAROUSEL]
      : mediaType === "screenrecorder"
        ? [...ALLOWED_PLATFORMS_FOR_SCREENRECORDER]
        : [...ALLOWED_PLATFORMS_FOR_SHORT];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end">
        <SnapshotAgeSelector />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Publiés"
          value={String(stats.publishedCount)}
          secondary={
            stats.draftCount > 0 ? `+${stats.draftCount} à venir` : undefined
          }
        />
        <StatCard label="Vues totales" value={formatNumber(stats.vuesTotal)} />
        {mediaType === "carousel" ? (
          <>
            <StatCard
              label="Save rate moyen"
              value={formatPercent(stats.avgSaveRate)}
            />
            <StatCard
              label="Winners"
              value={String(stats.winners)}
              highlight={stats.winners > 0}
            />
          </>
        ) : (
          // Pour les Shorts, les KPI Save rate / Winners n'ont pas de sens
          // (pas de saves). On les remplace par 2 placeholders simples ;
          // l'analytics chart configurable du Batch E les complétera.
          <>
            <StatCard label="Save rate moyen" value="—" />
            <StatCard label="Winners" value="—" />
          </>
        )}
      </div>

      <PresetBar
        presets={presets}
        matchingPreset={matchingPreset}
        filtersAtDefault={filtersAtDefault && sortAtDefault}
        popoverOpen={presetPopoverOpen}
        onPopoverChange={setPresetPopoverOpen}
        onApply={applyPreset}
        onDelete={handleDeletePreset}
        onSaveClick={() => {
          setPresetName(matchingPreset?.name ?? "");
          setSaveDialogOpen(true);
        }}
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-600">
            Recherche
          </label>
          <Input
            placeholder="Hook text..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FilterSelect
          label="Plateforme"
          value={plateforme}
          onChange={setPlateforme}
          options={platformOptions}
          allLabel="Toutes"
          width="w-[140px]"
        />
        <FilterMultiSelect
          label="Compte"
          selectedValues={compteFilter}
          onChange={setCompteFilter}
          options={(comptes ?? []).map((c) => ({
            value: c.handle,
            label: c.handle,
          }))}
          allLabel="Tous"
          width="w-[180px]"
        />
        <FilterSelect
          label="Statut"
          value={statutFilter}
          onChange={setStatutFilter}
          options={[STATUT_PUBLISHED, STATUT_DRAFT]}
          allLabel="Tous"
          width="w-[120px]"
        />
        {/*
          Refinement SR + Shorts — Mécanique réservée au Carrousel désormais
          (concept hook-level retiré pour SR ET Short). Pour SR : filtres
          Appareil + Repackaging. Pour Short : filtre ICP.
        */}
        {mediaType === "carousel" && (
          <FilterMultiSelect
            label="Mécanique"
            selectedValues={mecanique}
            onChange={setMecanique}
            options={MECANIQUES.map((m) => ({ value: m, label: m }))}
            allLabel="Toutes"
            width="w-[160px]"
          />
        )}
        {mediaType === "short" && (
          <FilterMultiSelect
            label="ICP"
            selectedValues={icpFilter}
            onChange={setIcpFilter}
            options={(icps ?? []).map((i) => ({
              value: i._id,
              label: i.nom,
            }))}
            allLabel="Tous"
            width="w-[180px]"
          />
        )}
        {mediaType === "carousel" && (
          <>
            <FilterMultiSelect
              label="Format"
              selectedValues={format}
              onChange={setFormat}
              options={FORMATS.map((f) => ({ value: f, label: f }))}
              allLabel="Tous"
              width="w-[100px]"
            />
            <FilterMultiSelect
              label="Verdict"
              selectedValues={verdictFilter}
              onChange={setVerdictFilter}
              options={["WINNER", "MOYEN", "FOLD", PENDING].map((v) => ({
                value: v,
                label: v,
              }))}
              allLabel="Tous"
              width="w-[140px]"
            />
          </>
        )}
        {mediaType === "screenrecorder" && (
          <>
            <FilterMultiSelect
              label="Appareil"
              selectedValues={recordingDeviceFilter}
              onChange={setRecordingDeviceFilter}
              options={RECORDING_DEVICES.map((d) => ({
                value: d,
                label: RECORDING_DEVICE_LABELS[d],
              }))}
              allLabel="Tous"
              width="w-[160px]"
            />
            <FilterSelect
              label="Type"
              value={repackagingFilter}
              onChange={setRepackagingFilter}
              options={["repack", "other"]}
              allLabel="Tous"
              width="w-[140px]"
            />
          </>
        )}
        <Button variant="outline" size="sm" onClick={reset}>
          Reset
        </Button>
      </div>

      {carouselIdParam && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
          <div>
            {filtered.length === 0 ? (
              <>
                Aucun{" "}
                {FORMAT_CONFIGS[mediaType].singular.toLowerCase()} trouvé pour{" "}
                <span className="font-mono font-semibold">
                  {carouselIdParam}
                </span>
              </>
            ) : (
              <>
                Filtré sur le{" "}
                {FORMAT_CONFIGS[mediaType].singular.toLowerCase()}{" "}
                <span className="font-mono font-semibold">
                  {carouselIdParam}
                </span>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-violet-700 hover:bg-violet-100 hover:text-violet-900"
            onClick={() =>
              router.replace(projectPath(FORMAT_CONFIGS[mediaType].route))
            }
          >
            Effacer
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyOrFiltered
          publishedCount={stats.publishedCount + stats.draftCount}
          mediaType={mediaType}
          onReset={reset}
        />
      ) : (
        <div className="space-y-6">
          {drafts.length > 0 && (
            <PublicationsSection
              title="À venir"
              dotClass="bg-amber-500"
              rows={drafts}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              onView={setViewingPub}
              onEdit={setEditingPub}
              onDelete={setDeletingPub}
              onMarkAsPosted={setMarkingPub}
              onDuplicate={setDuplicatingPub}
              visibleColumns={visibleColumns}
              disabledSortKeys={disabledSortKeys}
              idColumnLabel={getIdColumnLabel(mediaType)}
            />
          )}
          {published.length > 0 && (
            <PublicationsSection
              title="Publié"
              dotClass="bg-emerald-500"
              rows={published}
              sortKey={sortKey}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              onView={setViewingPub}
              onEdit={setEditingPub}
              onDelete={setDeletingPub}
              onMarkAsPosted={setMarkingPub}
              onDuplicate={setDuplicatingPub}
              visibleColumns={visibleColumns}
              disabledSortKeys={disabledSortKeys}
              idColumnLabel={getIdColumnLabel(mediaType)}
            />
          )}
        </div>
      )}

      {editingPub && (
        <PublicationEditDialog
          key={editingPub._id}
          publication={editingPub}
          open={true}
          onOpenChange={(o) => !o && setEditingPub(null)}
        />
      )}

      {viewingPub && (
        <PublicationDetailDialog
          key={viewingPub._id}
          publication={viewingPub}
          open={true}
          onOpenChange={(o) => !o && setViewingPub(null)}
          onEdit={() => {
            setEditingPub(viewingPub);
            setViewingPub(null);
          }}
        />
      )}

      <Dialog
        open={!!deletingPub}
        onOpenChange={(o) => !o && !deleting && setDeletingPub(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer cette publication ?</DialogTitle>
            <DialogDescription>
              {deletingPub?.carouselId} ({deletingPub?.plateforme}) — cette
              action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingPub(null)}
              disabled={deleting}
            >
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={saveDialogOpen}
        onOpenChange={(o) => !o && !savingPreset && setSaveDialogOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sauvegarder ce preset</DialogTitle>
            <DialogDescription>
              Donne un nom à cette combinaison de filtres + tri pour la
              recharger plus tard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="preset-name">Nom du preset</Label>
            <Input
              id="preset-name"
              placeholder="Ex: Top winners FR"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && presetName.trim().length > 0) {
                  handleSavePreset();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSaveDialogOpen(false)}
              disabled={savingPreset}
            >
              Annuler
            </Button>
            <Button
              onClick={handleSavePreset}
              disabled={savingPreset || presetName.trim().length === 0}
            >
              {savingPreset && (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              )}
              Sauvegarder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {markingPub && (
        <MarkAsPostedDialog
          key={markingPub._id}
          publication={markingPub}
          open={true}
          onOpenChange={(o) => !o && setMarkingPub(null)}
        />
      )}

      {duplicatingPub && (
        <DuplicateCarouselDialog
          key={duplicatingPub._id}
          publication={duplicatingPub}
          open={true}
          onOpenChange={(o) => !o && setDuplicatingPub(null)}
        />
      )}

      {/*
        Batch E — AnalyticsSection en bas de page. Décision tranchée :
        l'analytics consomme TOUTES les publications du format (publicationsForFormat
        ci-dessus), PAS le sous-ensemble filtré (filtered) par les filtres
        internes du tracker. Rationale : l'analytics est une vue stratégique
        globale du format ; si l'utilisateur veut zoomer, la liste filtrée
        au-dessus est la zone d'investigation. Filtrer l'analytics par les
        filtres internes mélangerait les 2 mental models et casserait la
        consistance avec les dashboards classiques (Google Analytics, etc.).
      */}
      <AnalyticsSection
        publications={publicationsForFormat}
        mediaType={mediaType}
      />
    </div>
  );
}

const NA_CELL = <span className="text-slate-400">—</span>;

function PublicationsSection({
  title,
  dotClass,
  rows,
  sortKey,
  sortDir,
  onToggleSort,
  onView,
  onEdit,
  onDelete,
  onMarkAsPosted,
  onDuplicate,
  visibleColumns,
  disabledSortKeys,
  idColumnLabel,
}: {
  title: string;
  dotClass: string;
  rows: Doc<"publications">[];
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (k: SortKey) => void;
  onView: (p: Doc<"publications">) => void;
  onEdit: (p: Doc<"publications">) => void;
  onDelete: (p: Doc<"publications">) => void;
  onMarkAsPosted: (p: Doc<"publications">) => void;
  onDuplicate: (p: Doc<"publications">) => void;
  visibleColumns: ReadonlySet<ColumnKey>;
  disabledSortKeys: ReadonlySet<SortKey>;
  idColumnLabel: string;
}) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <span className={cn("inline-block size-2 rounded-full", dotClass)} />
        {title}
        <span className="font-normal text-slate-500">({rows.length})</span>
      </h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              {visibleColumns.has("date") && (
                <SortableHead
                  active={sortKey === "date"}
                  dir={sortDir}
                  onClick={() => onToggleSort("date")}
                  disabled={disabledSortKeys.has("date")}
                >
                  Date
                </SortableHead>
              )}
              {visibleColumns.has("image") && (
                <TableHead className="w-14">Image</TableHead>
              )}
              {visibleColumns.has("carouselId") && (
                <TableHead>{idColumnLabel}</TableHead>
              )}
              {visibleColumns.has("source") && <TableHead>Source</TableHead>}
              {visibleColumns.has("hook") && <TableHead>Hook</TableHead>}
              {visibleColumns.has("titre") && (
                <TableHead>Titre</TableHead>
              )}
              {visibleColumns.has("recordingDevice") && (
                <TableHead>Appareil</TableHead>
              )}
              {visibleColumns.has("isRepackaging") && (
                <TableHead>Repackaging</TableHead>
              )}
              {visibleColumns.has("plateforme") && (
                <TableHead>Plateforme</TableHead>
              )}
              {visibleColumns.has("compte") && <TableHead>Compte</TableHead>}
              {visibleColumns.has("icp") && <TableHead>ICP</TableHead>}
              {visibleColumns.has("mecanique") && (
                <TableHead>Mécanique</TableHead>
              )}
              {visibleColumns.has("format") && <TableHead>Format</TableHead>}
              {visibleColumns.has("angle") && <TableHead>Angle</TableHead>}
              {visibleColumns.has("vues") && (
                <SortableHead
                  active={sortKey === "vues"}
                  dir={sortDir}
                  onClick={() => onToggleSort("vues")}
                  disabled={disabledSortKeys.has("vues")}
                  className="text-right"
                >
                  Vues
                </SortableHead>
              )}
              {visibleColumns.has("saves") && (
                <TableHead className="text-right">Saves</TableHead>
              )}
              {visibleColumns.has("saveRate") && (
                <SortableHead
                  active={sortKey === "saveRate"}
                  dir={sortDir}
                  onClick={() => onToggleSort("saveRate")}
                  disabled={disabledSortKeys.has("saveRate")}
                  className="text-right"
                >
                  Save rate
                </SortableHead>
              )}
              {visibleColumns.has("verdict") && (
                <TableHead>Verdict</TableHead>
              )}
              {visibleColumns.has("likes") && (
                <SortableHead
                  active={sortKey === "likes"}
                  dir={sortDir}
                  onClick={() => onToggleSort("likes")}
                  disabled={disabledSortKeys.has("likes")}
                  className="text-right"
                >
                  Likes
                </SortableHead>
              )}
              {visibleColumns.has("subsGained") && (
                <SortableHead
                  active={sortKey === "subsGained"}
                  dir={sortDir}
                  onClick={() => onToggleSort("subsGained")}
                  disabled={disabledSortKeys.has("subsGained")}
                  className="text-right"
                >
                  Subs gained
                </SortableHead>
              )}
              {visibleColumns.has("actions") && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              const dm = metricsOf(p);
              const saveRate = calculateSaveRate(dm.saves, dm.vues);
              const verdict = isPublished(p)
                ? calculateVerdict(saveRate)
                : null;
              const snapTitle = dm.snapshotUsed
                ? `Snapshot J+${dm.snapshotUsed.daysSincePublication} capturé le ${formatDate(dm.snapshotUsed.capturedAt)}${dm.matchExact ? "" : " (proche)"}`
                : "Aucun snapshot pour cette période";
              const mt = getMediaType(p);
              const isShort = mt === "short";
              const isCarousel = mt === "carousel";
              // listPublications enrichit chaque row avec icp { nom, color }.
              const icp =
                (p as { icp?: { nom: string; color: string | null } | null })
                  .icp ?? null;
              return (
                <TableRow key={p._id}>
                  {visibleColumns.has("date") && (
                    <TableCell className="whitespace-nowrap text-xs text-slate-600">
                      {formatDate(p.datePubli)}
                    </TableCell>
                  )}
                  {visibleColumns.has("image") && (
                    <TableCell className="w-14">
                      {(p as { imageUrl?: string | null }).imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={
                            (p as { imageUrl?: string | null }).imageUrl ?? ""
                          }
                          alt={p.titre ?? "image"}
                          className="size-10 rounded object-cover"
                        />
                      ) : (
                        <div className="size-10 rounded bg-slate-100" />
                      )}
                    </TableCell>
                  )}
                  {visibleColumns.has("carouselId") && (
                    <TableCell className="font-mono text-xs">
                      {p.carouselId}
                    </TableCell>
                  )}
                  {visibleColumns.has("source") && (
                    <TableCell className="text-xs">
                      {p.sourceId ? (
                        <span className="font-mono">{p.sourceId}</span>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 text-amber-700"
                        >
                          ⚠ sans source
                        </Badge>
                      )}
                    </TableCell>
                  )}
                  {visibleColumns.has("hook") && (
                    <TableCell
                      className="max-w-[280px] truncate text-sm"
                      title={p.hookText}
                    >
                      {p.hookText.length > 60
                        ? p.hookText.slice(0, 60) + "…"
                        : p.hookText}
                    </TableCell>
                  )}
                  {visibleColumns.has("titre") && (
                    <TableCell
                      className="max-w-[200px] truncate text-sm font-medium"
                      title={p.titre ?? ""}
                    >
                      {p.titre ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                  )}
                  {visibleColumns.has("recordingDevice") && (
                    <TableCell>
                      {p.recordingDevice ? (
                        <RecordingDeviceBadge
                          device={p.recordingDevice}
                        />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                  )}
                  {visibleColumns.has("isRepackaging") && (
                    <TableCell>
                      {p.isRepackaging === true ? (
                        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          Repack
                        </Badge>
                      ) : p.isRepackaging === false ? (
                        <Badge variant="outline" className="text-slate-600">
                          Autre
                        </Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                  )}
                  {visibleColumns.has("plateforme") && (
                    <TableCell>
                      <PlatformBadge plateforme={p.plateforme} />
                    </TableCell>
                  )}
                  {visibleColumns.has("compte") && (
                    <TableCell className="font-mono text-xs">
                      {p.compte}
                    </TableCell>
                  )}
                  {visibleColumns.has("icp") && (
                    <TableCell>
                      {icp ? (
                        <Badge
                          variant="outline"
                          className="gap-1.5 text-slate-700"
                        >
                          <span
                            className={cn(
                              "size-2 rounded-full",
                              getFolderColor(icp.color).dotClass,
                            )}
                          />
                          <span className="max-w-[120px] truncate">
                            {icp.nom}
                          </span>
                        </Badge>
                      ) : (
                        NA_CELL
                      )}
                    </TableCell>
                  )}
                  {visibleColumns.has("mecanique") && (
                    <TableCell className="text-xs">{p.mecanique}</TableCell>
                  )}
                  {visibleColumns.has("format") && (
                    <TableCell className="font-mono text-xs">
                      {isShort ? NA_CELL : (p.format ?? NA_CELL)}
                    </TableCell>
                  )}
                  {visibleColumns.has("angle") && (
                    <TableCell className="text-xs">{p.angleTonal}</TableCell>
                  )}
                  {visibleColumns.has("vues") && (
                    <TableCell
                      className="text-right tabular-nums text-xs"
                      title={snapTitle}
                    >
                      {formatNumber(dm.vues)}
                      {dm.snapshotUsed && !dm.matchExact && (
                        <span className="ml-0.5 text-slate-400">≈</span>
                      )}
                    </TableCell>
                  )}
                  {visibleColumns.has("saves") && (
                    <TableCell className="text-right tabular-nums text-xs">
                      {isShort ? NA_CELL : formatNumber(dm.saves)}
                    </TableCell>
                  )}
                  {visibleColumns.has("saveRate") && (
                    <TableCell
                      className={cn(
                        "text-right tabular-nums text-xs",
                        saveRate === null && "italic text-slate-400",
                      )}
                    >
                      {isShort ? NA_CELL : formatPercent(saveRate)}
                    </TableCell>
                  )}
                  {visibleColumns.has("verdict") && (
                    <TableCell>
                      {isShort ? NA_CELL : <VerdictBadge verdict={verdict} />}
                    </TableCell>
                  )}
                  {visibleColumns.has("likes") && (
                    <TableCell className="text-right tabular-nums text-xs">
                      {isCarousel ? NA_CELL : formatNumber(dm.likes)}
                    </TableCell>
                  )}
                  {visibleColumns.has("subsGained") && (
                    <TableCell className="text-right tabular-nums text-xs">
                      {isCarousel ? NA_CELL : formatNumber(dm.subsGained)}
                    </TableCell>
                  )}
                  {visibleColumns.has("actions") && (
                    <TableCell className="w-8">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon-sm">
                              <MoreHorizontalIcon />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          {!isPublished(p) && (
                            <DropdownMenuItem
                              onClick={() => onMarkAsPosted(p)}
                              className="font-medium"
                            >
                              Marquer comme posté
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => onView(p)}>
                            {isPublished(p)
                              ? "Voir détail"
                              : "Voir détail / éditer"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onEdit(p)}
                            disabled={!isPublished(p)}
                            title={
                              !isPublished(p)
                                ? "Publiez d'abord pour saisir les stats"
                                : undefined
                            }
                          >
                            Mettre à jour stats
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onDuplicate(p)}>
                            Dupliquer
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-rose-600 focus:text-rose-700"
                            onClick={() => onDelete(p)}
                          >
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function MarkAsPostedDialog({
  publication,
  open,
  onOpenChange,
}: {
  publication: Doc<"publications">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const updateMetrics = useProjectMutation(api.publications.updateMetrics);

  const trimmed = url.trim();
  const canSubmit = trimmed.startsWith("http") && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await updateMetrics({ id: publication._id, postUrl: trimmed });
      toast.success("Publication marquée comme publiée");
      onOpenChange(false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Impossible de marquer comme publié",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marquer comme posté</DialogTitle>
          <DialogDescription>
            {publication.carouselId} ({publication.plateforme}) — colle le lien
            de la publication. Les métriques se saisissent ensuite via « Mettre
            à jour stats ».
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="mark-posted-url">Lien de publication</Label>
          <Input
            id="mark-posted-url"
            type="url"
            placeholder="https://www.tiktok.com/@... ou https://www.instagram.com/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) handleSubmit();
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DuplicateCarouselDialog({
  publication,
  open,
  onOpenChange,
}: {
  publication: Doc<"publications">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sourceMediaType = getMediaType(publication);
  const allowedPlatforms =
    sourceMediaType === "carousel"
      ? ALLOWED_PLATFORMS_FOR_CAROUSEL
      : sourceMediaType === "screenrecorder"
        ? ALLOWED_PLATFORMS_FOR_SCREENRECORDER
        : ALLOWED_PLATFORMS_FOR_SHORT;
  type TargetPlateforme = "" | "TikTok" | "Instagram" | "YouTube";

  const [plateforme, setPlateforme] = useState<TargetPlateforme>("");
  const [compte, setCompte] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const comptesData = useProjectQuery(api.comptes.listComptes, { actifOnly: true });
  const filteredComptes = useMemo(
    () =>
      plateforme === ""
        ? []
        : (comptesData ?? []).filter((c) => c.plateforme === plateforme),
    [comptesData, plateforme],
  );

  const duplicate = useProjectMutation(api.publications.duplicateCarousel);

  function handlePlateformeChange(next: "TikTok" | "Instagram" | "YouTube") {
    setPlateforme(next);
    if (!comptesData) {
      setCompte("");
      return;
    }
    const stillValid = comptesData.some(
      (c) => c.handle === compte && c.plateforme === next,
    );
    if (!stillValid) setCompte("");
  }

  const canSubmit = plateforme !== "" && compte !== "" && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await duplicate({
        sourceCarouselId: publication.carouselId,
        targetCompte: compte,
        targetPlateforme: plateforme as "TikTok" | "Instagram" | "YouTube",
      });
      toast.success("Publication dupliquée");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de dupliquer");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dupliquer {publication.carouselId}</DialogTitle>
          <DialogDescription>
            Crée un nouveau brouillon avec les mêmes slides et hook. Choisis la
            plateforme et le compte cibles.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dup-plateforme">Plateforme cible</Label>
            <Select
              value={plateforme}
              onValueChange={(v) =>
                v !== null &&
                handlePlateformeChange(v as "TikTok" | "Instagram" | "YouTube")
              }
            >
              <SelectTrigger id="dup-plateforme">
                <SelectValue placeholder="Sélectionner...">
                  {plateforme || "Sélectionner..."}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {allowedPlatforms.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dup-compte">Compte cible</Label>
            {plateforme === "" ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
                Sélectionne d&apos;abord une plateforme.
              </p>
            ) : comptesData === undefined ? (
              <div className="h-9 animate-pulse rounded-md bg-slate-100" />
            ) : filteredComptes.length === 0 ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                Aucun compte actif sur {plateforme}.
              </p>
            ) : (
              <Select
                value={compte}
                onValueChange={(v) => v !== null && setCompte(v)}
              >
                <SelectTrigger id="dup-compte">
                  <SelectValue placeholder="Sélectionner...">
                    {compte || "Sélectionner..."}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {filteredComptes.map((c) => (
                    <SelectItem key={c._id} value={c.handle}>
                      <span className="font-mono">{c.handle}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PresetBar({
  presets,
  matchingPreset,
  filtersAtDefault,
  popoverOpen,
  onPopoverChange,
  onApply,
  onDelete,
  onSaveClick,
}: {
  presets: Doc<"filterPresets">[];
  matchingPreset: Doc<"filterPresets"> | null;
  filtersAtDefault: boolean;
  popoverOpen: boolean;
  onPopoverChange: (o: boolean) => void;
  onApply: (p: Doc<"filterPresets">) => void;
  onDelete: (id: Id<"filterPresets">, name: string) => void;
  onSaveClick: () => void;
}) {
  const triggerLabel = matchingPreset
    ? matchingPreset.name
    : filtersAtDefault
      ? "Charger un preset"
      : "(custom)";

  const saveDisabled = filtersAtDefault;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={popoverOpen} onOpenChange={onPopoverChange}>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="gap-2 font-normal">
              <BookmarkIcon className="size-3.5" />
              <span className="text-slate-700">{triggerLabel}</span>
              <ChevronDownIcon className="size-3.5 opacity-60" />
            </Button>
          }
        />
        <PopoverContent className="w-[260px] p-1" align="start">
          {presets.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-slate-500">
              Aucun preset sauvegardé.
            </div>
          ) : (
            <ul className="space-y-0.5">
              {presets.map((p) => {
                const isActive = matchingPreset?._id === p._id;
                return (
                  <li
                    key={p._id}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-1 py-0.5 text-sm",
                      isActive ? "bg-slate-100" : "hover:bg-slate-50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onApply(p)}
                      className="flex-1 truncate px-2 py-1 text-left"
                    >
                      {p.name}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(p._id, p.name);
                      }}
                      className="rounded p-1 text-slate-400 opacity-60 hover:bg-rose-50 hover:text-rose-600 hover:opacity-100"
                      aria-label={`Supprimer le preset ${p.name}`}
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      <Button
        variant="outline"
        size="sm"
        onClick={onSaveClick}
        disabled={saveDisabled}
        title={
          saveDisabled
            ? "Configure d'abord des filtres ou un tri à sauvegarder"
            : undefined
        }
        className="gap-1.5"
      >
        <PlusIcon className="size-3.5" />
        Sauvegarder ce preset
      </Button>
    </div>
  );
}

function SortableHead({
  children,
  active,
  dir,
  onClick,
  className,
  disabled = false,
}: {
  children: React.ReactNode;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        title={disabled ? "Tri non applicable au format actuel" : undefined}
        className={cn(
          "inline-flex items-center gap-1",
          disabled
            ? "cursor-not-allowed text-slate-400"
            : "hover:text-slate-900",
        )}
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

function StatCard({
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
              "text-2xl font-bold tabular-nums",
              highlight ? "text-emerald-600" : "text-slate-900",
            )}
          >
            {value}
          </div>
          {secondary && (
            <div className="text-xs font-medium text-slate-500">
              {secondary}
            </div>
          )}
        </div>
        <div className="text-xs text-slate-500">{label}</div>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function EmptyOrFiltered({
  publishedCount,
  mediaType,
  onReset,
}: {
  publishedCount: number;
  mediaType: MediaType;
  onReset: () => void;
}) {
  // publishedCount === 0 : aucune publication de ce format en DB → état initial.
  // > 0 : il y en a, mais aucune ne matche les filtres courants.
  if (publishedCount === 0) {
    const label = FORMAT_CONFIGS[mediaType].singular;
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white py-16 text-center">
        <p className="text-sm text-slate-500">
          Aucun {label} pour l&apos;instant.
        </p>
        <p className="text-xs text-slate-400">
          Utilise le bouton « Nouveau » pour créer ton premier {label}.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white py-16">
      <p className="text-sm text-slate-500">
        Aucune publication ne correspond à ces filtres.
      </p>
      <Button variant="outline" size="sm" onClick={onReset}>
        Reset les filtres
      </Button>
    </div>
  );
}
