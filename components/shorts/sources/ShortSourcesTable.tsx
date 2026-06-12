"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
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
import {
  PublicationDetailDialog,
  type PublicationWithImage,
} from "@/components/PublicationDetailDialog";
import { PublicationEditDialog } from "@/components/PublicationEditDialog";
import { RenameSourceDialog } from "@/components/shorts/sources/RenameSourceDialog";
import { PencilIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type SourceRow = FunctionReturnType<typeof api.publications.listSources>[number];
type PubLite = SourceRow["publications"][number];

const STATUS_STYLE: Record<PubLite["status"], string> = {
  published: "border-emerald-200 bg-emerald-50 text-emerald-700",
  late: "border-amber-200 bg-amber-50 text-amber-700",
  draft: "border-slate-200 bg-slate-50 text-slate-600",
};
const STATUS_LABEL: Record<PubLite["status"], string> = {
  published: "✅ Posté",
  late: "🟠 Retard",
  draft: "🟡 Planifié",
};

const PLATFORMS = ["TikTok", "Instagram", "YouTube"] as const;

/**
 * ShortSourcesTable — matrice sourceId × plateforme (/shorts/sources).
 *
 * 1 ligne par sourceId, 3 colonnes plateforme. Chaque cellule liste les
 * publications de ce sourceId sur cette plateforme (badge cliquable → détail)
 * ou "⬜ Disponible". L'action "Nouveau Short" pré-remplit le sourceId via le
 * modal (URL param). Reçoit les sources DÉJÀ filtrées par la page.
 */
export function ShortSourcesTable({ sources }: { sources: SourceRow[] }) {
  const router = useRouter();
  // Docs complets pour ouvrir PublicationDetailDialog au clic sur un badge.
  // listPublications est déjà en cache (dédup Convex) — coût négligeable.
  const allPubs = useProjectQuery(api.publications.listPublications, {});
  const pubMap = useMemo(() => {
    const m = new Map<Id<"publications">, PublicationWithImage>();
    for (const p of allPubs ?? []) m.set(p._id, p);
    return m;
  }, [allPubs]);

  const [viewingPub, setViewingPub] = useState<PublicationWithImage | null>(
    null,
  );
  const [editingPub, setEditingPub] = useState<PublicationWithImage | null>(
    null,
  );
  const [renameTarget, setRenameTarget] = useState<SourceRow | null>(null);

  function openDetail(publicationId: Id<"publications">) {
    const doc = pubMap.get(publicationId);
    if (doc) setViewingPub(doc);
  }

  function createWithSource(displaySourceId: string) {
    router.push(
      `/shorts?nouveau=open&format=short&sourceId=${encodeURIComponent(displaySourceId)}`,
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>TikTok</TableHead>
              <TableHead>Instagram</TableHead>
              <TableHead>YouTube</TableHead>
              <TableHead className="text-right">Couverture</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((s) => (
              <TableRow key={s.sourceId}>
                <TableCell className="font-mono text-xs">
                  {s.displaySourceId}
                </TableCell>
                {PLATFORMS.map((platform) => (
                  <PlatformCell
                    key={platform}
                    pubs={s.publications.filter(
                      (p) => p.plateforme === platform,
                    )}
                    onOpen={openDetail}
                  />
                ))}
                <TableCell className="text-right tabular-nums text-xs">
                  {s.coverage.total}/3
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Renommer la source ${s.displaySourceId}`}
                      onClick={() => setRenameTarget(s)}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 whitespace-nowrap"
                      onClick={() => createWithSource(s.displaySourceId)}
                    >
                      <PlusIcon className="size-3.5" />
                      Nouveau Short
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {viewingPub && (
        <PublicationDetailDialog
          key={viewingPub._id}
          publication={viewingPub}
          open
          onOpenChange={(o) => !o && setViewingPub(null)}
          onEdit={() => {
            setEditingPub(viewingPub);
            setViewingPub(null);
          }}
        />
      )}
      {editingPub && (
        <PublicationEditDialog
          key={editingPub._id}
          publication={editingPub}
          open
          onOpenChange={(o) => !o && setEditingPub(null)}
        />
      )}

      <RenameSourceDialog
        key={renameTarget?.sourceId ?? "rename-closed"}
        source={renameTarget}
        onClose={() => setRenameTarget(null)}
      />
    </>
  );
}

function PlatformCell({
  pubs,
  onOpen,
}: {
  pubs: PubLite[];
  onOpen: (id: Id<"publications">) => void;
}) {
  if (pubs.length === 0) {
    return (
      <TableCell>
        <span className="text-xs text-slate-400">⬜ Disponible</span>
      </TableCell>
    );
  }
  return (
    <TableCell>
      <div className="flex flex-col items-start gap-1">
        {pubs.map((p) => (
          <button
            key={p.publicationId}
            type="button"
            onClick={() => onOpen(p.publicationId)}
            className={cn(
              "inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-opacity hover:opacity-80",
              STATUS_STYLE[p.status],
            )}
            title={`${p.carouselId} · ${p.compte}`}
          >
            <span>{STATUS_LABEL[p.status]}</span>
            <span className="font-mono opacity-80">{p.carouselId}</span>
          </button>
        ))}
      </div>
    </TableCell>
  );
}
