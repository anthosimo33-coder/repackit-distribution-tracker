"use client";

import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CalendarIcon,
  ClockIcon,
  ExternalLinkIcon,
  EyeIcon,
  HeartIcon,
  MessageCircleIcon,
  PlayIcon,
  Share2Icon,
  VideoOffIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tiktokCanonicalVideoUrl, tiktokPlayerEmbedUrl } from "@/lib/embed";
import {
  formatCount,
  formatDuration,
  formatEngagement,
  formatPublished,
} from "./radar-format";

/**
 * RADAR — mur de vidéos RÉUTILISABLE (Brique 1 comptes favoris ET Brique 2
 * tendances). Affiche une liste de vidéos en grille/liste, triable, avec vraies
 * miniatures + dates, et l'embed lecteur TikTok EN PLACE (iframe player officiel).
 * Le `view` (liste/grille) est piloté par le parent ; le tri + l'embed sont gérés
 * ici. Toute vidéo affichable se ramène à `RadarCardVideo`.
 */
export interface RadarCardVideo {
  _id: string;
  tiktokId: string;
  url: string;
  authorHandle: string | null;
  note?: string | null; // tag/note (comptes favoris) — optionnel
  coverUrl?: string | null;
  caption?: string | null;
  publishedAt: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  durationSec?: number | null;
  engagement: number;
}

export type RadarViewMode = "list" | "grid";
export type RadarSortKey = "views" | "published" | "likes" | "engagement";

const SORT_LABELS: Record<RadarSortKey, string> = {
  views: "Plus vues",
  published: "Plus récentes",
  likes: "Plus likées",
  engagement: "Engagement",
};

function sortVideos(
  videos: RadarCardVideo[],
  key: RadarSortKey,
): RadarCardVideo[] {
  const copy = [...videos];
  copy.sort((a, b) => {
    switch (key) {
      case "published":
        return b.publishedAt - a.publishedAt;
      case "likes":
        return b.likes - a.likes;
      case "engagement":
        return b.engagement - a.engagement;
      case "views":
      default:
        return b.views - a.views;
    }
  });
  return copy;
}

export function RadarVideoGrid({
  videos,
  view,
  defaultSort = "views",
  title,
  icon: Icon,
  emptyText = "Aucune vidéo.",
}: {
  videos: RadarCardVideo[] | undefined;
  view: RadarViewMode;
  defaultSort?: RadarSortKey;
  title?: string;
  icon?: typeof ClockIcon;
  emptyText?: string;
}) {
  const [sortKey, setSortKey] = useState<RadarSortKey>(defaultSort);
  const [active, setActive] = useState<RadarCardVideo | null>(null);
  const sorted = useMemo(
    () => (videos === undefined ? undefined : sortVideos(videos, sortKey)),
    [videos, sortKey],
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {title ? (
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            {Icon && <Icon className="size-4 text-slate-500" />}
            {title}
            {sorted !== undefined && (
              <span className="text-xs font-normal text-slate-400">
                ({sorted.length})
              </span>
            )}
          </h3>
        ) : (
          <span />
        )}
        <Select
          value={sortKey}
          onValueChange={(v) => v && setSortKey(v as RadarSortKey)}
        >
          <SelectTrigger
            className="w-40"
            size="sm"
            aria-label={`Trier ${title ?? "les vidéos"}`}
          >
            <SelectValue>{SORT_LABELS[sortKey]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as RadarSortKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {SORT_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {sorted === undefined ? (
        <div
          className={cn(
            view === "grid"
              ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              : "space-y-2",
          )}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              key={i}
              className={view === "grid" ? "aspect-[9/16] w-full" : "h-24 w-full"}
            />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-10 text-center">
          <VideoOffIcon className="size-8 text-slate-300" strokeWidth={1.5} />
          <p className="text-sm text-slate-500">{emptyText}</p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((video) => (
            <GridCard key={video._id} video={video} onPlay={() => setActive(video)} />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((video) => (
            <ListRow key={video._id} video={video} onPlay={() => setActive(video)} />
          ))}
        </ul>
      )}

      <EmbedDialog video={active} onClose={() => setActive(null)} />
    </section>
  );
}

/** Miniature TikTok (coverUrl) avec repli propre si l'image manque/expire. */
function Thumb({
  url,
  alt,
  className,
}: {
  url: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        loading="lazy"
        onError={() => setBroken(true)}
        className={cn("size-full object-cover", className)}
      />
    );
  }
  return (
    <div className="flex size-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-slate-300">
      <PlayIcon className="size-6" />
    </div>
  );
}

function Stat({ icon: Icon, value }: { icon: typeof EyeIcon; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Icon className="size-3.5 text-slate-400" />
      {formatCount(value)}
    </span>
  );
}

function GridCard({
  video,
  onPlay,
}: {
  video: RadarCardVideo;
  onPlay: () => void;
}) {
  return (
    <div className="group flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Lire la vidéo de @${video.authorHandle ?? ""}`}
        className="relative block aspect-[9/16] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-900"
      >
        <Thumb
          url={video.coverUrl}
          alt={video.caption ?? "Vidéo TikTok"}
          className="opacity-90 transition-opacity group-hover:opacity-100"
        />
        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">
          <EyeIcon className="size-3" />
          {formatCount(video.views)}
        </span>
        {formatDuration(video.durationSec) && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">
            {formatDuration(video.durationSec)}
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
            <PlayIcon className="size-5" />
          </span>
        </span>
      </button>
      <div className="min-w-0 space-y-0.5">
        {video.caption && (
          <p className="line-clamp-2 text-xs text-slate-700">{video.caption}</p>
        )}
        <p className="truncate text-xs font-medium text-slate-900">
          @{video.authorHandle}
        </p>
        {/* Date visible partout (récente ou ancienne). */}
        <p className="flex items-center gap-1 text-[11px] text-slate-400">
          <CalendarIcon className="size-3" />
          {formatPublished(video.publishedAt)}
        </p>
        {video.note && (
          <span className="inline-block max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
            {video.note}
          </span>
        )}
      </div>
    </div>
  );
}

function ListRow({
  video,
  onPlay,
}: {
  video: RadarCardVideo;
  onPlay: () => void;
}) {
  return (
    <li className="flex items-stretch gap-3 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Lire la vidéo de @${video.authorHandle ?? ""}`}
        className="relative block aspect-[9/16] h-24 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-900"
      >
        <Thumb url={video.coverUrl} alt={video.caption ?? "Vidéo TikTok"} />
        {formatDuration(video.durationSec) && (
          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] font-medium tabular-nums text-white">
            {formatDuration(video.durationSec)}
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <PlayIcon className="size-6 text-white/90 drop-shadow" />
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1 py-0.5">
        <div className="min-w-0">
          {video.caption && (
            <p className="line-clamp-2 text-sm text-slate-700">{video.caption}</p>
          )}
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
            @{video.authorHandle}
            <span className="text-slate-300">·</span>
            <CalendarIcon className="size-3 text-slate-400" />
            {formatPublished(video.publishedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          <Stat icon={EyeIcon} value={video.views} />
          <Stat icon={HeartIcon} value={video.likes} />
          <Stat icon={MessageCircleIcon} value={video.comments} />
          <Stat icon={Share2Icon} value={video.shares} />
          <span className="text-slate-400">
            · {formatEngagement(video.engagement)} eng.
          </span>
        </div>
      </div>
      <a
        href={
          video.authorHandle
            ? tiktokCanonicalVideoUrl(video.authorHandle, video.tiktokId)
            : video.url
        }
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Ouvrir sur TikTok"
        className="flex shrink-0 items-center self-start p-1 text-slate-400 hover:text-slate-700"
      >
        <ExternalLinkIcon className="size-4" />
      </a>
    </li>
  );
}

/**
 * Lecteur intégré : LECTURE EN PLACE via l'iframe du lecteur TikTok officiel
 * (`player/v1/<id>`), construit depuis tiktokId — pas d'oEmbed/embed.js (fiable
 * même en ouvrant plusieurs vidéos d'affilée). Lien ↗ à côté ; si non embeddable
 * (privée/restreinte), l'iframe affiche le message TikTok et le ↗ reste le secours.
 */
function EmbedDialog({
  video,
  onClose,
}: {
  video: RadarCardVideo | null;
  onClose: () => void;
}) {
  const canonicalUrl =
    video === null
      ? ""
      : video.authorHandle
        ? tiktokCanonicalVideoUrl(video.authorHandle, video.tiktokId)
        : video.url;

  return (
    <Dialog open={video !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {video && (
          <>
            <DialogHeader>
              <DialogTitle className="truncate">@{video.authorHandle}</DialogTitle>
              {video.caption && (
                <DialogDescription className="line-clamp-2">
                  {video.caption}
                </DialogDescription>
              )}
            </DialogHeader>
            <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-lg border border-slate-200 bg-black">
              <iframe
                key={video.tiktokId}
                src={tiktokPlayerEmbedUrl(video.tiktokId)}
                title={video.caption ?? "Vidéo TikTok"}
                className="aspect-[9/16] w-full"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
                data-testid="radar-tiktok-player"
              />
            </div>
            <div className="space-y-1 text-center">
              <a
                href={canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                <ExternalLinkIcon className="size-4" />
                Ouvrir sur TikTok
              </a>
              <p className="text-xs text-slate-400">
                Si la vidéo ne se lance pas (privée ou restreinte), ouvre-la sur
                TikTok.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
