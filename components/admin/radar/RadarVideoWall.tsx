"use client";

import { useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VideoExample } from "@/components/formats/VideoExample";
import {
  ExternalLinkIcon,
  EyeIcon,
  HeartIcon,
  LayoutGridIcon,
  ListIcon,
  MessageCircleIcon,
  PlayIcon,
  Share2Icon,
  VideoOffIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatCount,
  formatDuration,
  formatEngagement,
  formatPublished,
} from "./radar-format";

type RadarAccount = FunctionReturnType<
  typeof api.radar.listRadarAccounts
>["accounts"][number];
type RadarVideo = FunctionReturnType<typeof api.radar.listRadarVideos>[number];

type ViewMode = "list" | "grid";
type SortKey = "views" | "published" | "likes" | "engagement";

const SORT_LABELS: Record<SortKey, string> = {
  views: "Plus vues",
  published: "Plus récentes",
  likes: "Plus likées",
  engagement: "Engagement",
};

function sortVideos(videos: RadarVideo[], key: SortKey): RadarVideo[] {
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

export function RadarVideoWall({ accounts }: { accounts: RadarAccount[] }) {
  // "all" ou un Id de compte (string : le Select Base UI infère sur string).
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [view, setView] = useState<ViewMode>("grid");
  const [active, setActive] = useState<RadarVideo | null>(null);

  const videos = useProjectQuery(
    api.radar.listRadarVideos,
    accountFilter === "all"
      ? {}
      : { accountId: accountFilter as Id<"radarAccounts"> },
  );

  const sorted = useMemo(
    () => (videos === undefined ? undefined : sortVideos(videos, sortKey)),
    [videos, sortKey],
  );

  const filterLabel =
    accountFilter === "all"
      ? "Tous les comptes"
      : `@${accounts.find((a) => a._id === accountFilter)?.handle ?? "compte"}`;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={accountFilter}
          onValueChange={(v) => v && setAccountFilter(v)}
        >
          <SelectTrigger className="w-48" aria-label="Filtrer par compte">
            <SelectValue>{filterLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les comptes</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a._id} value={a._id}>
                @{a.handle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sortKey}
          onValueChange={(v) => v && setSortKey(v as SortKey)}
        >
          <SelectTrigger className="w-44" aria-label="Trier">
            <SelectValue>{SORT_LABELS[sortKey]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {SORT_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto inline-flex rounded-lg border border-slate-200 p-0.5">
          <Button
            type="button"
            variant={view === "list" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="Vue liste"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <ListIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant={view === "grid" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="Vue grille"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <LayoutGridIcon className="size-4" />
          </Button>
        </div>
      </div>

      {sorted === undefined ? (
        <div
          className={cn(
            view === "grid"
              ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              : "space-y-2",
          )}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={i}
              className={view === "grid" ? "aspect-[9/16] w-full" : "h-24 w-full"}
            />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
          <VideoOffIcon className="size-12 text-slate-300" strokeWidth={1.5} />
          <p className="text-sm text-slate-500">
            Aucune vidéo pour ce filtre. Ajoute un compte et lance une
            synchronisation.
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((video) => (
            <GridCard
              key={video._id}
              video={video}
              onPlay={() => setActive(video)}
            />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((video) => (
            <ListRow
              key={video._id}
              video={video}
              onPlay={() => setActive(video)}
            />
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

function Stat({
  icon: Icon,
  value,
}: {
  icon: typeof EyeIcon;
  value: number;
}) {
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
  video: RadarVideo;
  onPlay: () => void;
}) {
  return (
    <div className="group flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Lire la vidéo de @${video.accountHandle ?? ""}`}
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
          @{video.accountHandle}
        </p>
        {video.accountNote && (
          <span className="inline-block max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
            {video.accountNote}
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
  video: RadarVideo;
  onPlay: () => void;
}) {
  return (
    <li className="flex items-stretch gap-3 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Lire la vidéo de @${video.accountHandle ?? ""}`}
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
            <p className="line-clamp-2 text-sm text-slate-700">
              {video.caption}
            </p>
          )}
          <p className="mt-0.5 truncate text-xs text-slate-500">
            @{video.accountHandle} · {formatPublished(video.publishedAt)}
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
        href={video.url}
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

/** Lecteur intégré : RÉUTILISE <VideoExample> (embed TikTok officiel) + lien ↗. */
function EmbedDialog({
  video,
  onClose,
}: {
  video: RadarVideo | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={video !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {video && (
          <>
            <DialogHeader>
              <DialogTitle className="truncate">
                @{video.accountHandle}
              </DialogTitle>
              {video.caption && (
                <DialogDescription className="line-clamp-2">
                  {video.caption}
                </DialogDescription>
              )}
            </DialogHeader>
            <div className="mx-auto w-full max-w-[320px]">
              <VideoExample
                example={{
                  kind: "url",
                  url: video.url,
                  platform: "tiktok",
                  title: video.caption ?? "",
                }}
              />
            </div>
            <a
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              <ExternalLinkIcon className="size-4" />
              Ouvrir sur TikTok
            </a>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
