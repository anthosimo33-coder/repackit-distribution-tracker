"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PlatformBadge, VerdictBadge } from "@/components/VerdictBadge";
import { computeVerdict } from "@/lib/verdict";
import { formatNumber, formatDate } from "@/lib/format";
import { isLate, isPublished } from "@/lib/publication-status";
import { FORMAT_CONFIGS, type FormatKey } from "@/lib/format-config";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import type { PublicationWithImage } from "@/components/PublicationDetailDialog";

type SortKey = "date" | "vues" | "likes";
type SortDir = "asc" | "desc";

/**
 * Liste slim des publications d'un format pour un compte. Ne réutilise pas
 * TrackerListSection (trop lourd : filtres, presets, analytics, son propre
 * sélecteur de période) — table minimale, tri date/vues/likes, click row →
 * dialog détail. Vues/Likes suivent la période globale (displayMetrics).
 */
export function CompteFormatList({
  publications,
  mediaType,
  onView,
}: {
  publications: PublicationWithImage[];
  mediaType: FormatKey;
  onView: (p: PublicationWithImage) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const isCarousel = mediaType === "carousel";

  const sorted = useMemo(() => {
    const arr = [...publications];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === "date") {
        cmp = a.datePubli - b.datePubli;
      } else {
        const av = a.displayMetrics?.[sortKey] ?? null;
        const bv = b.displayMetrics?.[sortKey] ?? null;
        if (av === null && bv === null) cmp = 0;
        else if (av === null) cmp = -1;
        else if (bv === null) cmp = 1;
        else cmp = av - bv;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [publications, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  if (publications.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
        Aucun {FORMAT_CONFIGS[mediaType].singular.toLowerCase()} pour ce compte.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHeader
              label="Date"
              active={sortKey === "date"}
              dir={sortDir}
              onClick={() => toggleSort("date")}
            />
            <TableHead>ID</TableHead>
            <TableHead>Hook</TableHead>
            <TableHead>Plateforme</TableHead>
            <TableHead>Statut</TableHead>
            <SortHeader
              label="Vues"
              active={sortKey === "vues"}
              dir={sortDir}
              onClick={() => toggleSort("vues")}
              align="right"
            />
            <SortHeader
              label="Likes"
              active={sortKey === "likes"}
              dir={sortDir}
              onClick={() => toggleSort("likes")}
              align="right"
            />
            {isCarousel && <TableHead>Verdict</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((p) => {
            const label = p.titre?.trim() || p.hookText || "—";
            return (
              <TableRow
                key={p._id}
                className="cursor-pointer"
                onClick={() => onView(p)}
              >
                <TableCell className="whitespace-nowrap text-sm text-slate-500">
                  {formatDate(p.datePubli)}
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-500">
                  {p.carouselId}
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm text-slate-900">
                  {label}
                </TableCell>
                <TableCell>
                  <PlatformBadge plateforme={p.plateforme} />
                </TableCell>
                <TableCell>
                  <StatusBadge pub={p} />
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm text-slate-700">
                  {formatNumber(p.displayMetrics?.vues ?? null)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm text-slate-700">
                  {formatNumber(p.displayMetrics?.likes ?? null)}
                </TableCell>
                {isCarousel && (
                  <TableCell>
                    <VerdictBadge verdict={computeVerdict(p.displayMetrics)} />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusBadge({ pub }: { pub: PublicationWithImage }) {
  if (isPublished(pub)) {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
        Publié
      </Badge>
    );
  }
  if (isLate(pub)) {
    return (
      <Badge className="border-rose-200 bg-rose-50 text-rose-700">
        En retard
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-slate-500">
      À venir
    </Badge>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  const Icon = !active ? ArrowUpDownIcon : dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <TableHead className={cn(align === "right" && "text-right")}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-slate-900",
          align === "right" && "flex-row-reverse",
          active ? "text-slate-900" : "text-slate-500",
        )}
      >
        {label}
        <Icon className="size-3" />
      </button>
    </TableHead>
  );
}
