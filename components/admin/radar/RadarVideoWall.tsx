"use client";

import { useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClockIcon, FlameIcon, LayoutGridIcon, ListIcon } from "lucide-react";
import {
  RadarVideoGrid,
  type RadarCardVideo,
  type RadarViewMode,
} from "./RadarVideoGrid";
import { useTranslations } from "next-intl";

type RadarAccount = FunctionReturnType<
  typeof api.radar.listRadarAccounts
>["accounts"][number];
type RadarVideo = FunctionReturnType<typeof api.radar.listRadarVideos>[number];

/** Vidéo de compte favori → forme commune du mur réutilisable. */
function toCard(v: RadarVideo): RadarCardVideo {
  return {
    _id: v._id,
    tiktokId: v.tiktokId,
    url: v.url,
    authorHandle: v.accountHandle,
    note: v.accountNote,
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

export function RadarVideoWall({ accounts }: { accounts: RadarAccount[] }) {
  const tr = useTranslations("admin.ops.RadarVideoWall");
  // "all" ou un Id de compte (string : le Select Base UI infère sur string).
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [view, setView] = useState<RadarViewMode>("grid");

  const videos = useProjectQuery(
    api.radar.listRadarVideos,
    accountFilter === "all"
      ? {}
      : { accountId: accountFilter as Id<"radarAccounts"> },
  );

  const { recent, popular } = useMemo(() => {
    if (videos === undefined) return { recent: undefined, popular: undefined };
    return {
      recent: videos.filter((v) => v.bucket === "recent").map(toCard),
      popular: videos.filter((v) => v.bucket === "popular").map(toCard),
    };
  }, [videos]);

  const filterLabel =
    accountFilter === "all"
      ? tr("tousLesComptes")
      : `@${accounts.find((a) => a._id === accountFilter)?.handle ?? "compte"}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={accountFilter}
          onValueChange={(v) => v && setAccountFilter(v)}
        >
          <SelectTrigger className="w-48" aria-label={tr("filtrerParCompte")}>
            <SelectValue>{filterLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr("tousLesComptes")}</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a._id} value={a._id}>
                @{a.handle}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <RadarViewToggle view={view} onChange={setView} />
      </div>

      <RadarVideoGrid
        title={tr("dernieresVideos")}
        icon={ClockIcon}
        videos={recent}
        view={view}
        // i18n-exempt: clé de tri, pas du texte
        defaultSort="published"
        emptyText={tr("aucuneVideoRecenteLanceUne")}
      />
      <RadarVideoGrid
        title={tr("topVues")}
        icon={FlameIcon}
        videos={popular}
        view={view}
        // i18n-exempt: clé de tri, pas du texte
        defaultSort="views"
        emptyText={tr("aucuneVideoPopulairePourL")}
      />
    </div>
  );
}

/** Toggle liste/grille partagé (mur favoris + tendances). */
export function RadarViewToggle({
  view,
  onChange,
  className,
}: {
  view: RadarViewMode;
  onChange: (v: RadarViewMode) => void;
  className?: string;
}) {
  const tr = useTranslations("admin.ops.RadarViewToggle");
  return (
    <div
      className={`inline-flex rounded-lg border border-slate-200 p-0.5 ${className ?? ""}`}
    >
      <Button
        type="button"
        variant={view === "list" ? "secondary" : "ghost"}
        size="icon-sm"
        aria-label={tr("vueListe")}
        aria-pressed={view === "list"}
        onClick={() => onChange("list")}
      >
        <ListIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant={view === "grid" ? "secondary" : "ghost"}
        size="icon-sm"
        aria-label={tr("vueGrille")}
        aria-pressed={view === "grid"}
        onClick={() => onChange("grid")}
      >
        <LayoutGridIcon className="size-4" />
      </Button>
    </div>
  );
}
