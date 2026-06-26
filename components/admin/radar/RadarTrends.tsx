"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import {
  useProjectAction,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
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
  AlertCircleIcon,
  ChevronDownIcon,
  MinusIcon,
  RefreshCwIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { convexErrorMessage } from "@/lib/convex-error";
import {
  RadarVideoGrid,
  type RadarCardVideo,
  type RadarViewMode,
} from "./RadarVideoGrid";
import { RadarViewToggle } from "./RadarVideoWall";
import { formatCount, formatRelative } from "./radar-format";

const DAY_MS = 86_400_000;

/** Libellés FR (drapeau + nom) des pays supportés. Fallback = le code. */
const COUNTRY_LABELS: Record<string, string> = {
  US: "🇺🇸 États-Unis",
  FR: "🇫🇷 France",
  GB: "🇬🇧 Royaume-Uni",
  DE: "🇩🇪 Allemagne",
  ES: "🇪🇸 Espagne",
  IT: "🇮🇹 Italie",
  CA: "🇨🇦 Canada",
  AU: "🇦🇺 Australie",
  BR: "🇧🇷 Brésil",
  AR: "🇦🇷 Argentine",
};

type TrendData = FunctionReturnType<typeof api.radar.listTrendHashtags>;
type TrendHashtag = TrendData["hashtags"][number];
type VideoStatus = "loading" | "error" | "ok";

export function RadarTrends() {
  const [country, setCountry] = useState("US");
  const [view, setView] = useState<RadarViewMode>("grid");
  const [openHashtag, setOpenHashtag] = useState<string | null>(null);
  const [hashtagsLoading, setHashtagsLoading] = useState(false);
  // Statut de fetch des vidéos par hashtag (clé = hashtag) — chargement à la demande.
  const [videoStatus, setVideoStatus] = useState<Record<string, VideoStatus>>({});

  const countries = useProjectQuery(api.radar.listTrendCountries, {});
  const data = useProjectQuery(api.radar.listTrendHashtags, { countryCode: country });
  const fetchHashtags = useProjectAction(api.radar.fetchTrendHashtags);
  const fetchVideos = useProjectAction(api.radar.fetchTrendVideos);

  async function loadHashtags() {
    setHashtagsLoading(true);
    try {
      await fetchHashtags({ countryCode: country });
    } catch (e) {
      toast.error(convexErrorMessage(e, "Chargement des tendances impossible."));
    } finally {
      setHashtagsLoading(false);
    }
  }

  // Charge les vidéos d'un hashtag (event handler → pas de setState-in-effect).
  async function loadVideos(hashtag: string) {
    setVideoStatus((s) => ({ ...s, [hashtag]: "loading" }));
    try {
      const r = await fetchVideos({ countryCode: country, hashtag });
      setVideoStatus((s) => ({ ...s, [hashtag]: r.ok ? "ok" : "error" }));
    } catch {
      setVideoStatus((s) => ({ ...s, [hashtag]: "error" }));
    }
  }

  function toggleHashtag(h: TrendHashtag) {
    if (openHashtag === h.hashtag) {
      setOpenHashtag(null);
      return;
    }
    setOpenHashtag(h.hashtag);
    // 1er affichage → fetch si pas en cache (videosFetchedAt) et pas déjà tenté.
    if (h.videosFetchedAt == null && videoStatus[h.hashtag] === undefined) {
      void loadVideos(h.hashtag);
    }
  }

  // Auto-chargement à l'ouverture / changement de pays SI le cache est vide ou
  // vieux (> 24 h). Une fois par pays (ref) → pas de boucle ; « Actualiser » force.
  const autoLoaded = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (data === undefined) return;
    if (autoLoaded.current.has(country)) return;
    autoLoaded.current.add(country);
    const stale = data.fetchedAt == null || Date.now() - data.fetchedAt > DAY_MS;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stale) void loadHashtags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, data === undefined]);

  function onCountryChange(cc: string) {
    setCountry(cc);
    setOpenHashtag(null);
    setVideoStatus({});
  }

  const countryOptions = useMemo(
    () => countries ?? Object.keys(COUNTRY_LABELS),
    [countries],
  );

  const hashtags = data?.hashtags;
  const showSkeleton =
    hashtags === undefined || (hashtagsLoading && hashtags.length === 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select value={country} onValueChange={(v) => v && onCountryChange(v)}>
          <SelectTrigger className="w-52" aria-label="Pays des tendances">
            <SelectValue>{COUNTRY_LABELS[country] ?? country}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {countryOptions.map((cc) => (
              <SelectItem key={cc} value={cc}>
                {COUNTRY_LABELS[cc] ?? cc}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            7 derniers jours
            {data?.fetchedAt != null && ` · maj ${formatRelative(data.fetchedAt)}`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadHashtags}
            disabled={hashtagsLoading}
            className="gap-1.5"
          >
            <RefreshCwIcon
              className={cn("size-4", hashtagsLoading && "animate-spin")}
            />
            Actualiser
          </Button>
        </div>
      </div>

      {showSkeleton ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : hashtags.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
          <TrendingUpIcon className="size-12 text-slate-300" strokeWidth={1.5} />
          <p className="text-sm text-slate-500">
            Aucun hashtag tendance en cache pour ce pays. Clique « Actualiser ».
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {hashtags.map((h) => (
            <HashtagRow
              key={h._id}
              hashtag={h}
              country={country}
              view={view}
              open={openHashtag === h.hashtag}
              status={videoStatus[h.hashtag]}
              onToggle={() => toggleHashtag(h)}
              onRetry={() => loadVideos(h.hashtag)}
              viewToggle={<RadarViewToggle view={view} onChange={setView} />}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const DIR = {
  up: { label: "en hausse", Icon: TrendingUpIcon, cls: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  down: { label: "en baisse", Icon: TrendingDownIcon, cls: "text-rose-600 bg-rose-50 border-rose-200" },
  stable: { label: "stable", Icon: MinusIcon, cls: "text-slate-500 bg-slate-50 border-slate-200" },
} as const;

function HashtagRow({
  hashtag,
  country,
  view,
  open,
  status,
  onToggle,
  onRetry,
  viewToggle,
}: {
  hashtag: TrendHashtag;
  country: string;
  view: RadarViewMode;
  open: boolean;
  status: VideoStatus | undefined;
  onToggle: () => void;
  onRetry: () => void;
  viewToggle: React.ReactNode;
}) {
  const dir = hashtag.trendDirection
    ? DIR[hashtag.trendDirection as keyof typeof DIR]
    : null;
  const rising = hashtag.trendDirection === "up";

  return (
    <li
      className={cn(
        "overflow-hidden rounded-lg border bg-white shadow-sm",
        rising ? "border-emerald-200" : "border-slate-200",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-slate-50"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold tabular-nums text-slate-600">
          {hashtag.rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {hashtag.hashtag}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            {hashtag.videoViews != null && (
              <span>{formatCount(hashtag.videoViews)} vues</span>
            )}
            {hashtag.posts != null && (
              <span>{formatCount(hashtag.posts)} posts</span>
            )}
          </p>
        </div>
        {dir && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
              dir.cls,
            )}
          >
            <dir.Icon className="size-3" />
            {dir.label}
          </span>
        )}
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">Vidéos récentes (&lt; 14 jours)</p>
            {viewToggle}
          </div>
          <TrendVideosPanel
            country={country}
            hashtag={hashtag.hashtag}
            videosFetchedAt={hashtag.videosFetchedAt}
            status={status}
            view={view}
            onRetry={onRetry}
          />
        </div>
      )}
    </li>
  );
}

type TrendVideo = FunctionReturnType<typeof api.radar.listTrendVideos>[number];

function trendToCard(v: TrendVideo): RadarCardVideo {
  return {
    _id: v._id,
    tiktokId: v.tiktokId,
    url: v.url,
    authorHandle: v.authorHandle ?? null,
    coverUrl: v.coverUrl,
    caption: v.caption,
    publishedAt: v.publishedAt,
    views: v.views,
    likes: v.likes,
    comments: v.comments,
    shares: v.shares,
    durationSec: v.durationSec,
    engagement: v.engagement,
  };
}

/**
 * Panneau vidéos d'un hashtag. Le fetch À LA DEMANDE est piloté par le parent
 * (event handler au clic) ; ici on ne fait QUE lire le cache (listTrendVideos) et
 * rendre l'état. Réutilise le mur RadarVideoGrid (liste/grille, tri, embed).
 */
function TrendVideosPanel({
  country,
  hashtag,
  videosFetchedAt,
  status,
  view,
  onRetry,
}: {
  country: string;
  hashtag: string;
  videosFetchedAt: number | null;
  status: VideoStatus | undefined;
  view: RadarViewMode;
  onRetry: () => void;
}) {
  const videos = useProjectQuery(api.radar.listTrendVideos, {
    countryCode: country,
    hashtag,
  });

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-rose-200 bg-rose-50/40 px-6 py-8 text-center">
        <AlertCircleIcon className="size-6 text-rose-400" />
        <p className="text-sm text-slate-600">
          Impossible de charger les vidéos de ce hashtag.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCwIcon className="size-4" />
          Réessayer
        </Button>
      </div>
    );
  }

  const loading =
    status === "loading" ||
    videos === undefined ||
    (status === undefined && videosFetchedAt == null);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={i}
            className={view === "grid" ? "aspect-[9/16] w-full" : "h-24 w-full"}
          />
        ))}
      </div>
    );
  }

  return (
    <RadarVideoGrid
      videos={videos.map(trendToCard)}
      view={view}
      defaultSort="views"
      emptyText="Aucune vidéo récente (< 14 jours) pour ce hashtag."
    />
  );
}
