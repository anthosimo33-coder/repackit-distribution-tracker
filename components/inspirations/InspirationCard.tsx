"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { GalleryHorizontalIcon, StarIcon, UserIcon } from "lucide-react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { PlatformBadge } from "@/components/VerdictBadge";
import { cn } from "@/lib/utils";
import { getFolderColor } from "@/lib/folder-colors";
import { toast } from "sonner";

type InspirationCardData = Doc<"inspirations"> & {
  thumbnailUrl: string | null;
};

export type FolderRef = {
  _id: Id<"folders">;
  name: string;
  color?: string;
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
  folder,
  onClick,
}: {
  inspiration: InspirationCardData;
  folder?: FolderRef;
  onClick: () => void;
}) {
  const typeLabel = TYPE_LABELS[inspiration.type];
  const gradient =
    PLATFORM_GRADIENTS[inspiration.plateforme] ?? "from-slate-400 to-slate-600";
  const PlaceholderIcon =
    inspiration.type === "account" ? UserIcon : GalleryHorizontalIcon;
  const folderColor = getFolderColor(folder?.color);

  const updateInspiration = useMutation(api.inspirations.updateInspiration);

  // Optimistic favori toggle : décision immediate (mutation directe au
  // click). Justification : signal d'intention claire de l'utilisateur,
  // latence Convex < 200ms, et le re-render via subscription Convex
  // confirme l'état correct. Pas de batching nécessaire au volume cible.
  async function handleToggleFavorite(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    try {
      await updateInspiration({
        id: inspiration._id,
        isFavorite: !inspiration.isFavorite,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm transition-all duration-150 hover:scale-[1.02] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
    >
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
        <button
          type="button"
          aria-label={
            inspiration.isFavorite
              ? "Retirer des favoris"
              : "Ajouter aux favoris"
          }
          onClick={handleToggleFavorite}
          className={cn(
            "absolute top-2 right-2 rounded-full p-1.5 shadow-sm transition-colors",
            inspiration.isFavorite
              ? "bg-white/90 hover:bg-white"
              : "bg-white/70 opacity-0 group-hover:opacity-100 hover:bg-white/90 focus:opacity-100",
          )}
        >
          <StarIcon
            className={cn(
              "size-4",
              inspiration.isFavorite
                ? "fill-amber-400 stroke-amber-500"
                : "stroke-slate-500",
            )}
          />
        </button>
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
          {folder && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
                folderColor.badgeClass,
              )}
            >
              <span className={cn("size-1.5 rounded-full", folderColor.dotClass)} />
              <span className="truncate max-w-[10ch]">{folder.name}</span>
            </span>
          )}
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
