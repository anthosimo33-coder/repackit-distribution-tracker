"use client";

import { useRouter } from "next/navigation";
import type { Doc } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VerdictBadge, PlatformBadge } from "@/components/VerdictBadge";
import {
  getTopHooks,
  getTopHooksShorts,
  getTopHooksScreenRecorder,
} from "@/lib/dashboard-stats";
import { formatNumber, formatPercent } from "@/lib/format";
import { FORMAT_CONFIGS, type FormatKey } from "@/lib/format-config";
import { isPublished } from "@/lib/publication-status";

type Publication = Doc<"publications">;

/**
 * TopHooksTable — top N hooks performers, colonnes spécifiques au format.
 *
 * Tri par défaut :
 *  - carousel : saveRate desc (winners → folds)
 *  - short / screenrecorder : subsGained desc
 *
 * Click row → navigate vers /[route]?carouselId=X (deeplink filter dans la
 * page format).
 */
export function TopHooksTable({
  publications,
  mediaType,
  n = 10,
}: {
  publications: Publication[];
  mediaType: FormatKey;
  n?: number;
}) {
  const router = useRouter();
  const config = FORMAT_CONFIGS[mediaType];
  const published = publications.filter(isPublished);

  if (published.length === 0) return null;

  function go(carouselId: string) {
    router.push(`${config.route}?carouselId=${carouselId}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top hooks performers</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          {mediaType === "carousel" ? (
            <CarouselTable
              rows={getTopHooks(published, n)}
              onRowClick={go}
            />
          ) : mediaType === "short" ? (
            <ShortTable
              rows={getTopHooksShorts(published, n)}
              onRowClick={go}
            />
          ) : (
            <ScreenRecorderTable
              rows={getTopHooksScreenRecorder(published, n)}
              fullPubs={published}
              onRowClick={go}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CarouselTable({
  rows,
  onRowClick,
}: {
  rows: ReturnType<typeof getTopHooks>;
  onRowClick: (carouselId: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Hook</TableHead>
          <TableHead className="font-mono">Carousel</TableHead>
          <TableHead>Plateforme</TableHead>
          <TableHead className="text-right">Vues</TableHead>
          <TableHead className="text-right">Save rate</TableHead>
          <TableHead>Verdict</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((h, i) => (
          <TableRow
            key={`${h.carouselId}-${h.plateforme}`}
            className="cursor-pointer hover:bg-slate-50"
            onClick={() => onRowClick(h.carouselId)}
          >
            <TableCell className="font-mono text-xs text-slate-500">
              #{i + 1}
            </TableCell>
            <TableCell
              className="max-w-[280px] truncate text-sm"
              title={h.hookText}
            >
              {h.hookText.length > 60
                ? h.hookText.slice(0, 60) + "…"
                : h.hookText}
            </TableCell>
            <TableCell className="font-mono text-xs">{h.carouselId}</TableCell>
            <TableCell>
              <PlatformBadge plateforme={h.plateforme} />
            </TableCell>
            <TableCell className="text-right tabular-nums text-xs">
              {formatNumber(h.vues)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-sm font-medium">
              {formatPercent(h.saveRate)}
            </TableCell>
            <TableCell>
              <VerdictBadge verdict={h.verdict} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ShortTable({
  rows,
  onRowClick,
}: {
  rows: ReturnType<typeof getTopHooksShorts>;
  onRowClick: (carouselId: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Hook</TableHead>
          <TableHead className="font-mono">Carousel</TableHead>
          <TableHead>Plateforme</TableHead>
          <TableHead className="text-right">Vues</TableHead>
          <TableHead className="text-right">Likes</TableHead>
          <TableHead className="text-right">Subs gagnés</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((h, i) => (
          <TableRow
            key={`${h.carouselId}-${h.plateforme}`}
            className="cursor-pointer hover:bg-slate-50"
            onClick={() => onRowClick(h.carouselId)}
          >
            <TableCell className="font-mono text-xs text-slate-500">
              #{i + 1}
            </TableCell>
            <TableCell
              className="max-w-[280px] truncate text-sm"
              title={h.hookText}
            >
              {h.hookText.length > 60
                ? h.hookText.slice(0, 60) + "…"
                : h.hookText}
            </TableCell>
            <TableCell className="font-mono text-xs">{h.carouselId}</TableCell>
            <TableCell>
              <PlatformBadge plateforme={h.plateforme} />
            </TableCell>
            <TableCell className="text-right tabular-nums text-xs">
              {formatNumber(h.vues)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-xs">
              {formatNumber(h.likes)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-sm font-medium">
              {formatNumber(h.subsGained)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScreenRecorderTable({
  rows,
  fullPubs,
  onRowClick,
}: {
  rows: ReturnType<typeof getTopHooksScreenRecorder>;
  fullPubs: Publication[];
  onRowClick: (carouselId: string) => void;
}) {
  // ScreenRecorder a une colonne Titre (pas dans rows simplifié — on doit
  // remonter la pub originale via carouselId+plateforme pour récupérer le
  // titre). Map locale au mount.
  const titreByKey = new Map<string, string>();
  for (const p of fullPubs) {
    if (p.titre) titreByKey.set(`${p.carouselId}-${p.plateforme}`, p.titre);
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Hook</TableHead>
          <TableHead>Titre</TableHead>
          <TableHead>Plateforme</TableHead>
          <TableHead className="text-right">Vues</TableHead>
          <TableHead className="text-right">Likes</TableHead>
          <TableHead className="text-right">Subs gagnés</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((h, i) => {
          const titre =
            titreByKey.get(`${h.carouselId}-${h.plateforme}`) ?? "—";
          return (
            <TableRow
              key={`${h.carouselId}-${h.plateforme}`}
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => onRowClick(h.carouselId)}
            >
              <TableCell className="font-mono text-xs text-slate-500">
                #{i + 1}
              </TableCell>
              <TableCell
                className="max-w-[260px] truncate text-sm"
                title={h.hookText}
              >
                {h.hookText.length > 60
                  ? h.hookText.slice(0, 60) + "…"
                  : h.hookText}
              </TableCell>
              <TableCell
                className="max-w-[200px] truncate text-sm font-medium"
                title={titre}
              >
                {titre}
              </TableCell>
              <TableCell>
                <PlatformBadge plateforme={h.plateforme} />
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs">
                {formatNumber(h.vues)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-xs">
                {formatNumber(h.likes)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-sm font-medium">
                {formatNumber(h.subsGained)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
