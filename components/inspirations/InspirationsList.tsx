"use client";

import { useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PlatformBadge } from "@/components/VerdictBadge";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber } from "@/lib/format";
import { getFolderColor } from "@/lib/folder-colors";
import type {
  FolderRef,
  InspirationCardData,
} from "./InspirationCard";
import { StarIcon } from "lucide-react";
import { ThumbnailFallback } from "./ThumbnailFallback";
import { toast } from "sonner";

const TYPE_LABELS: Record<"video" | "account", string> = {
  video: "Vidéo",
  account: "Compte",
};

/**
 * Vignette d'une ligne : image si dispo (onError → fallback), sinon fallback
 * propre icône-plateforme. Sous-composant pour porter l'état d'erreur par row.
 */
function ThumbnailCell({ inspiration }: { inspiration: InspirationCardData }) {
  const [imgError, setImgError] = useState(false);
  if (inspiration.thumbnailUrl && !imgError) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={inspiration.thumbnailUrl}
        alt={inspiration.titre ?? "Inspiration"}
        loading="lazy"
        onError={() => setImgError(true)}
        className="size-10 rounded-md object-cover"
      />
    );
  }
  return (
    <ThumbnailFallback
      plateforme={inspiration.plateforme}
      type={inspiration.type}
      iconClassName="size-4"
      className="size-10 rounded-md"
    />
  );
}

function StatsCell({
  stats,
  type,
}: {
  stats: InspirationCardData["stats"];
  type: "video" | "account";
}) {
  if (!stats) return <span className="text-slate-400">—</span>;
  const parts: string[] = [];
  if (type === "account" && stats.followers !== undefined) {
    parts.push(`${formatNumber(stats.followers)} abonnés`);
  }
  if (stats.views !== undefined) parts.push(`${formatNumber(stats.views)} vues`);
  if (stats.likes !== undefined) parts.push(`${formatNumber(stats.likes)} likes`);
  if (stats.comments !== undefined)
    parts.push(`${formatNumber(stats.comments)} comm.`);
  if (parts.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <span className="text-xs text-slate-600">{parts.slice(0, 2).join(" · ")}</span>
  );
}

/**
 * Batch H — vue tableau pour /inspirations?view=list. Mêmes data que le
 * grid, layout différent. Click row = ouvre Dialog edit. Toggle favori
 * inline (e.stopPropagation pour ne pas ouvrir le Dialog).
 *
 * Header sticky pour les longs scrolls. Cellules whitespace-nowrap par
 * défaut (via TableCell shadcn) ; les colonnes avec contenu variable
 * (Titre, Dossier) overflow-truncate explicitement.
 */
export function InspirationsList({
  inspirations,
  folderMap,
  onCardClick,
}: {
  inspirations: InspirationCardData[];
  folderMap: Map<Id<"folders">, FolderRef>;
  onCardClick: (id: Id<"inspirations">) => void;
}) {
  const updateInspiration = useProjectMutation(api.inspirations.updateInspiration);

  async function toggleFavorite(
    e: React.MouseEvent,
    id: Id<"inspirations">,
    current: boolean,
  ) {
    e.stopPropagation();
    try {
      await updateInspiration({ id, isFavorite: !current });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-slate-50">
          <TableRow>
            <TableHead className="w-[60px]" />
            <TableHead className="w-[80px]">Type</TableHead>
            <TableHead className="w-[100px]">Plateforme</TableHead>
            <TableHead>Titre</TableHead>
            <TableHead className="w-[140px]">Dossier</TableHead>
            <TableHead className="w-[180px]">Stats</TableHead>
            <TableHead className="w-[50px]" aria-label="Favori" />
            <TableHead className="w-[90px]">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {inspirations.map((i) => {
            const folder = i.folderId ? folderMap.get(i.folderId) : undefined;
            const folderColor = getFolderColor(folder?.color);
            return (
              <TableRow
                key={i._id}
                onClick={() => onCardClick(i._id)}
                className="cursor-pointer"
              >
                <TableCell>
                  <ThumbnailCell inspiration={i} />
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {TYPE_LABELS[i.type]}
                  </span>
                </TableCell>
                <TableCell>
                  <PlatformBadge plateforme={i.plateforme} />
                </TableCell>
                <TableCell className="max-w-[200px]">
                  <span
                    className="block truncate"
                    title={i.titre || "(Sans titre)"}
                  >
                    {i.titre || (
                      <span className="text-slate-400">(Sans titre)</span>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  {folder ? (
                    <span
                      className={cn(
                        "inline-flex max-w-[120px] items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
                        folderColor.badgeClass,
                      )}
                    >
                      <span
                        className={cn("size-1.5 rounded-full", folderColor.dotClass)}
                      />
                      <span className="truncate">{folder.name}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatsCell stats={i.stats} type={i.type} />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      i.isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"
                    }
                    onClick={(e) => toggleFavorite(e, i._id, i.isFavorite)}
                  >
                    <StarIcon
                      className={cn(
                        "size-4",
                        i.isFavorite
                          ? "fill-amber-400 stroke-amber-500"
                          : "stroke-slate-400",
                      )}
                    />
                  </Button>
                </TableCell>
                <TableCell>
                  <span className="text-xs tabular-nums text-slate-500">
                    {formatDate(i.createdAt)}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
