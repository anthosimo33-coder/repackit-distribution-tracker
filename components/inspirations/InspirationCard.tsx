"use client";

import { GalleryHorizontalIcon, StarIcon, UserIcon } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import { PlatformBadge } from "@/components/VerdictBadge";
import { cn } from "@/lib/utils";

type InspirationCardData = Doc<"inspirations"> & {
  thumbnailUrl: string | null;
};

const TYPE_LABELS: Record<"video" | "account", string> = {
  video: "Vidéo",
  account: "Compte",
};

const PLATFORM_GRADIENTS: Record<string, string> = {
  TikTok: "from-slate-800 to-slate-950",
  Instagram: "from-pink-400 to-fuchsia-600",
  YouTube: "from-red-500 to-red-700",
};

export function InspirationCard({
  inspiration,
}: {
  inspiration: InspirationCardData;
}) {
  const typeLabel = TYPE_LABELS[inspiration.type];
  const gradient =
    PLATFORM_GRADIENTS[inspiration.plateforme] ?? "from-slate-400 to-slate-600";
  const PlaceholderIcon =
    inspiration.type === "account" ? UserIcon : GalleryHorizontalIcon;

  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all duration-150 hover:shadow-md hover:scale-[1.02]">
      <div className="relative aspect-square w-full overflow-hidden bg-slate-50">
        {inspiration.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={inspiration.thumbnailUrl}
            alt={inspiration.titre ?? "Inspiration"}
            className="size-full object-cover"
          />
        ) : (
          <div
            className={cn(
              "flex size-full items-center justify-center bg-gradient-to-br",
              gradient,
            )}
          >
            <PlaceholderIcon className="size-12 text-white/50" />
          </div>
        )}
        {inspiration.isFavorite && (
          <div className="absolute top-2 right-2 rounded-full bg-white/90 p-1.5 shadow-sm">
            <StarIcon className="size-4 fill-amber-400 stroke-amber-500" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-2 text-sm font-medium text-slate-900">
          {inspiration.titre || (
            <span className="text-slate-400">(Sans titre)</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <PlatformBadge plateforme={inspiration.plateforme} />
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
            {typeLabel}
          </span>
        </div>
        {inspiration.notes && (
          <p className="line-clamp-1 text-xs text-slate-500">
            {inspiration.notes}
          </p>
        )}
      </div>
    </div>
  );
}

export type { InspirationCardData };
