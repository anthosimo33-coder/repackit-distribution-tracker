"use client";

import type { Id } from "@/convex/_generated/dataModel";
import {
  InspirationCard,
  type FolderRef,
  type InspirationCardData,
} from "./InspirationCard";

export function InspirationGrid({
  inspirations,
  folderMap,
  onCardClick,
}: {
  inspirations: InspirationCardData[];
  folderMap: Map<Id<"folders">, FolderRef>;
  onCardClick: (id: Id<"inspirations">) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {inspirations.map((i) => (
        <InspirationCard
          key={i._id}
          inspiration={i}
          folder={i.folderId ? folderMap.get(i.folderId) : undefined}
          onClick={() => onCardClick(i._id)}
        />
      ))}
    </div>
  );
}
