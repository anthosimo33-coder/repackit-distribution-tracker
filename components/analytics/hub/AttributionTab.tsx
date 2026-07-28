"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber } from "@/lib/format";
import { formatMoney } from "@/lib/format-rate";
import { downloadCsv } from "@/lib/csv";
import { HubCardHeader, HubEmptyState, HubNotice, dash } from "./HubPrimitives";
import { DownloadIcon, FilmIcon } from "lucide-react";
import type { AttributionData } from "./types";

type Row = AttributionData["rows"][number];

/**
 * Onglet ATTRIBUTION — le croisement Jarvia × PostHog.
 *
 * L'unité est la VIDÉO (assignment), pas le post : le moteur de paie mutualise
 * le fixe sur un groupe de pricing et calcule le CPM sur les vues d'une vidéo
 * (1 à 3 posts multi-plateformes). Un « coût par post » serait une allocation
 * inventée — cf convex/analyticsHub.ts.
 *
 * ⚠️ ATTRIBUTION 24 h SUPPRIMÉE (A3). Sans lien tracké, elle dupliquait chaque
 * inscription sur toutes les créatrices publiant le même jour. L'attribution
 * honnête (jours solo) est calculée côté serveur (getAttribution.soloDays,
 * getAttribution.creators) et rendue en phase B. Cet onglet ne montre donc plus
 * QUE ce qui est certain : coût et vues par vidéo (Jarvia, toujours dispo).
 *
 * ⚠️ BASE DE VUES — raisonne en vues PAYABLES (`payableViews`, warmup exclu),
 * même base que le coût du moteur de paie ; mélanger un coût hors-warmup avec des
 * vues warmup-incluses fausserait tout ratio. Les vues totales et promo restent à
 * l'export.
 */

function sumCost(rows: Row[]): number | null {
  if (!rows.some((r) => r.cost !== null)) return null;
  return Math.round(rows.reduce((s, r) => s + (r.cost ?? 0), 0) * 100) / 100;
}

export function AttributionTab({ data }: { data: AttributionData }) {
  const [creatorId, setCreatorId] = useState<string | null>(null);

  const creators = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of data.rows) map.set(r.creatorId, r.creatorName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data.rows]);

  const rows = useMemo(
    () => (creatorId ? data.rows.filter((r) => r.creatorId === creatorId) : data.rows),
    [data.rows, creatorId],
  );

  const perCreator = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const list = groups.get(r.creatorId) ?? [];
      list.push(r);
      groups.set(r.creatorId, list);
    }
    return [...groups.entries()]
      .map(([id, list]) => ({
        creatorId: id,
        creatorName: list[0].creatorName,
        videos: list.length,
        views: list.reduce((s, r) => s + r.payableViews, 0),
        cost: sumCost(list),
      }))
      .sort((a, b) => b.views - a.views);
  }, [rows]);

  const onExport = () => {
    downloadCsv("analytics-attribution.csv", [
      [
        "Date",
        "Créatrice",
        "Format",
        "Langue",
        "Plateformes",
        "Posts",
        "Vues totales",
        "Vues payables",
        "Vues promo",
        "Coût",
      ],
      ...rows.map((r) => [
        formatDate(r.publishedAt),
        r.creatorName,
        r.formatName ?? "",
        r.langue ?? "",
        r.platforms.join(" + "),
        String(r.postCount),
        String(r.totalViews),
        String(r.payableViews),
        String(r.promoViews),
        r.cost === null ? "" : String(r.cost),
      ]),
    ]);
  };

  if (data.rows.length === 0) {
    return (
      <HubEmptyState
        icon={FilmIcon}
        title="Aucune vidéo publiée"
        description="La table se remplit dès qu'une mission passe en publiée. Les vues et les coûts viennent de Jarvia — ils ne dépendent ni de PostHog ni de Whop."
      />
    );
  }

  return (
    <div className="space-y-6">
      <HubNotice>
        <strong>Attribution par jours solo.</strong> La fenêtre 24 h est retirée :
        sans lien tracké, elle attribuait les mêmes inscriptions à toutes les
        créatrices d&apos;un même jour. Seuls les jours où une seule créatrice a
        publié en promo donnent une attribution certaine — détail dans la vue
        dédiée. Ici : coût et vues par vidéo, toujours exacts.
      </HubNotice>

      {/* ─── Table coût & vues par vidéo ─────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Coût & vues par vidéo"
            subtitle="Une ligne par vidéo publiée (le coût du moteur de paie est par vidéo, jamais par post). Trié par vues payables."
            action={
              <Button variant="outline" size="sm" onClick={onExport}>
                <DownloadIcon className="size-4" />
                Exporter
              </Button>
            }
          />

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setCreatorId(null)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                creatorId === null
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              Toutes
            </button>
            {creators.map(([id, name]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCreatorId(id)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  creatorId === id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vidéo</TableHead>
                  <TableHead>Créatrice</TableHead>
                  <TableHead className="text-right">Vues payables</TableHead>
                  <TableHead className="text-right">Vues promo</TableHead>
                  <TableHead className="text-right">Coût</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.assignmentId}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-slate-700">
                          {formatDate(r.publishedAt)}
                          {r.formatName ? ` · ${r.formatName}` : ""}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {r.platforms.map((p) => (
                            <Badge
                              key={p}
                              variant="outline"
                              className="text-[10px] text-slate-600"
                            >
                              {p}
                            </Badge>
                          ))}
                          {r.langue ? (
                            <span className="text-[10px] text-slate-400">
                              {r.langue}
                            </span>
                          ) : null}
                          {r.isWarmupOnly ? (
                            <Badge
                              variant="outline"
                              className="border-amber-200 bg-amber-50 text-[10px] text-amber-700"
                            >
                              warmup
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      {r.creatorName}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(r.payableViews)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-slate-500">
                      {formatNumber(r.promoViews)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {dash(r.cost, formatMoney)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-slate-400">
            Vues <strong>payables</strong> (posts warmup exclus), même base que le
            coût : fixe/vidéo + CPM du moteur de paie. Vues <strong>promo</strong>
            {" "}(non-warmup) = base des taux de conversion, jamais additionnée aux
            autres. Les vues totales restent dans l&apos;export.
          </p>
        </CardContent>
      </Card>

      {/* ─── Coût & vues par créatrice ───────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Coût & vues par créatrice"
            subtitle="Agrégat de la table ci-dessus (vues payables, hors warmup)."
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Créatrice</TableHead>
                <TableHead className="text-right">Vidéos</TableHead>
                <TableHead className="text-right">Vues payables</TableHead>
                <TableHead className="text-right">Coût</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perCreator.map((c) => (
                <TableRow key={c.creatorId}>
                  <TableCell className="text-xs font-medium text-slate-700">
                    {c.creatorName}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {c.videos}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatNumber(c.views)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {dash(c.cost, formatMoney)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
