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
import { costPerAcquisition, per1kViews } from "@/lib/analytics-hub";
import {
  CorrelationNote,
  HubCardHeader,
  HubEmptyState,
  HubNotice,
  dash,
} from "./HubPrimitives";
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
 * Vues et coûts viennent de Jarvia et s'affichent TOUJOURS ; seules les colonnes
 * inscrits/abonnés attendent les events PostHog.
 *
 * ⚠️ BASE DE VUES — cet onglet raisonne en vues PAYABLES (`payableViews`, posts
 * warmup exclus) et NON en vues totales, partout : ligne vidéo, agrégats par
 * créatrice, par format, et tous les ratios dérivés. Raison : le coût vient du
 * moteur de paie, qui exclut déjà le warmup ; mélanger un coût hors-warmup avec
 * des vues warmup-incluses produit un coût par abonné et un « abonnés/1 000
 * vues » faux par construction — or c'est précisément le chiffre sur lequel on
 * décide où mettre le budget. Les vues totales restent disponibles à l'export
 * (colonne « Vues totales »). Ne PAS réintroduire `totalViews` ici sans traiter
 * le coût de la même manière.
 */

/** Somme tolérante au null : tout-null ⇒ null (inconnu), pas 0. */
function sumNullable(rows: Row[], pick: (r: Row) => number | null): number | null {
  if (!rows.some((r) => pick(r) !== null)) return null;
  return rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
}

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
      .map(([id, list]) => {
        const subs = sumNullable(list, (r) => r.attributedSubs);
        const cost = sumCost(list);
        return {
          creatorId: id,
          creatorName: list[0].creatorName,
          videos: list.length,
          views: list.reduce((s, r) => s + r.payableViews, 0),
          cost,
          subs,
          costPerSub: cost !== null && subs !== null ? costPerAcquisition(cost, subs) : null,
        };
      })
      .sort((a, b) => (b.subs ?? -1) - (a.subs ?? -1) || b.views - a.views);
  }, [rows]);

  const perFormat = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = `${r.formatName ?? "Sans format"} · ${r.langue ?? "—"}`;
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .map(([key, list]) => {
        const views = list.reduce((s, r) => s + r.payableViews, 0);
        const subs = sumNullable(list, (r) => r.attributedSubs);
        return {
          key,
          videos: list.length,
          views,
          subs,
          subsPer1k: subs !== null ? per1kViews(subs, views) : null,
        };
      })
      .sort((a, b) => (b.subsPer1k ?? -1) - (a.subsPer1k ?? -1) || b.views - a.views);
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
        "Inscrits attribués",
        "Abonnés attribués",
        "Coût",
        "Coût par abonné",
      ],
      ...rows.map((r) => {
        const cps =
          r.cost !== null && r.attributedSubs !== null
            ? costPerAcquisition(r.cost, r.attributedSubs)
            : null;
        return [
          formatDate(r.publishedAt),
          r.creatorName,
          r.formatName ?? "",
          r.langue ?? "",
          r.platforms.join(" + "),
          String(r.postCount),
          String(r.totalViews),
          String(r.payableViews),
          r.attributedSignups === null ? "" : String(r.attributedSignups),
          r.attributedSubs === null ? "" : String(r.attributedSubs),
          r.cost === null ? "" : String(r.cost),
          cps === null ? "" : String(cps),
        ];
      }),
    ]);
  };

  if (data.rows.length === 0) {
    return (
      <HubEmptyState
        icon={FilmIcon}
        title="Aucune vidéo publiée"
        description="La table d'attribution se remplit dès qu'une mission passe en publiée. Les vues et les coûts viennent de Jarvia — ils ne dépendent ni de PostHog ni de Whop."
      />
    );
  }

  return (
    <div className="space-y-6">
      <HubNotice>
        <strong>Attribution par fenêtre 24 h, approximative.</strong> Les
        inscriptions et abonnements survenus dans les {data.windowHours} h suivant
        une publication lui sont attribués, sans lien tracké. Si plusieurs vidéos
        sont publiées le même jour, elles se partagent les mêmes conversions : ces
        chiffres sont des ordres de grandeur, pas une mesure exacte.
      </HubNotice>

      {!data.attributionAvailable ? (
        <HubNotice className="border-slate-200 bg-slate-50 text-slate-600">
          {data.posthogConfigured
            ? "Les colonnes « inscrits » et « abonnés » attendent les premiers événements PostHog. Vues et coûts sont déjà exploitables."
            : "PostHog n'est pas configuré sur ce projet : les colonnes « inscrits » et « abonnés » restent vides. Vues et coûts sont déjà exploitables."}
        </HubNotice>
      ) : null}

      {/* ─── Table posts → abonnés ───────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Vidéos → abonnés"
            subtitle="Une ligne par vidéo publiée (le coût du moteur de paie est par vidéo, jamais par post). Trié par abonnés attribués."
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
                  <TableHead className="text-right">Vues</TableHead>
                  <TableHead className="text-right">Inscrits</TableHead>
                  <TableHead className="text-right">Abonnés</TableHead>
                  <TableHead className="text-right">Coût</TableHead>
                  <TableHead className="text-right">Coût / abonné</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const cps =
                    r.cost !== null && r.attributedSubs !== null
                      ? costPerAcquisition(r.cost, r.attributedSubs)
                      : null;
                  return (
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
                            {!r.windowComplete && r.attributedSubs !== null ? (
                              <span
                                className="text-[10px] text-amber-600"
                                title="Les 24 h suivant la publication ne sont pas encore écoulées."
                              >
                                fenêtre partielle
                              </span>
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
                        {dash(r.attributedSignups)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold tabular-nums">
                        {dash(r.attributedSubs)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {dash(r.cost, formatMoney)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium tabular-nums">
                        {dash(cps, formatMoney)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-slate-400">
            Vues <strong>payables</strong> (posts warmup exclus), même base que le
            coût : fixe/vidéo + CPM du moteur de paie. Une vidéo entièrement
            warmup compte donc 0 vue ici — elle n&apos;est pas rémunérée. Le bonus
            paliers est attribué à la créatrice, pas à une vidéo : il n&apos;entre
            pas dans cette colonne. Les vues totales restent dans l&apos;export.
          </p>
        </CardContent>
      </Card>

      {/* ─── Coût par abonné, par créatrice ──────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Coût par abonné, par créatrice"
              subtitle="Agrégat de la table ci-dessus (vues payables, hors warmup)."
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Créatrice</TableHead>
                  <TableHead className="text-right">Vidéos</TableHead>
                  <TableHead className="text-right">Vues</TableHead>
                  <TableHead className="text-right">Abonnés</TableHead>
                  <TableHead className="text-right">Coût</TableHead>
                  <TableHead className="text-right">Coût / abonné</TableHead>
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
                      {dash(c.subs)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {dash(c.cost, formatMoney)}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold tabular-nums">
                      {dash(c.costPerSub, formatMoney)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <CorrelationNote />
          </CardContent>
        </Card>

        {/* ─── Format qui convertit ──────────────────────────────────────── */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Format qui convertit"
              subtitle="Abonnés pour 1 000 vues payables (hors warmup), par format et par langue."
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Format · langue</TableHead>
                  <TableHead className="text-right">Vidéos</TableHead>
                  <TableHead className="text-right">Vues</TableHead>
                  <TableHead className="text-right">Abonnés</TableHead>
                  <TableHead className="text-right">/ 1 000 vues</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perFormat.map((f) => (
                  <TableRow key={f.key}>
                    <TableCell className="text-xs font-medium text-slate-700">
                      {f.key}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {f.videos}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(f.views)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {dash(f.subs)}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold tabular-nums">
                      {dash(f.subsPer1k)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <CorrelationNote />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
