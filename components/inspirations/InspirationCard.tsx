"use client";

import { useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { ExternalLinkIcon, EyeIcon, StarIcon, UsersIcon } from "lucide-react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { PlatformBadge } from "@/components/VerdictBadge";
import { cn } from "@/lib/utils";
import { getFolderColor } from "@/lib/folder-colors";
import { formatNumber } from "@/lib/format";
import { formatOutlierRatio } from "@/components/admin/radar/radar-format";
import { resolveOutlierRatio } from "@/lib/inspiration-stats";
import { ThumbnailFallback } from "./ThumbnailFallback";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

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
  const folderColor = getFolderColor(folder?.color);
  // Bouton "Ouvrir" seulement si l'inspiration a une URL exploitable.
  const hasUrl = inspiration.url.trim().length > 0;
  // L'URL de vignette peut casser (lien mort) → onError bascule sur le fallback.
  const [imgError, setImgError] = useState(false);
  // Stats overlay : vues + abonnés (si saisis) + ratio outlier résolu (stocké
  // Radar ou fallback views/followers ; null pour un compte ou données
  // insuffisantes). Tous optionnels → chacun n'apparaît que s'il existe.
  const views = inspiration.stats?.views;
  const followers = inspiration.stats?.followers;
  const outlierRatio = resolveOutlierRatio(inspiration.stats, inspiration.type);

  const updateInspiration = useProjectMutation(api.inspirations.updateInspiration);

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
      toast.error(convexErrorMessage(err, "Une erreur est survenue."));
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
        {inspiration.thumbnailUrl && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={inspiration.thumbnailUrl}
            alt={inspiration.titre ?? "Inspiration"}
            loading="lazy"
            onError={() => setImgError(true)}
            className="size-full object-cover"
          />
        ) : (
          <ThumbnailFallback
            plateforme={inspiration.plateforme}
            type={inspiration.type}
            iconClassName="size-12"
          />
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
        {hasUrl && (
          // Lien externe : toujours visible (mobile sans hover) et isolé du
          // click carte (stopPropagation) pour ne pas ouvrir le Dialog edit.
          <a
            href={inspiration.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ouvrir la publication"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="absolute top-2 left-2 rounded-full bg-white/90 p-1.5 text-slate-600 shadow-sm transition-colors hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
          >
            <ExternalLinkIcon className="size-4" />
          </a>
        )}
        {(views != null || followers != null || outlierRatio != null) && (
          // Overlay stats en bas de vignette : scrim gradient pour rester lisible
          // sur n'importe quelle miniature. Décoratif → pointer-events-none pour
          // ne pas intercepter le click carte. Hiérarchie : badge ratio (héro) à
          // gauche ; vues + abonnés empilés à droite (largeur bornée par le plus
          // long nombre → densité maîtrisée sur les petites cartes 2 colonnes).
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/60 to-transparent p-2",
              outlierRatio != null ? "justify-between" : "justify-end",
            )}
          >
            {outlierRatio != null && (
              <span className="rounded bg-slate-900/90 px-1.5 py-0.5 text-xs font-bold tabular-nums text-white shadow-sm">
                {formatOutlierRatio(outlierRatio)}
              </span>
            )}
            {(views != null || followers != null) && (
              <div className="flex flex-col items-end gap-1">
                {views != null && (
                  <span className="inline-flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white shadow-sm">
                    <EyeIcon className="size-3" />
                    {formatNumber(views)}
                  </span>
                )}
                {followers != null && (
                  <span className="inline-flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white shadow-sm">
                    <UsersIcon className="size-3" />
                    {formatNumber(followers)}
                  </span>
                )}
              </div>
            )}
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
