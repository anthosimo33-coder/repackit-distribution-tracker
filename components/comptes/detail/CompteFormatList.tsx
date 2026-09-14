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
import type { FormatKey } from "@/lib/format-config";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import type { PublicationWithImage } from "@/components/PublicationDetailDialog";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useFormatLabels } from "@/lib/use-format-labels";

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
  const loc = useIntlLocale();
  const tr = useTranslations("admin.accounts.CompteFormatList");
  const fmt = useFormatLabels();
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
        {tr("aucunPourCeCompte", { value: fmt.singular(mediaType).toLowerCase() })}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <Table>
        <TableHeader>
          <TableRow>
            <SortHeader
              label={tr("date")}
              active={sortKey === "date"}
              dir={sortDir}
              onClick={() => toggleSort("date")}
            />
            <TableHead>{tr("id")}</TableHead>
            <TableHead>{tr("hook")}</TableHead>
            <TableHead>{tr("plateforme")}</TableHead>
            <TableHead>{tr("statut")}</TableHead>
            <SortHeader
              label={tr("vues")}
              active={sortKey === "vues"}
              dir={sortDir}
              onClick={() => toggleSort("vues")}
              align="right"
            />
            <SortHeader
              label={tr("likes")}
              active={sortKey === "likes"}
              dir={sortDir}
              onClick={() => toggleSort("likes")}
              align="right"
            />
            {isCarousel && <TableHead>{tr("verdict")}</TableHead>}
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
                  {formatDate(p.datePubli, loc)}
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
                  {formatNumber(p.displayMetrics?.vues ?? null, loc)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm text-slate-700">
                  {formatNumber(p.displayMetrics?.likes ?? null, loc)}
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
  const tr = useTranslations("admin.accounts.StatusBadge");
  if (isPublished(pub)) {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
        {tr("publie")}
      </Badge>
    );
  }
  if (isLate(pub)) {
    return (
      <Badge className="border-rose-200 bg-rose-50 text-rose-700">
        {tr("enRetard")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-slate-500">
      {tr("aVenir")}
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
