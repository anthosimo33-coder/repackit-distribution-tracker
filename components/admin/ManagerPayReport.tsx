"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  managerPayByCreator,
  managerPayPeriods,
  sumManagerPayRows,
} from "@/convex/managerCpm";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/format-rate";
import { formatNumber } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";

type Payload = NonNullable<FunctionReturnType<typeof api.managerPay.getMyManagerPay>>;

const ALL = "all";

/**
 * RELEVÉ DE RÉMUNÉRATION D'UN MANAGER — partagé par son écran (« Ma
 * rémunération ») et par la carte du superadmin (« Rôles et droits »). Les deux
 * lisent le même payload serveur et le rendent ici : un chiffre ne peut pas
 * différer selon qui le regarde.
 *
 * L'écran ADDITIONNE des montants déjà calculés par le serveur (une ligne par
 * créatrice × mois) ; il ne multiplie jamais un CPM par des vues.
 */
export function ManagerPayReport({ data }: { data: Payload }) {
  const tr = useTranslations("admin.money.ManagerPayReport");
  const loc = useIntlLocale();
  const [period, setPeriod] = useState<string>(ALL);

  const periods = useMemo(() => managerPayPeriods(data.rows), [data.rows]);
  const selected = period === ALL ? null : period;
  const totals = sumManagerPayRows(data.rows, selected);
  const byCreator = managerPayByCreator(data.rows, selected);
  const nameOf = new Map(data.creators.map((c) => [c.creatorId as string, c.name]));
  const cpmOf = new Map(data.creators.map((c) => [c.creatorId as string, c.cpm]));

  const money = (n: number) => formatMoney(n, data.currency, loc);
  const cpmLabel = (cpm: number) => tr("cpmValeur", { cpm: money(cpm) });
  const monthLabel = (p: string) => {
    const [y, m] = p.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(loc, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  };

  // Les créatrices sans aucune vidéo sur la période restent listées : un taux
  // posé qui ne rapporte rien doit se voir, pas disparaître.
  const creatorRows = [
    ...byCreator,
    ...data.creators
      .filter((c) => !byCreator.some((b) => b.creatorId === c.creatorId))
      .map((c) => ({
        creatorId: c.creatorId as string,
        videos: 0,
        payableViews: 0,
        totalViews: 0,
        amount: 0,
      })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">{tr("periode")}</span>
        <Select value={period} onValueChange={(v) => v && setPeriod(v)}>
          <SelectTrigger className="h-8 w-52" aria-label={tr("periode")}>
            <SelectValue>
              {period === ALL ? tr("toutesPeriodes") : monthLabel(period)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value={ALL}>{tr("toutesPeriodes")}</SelectItem>
            {periods.map((p) => (
              <SelectItem key={p} value={p}>
                {monthLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label={tr("remuneration")} value={money(totals.amount)} strong />
        <Stat label={tr("vuesPayees")} value={formatNumber(totals.payableViews, loc)} />
        <Stat label={tr("videos")} value={formatNumber(totals.videos, loc)} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("creatrice")}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{tr("videos")}</TableHead>
                <TableHead className="text-right">{tr("vuesPayees")}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  {tr("vuesTotales")}
                </TableHead>
                <TableHead className="hidden text-right sm:table-cell">{tr("cpm")}</TableHead>
                <TableHead className="text-right">{tr("montant")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creatorRows.map((r) => (
                <TableRow key={r.creatorId}>
                  <TableCell className="max-w-32 truncate font-medium sm:max-w-48">
                    {nameOf.get(r.creatorId) ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {formatNumber(r.videos, loc)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(r.payableViews, loc)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums text-slate-500 sm:table-cell">
                    {formatNumber(r.totalViews, loc)}
                  </TableCell>
                  <TableCell className="hidden text-right text-slate-500 sm:table-cell">
                    {cpmLabel(cpmOf.get(r.creatorId) ?? 0)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(r.amount)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-slate-50">
                <TableCell className="font-semibold">{tr("total")}</TableCell>
                <TableCell className="hidden text-right font-semibold tabular-nums sm:table-cell">
                  {formatNumber(totals.videos, loc)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatNumber(totals.payableViews, loc)}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums text-slate-500 sm:table-cell">
                  {formatNumber(totals.totalViews, loc)}
                </TableCell>
                <TableCell className="hidden sm:table-cell" />
                <TableCell className="text-right font-semibold tabular-nums">
                  {money(totals.amount)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {period === ALL && periods.length > 0 && (
        <Card>
          <CardContent className="space-y-2 py-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {tr("parMois")}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("mois")}</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">{tr("videos")}</TableHead>
                  <TableHead className="text-right">{tr("vuesPayees")}</TableHead>
                  <TableHead className="text-right">{tr("montant")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => {
                  const t = sumManagerPayRows(data.rows, p);
                  return (
                    <TableRow key={p}>
                      <TableCell className="capitalize">{monthLabel(p)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {formatNumber(t.videos, loc)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(t.payableViews, loc)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {money(t.amount)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {totals.videos === 0 && (
        <p className="text-sm text-slate-500">{tr("aucuneVideo")}</p>
      )}
      <p className="text-xs leading-relaxed text-slate-500">{tr("explication")}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 px-3 py-3 sm:px-4 sm:py-4">
        <div className="truncate text-xs text-slate-500">{label}</div>
        <div
          className={
            strong
              ? "text-lg font-semibold tabular-nums text-slate-900 sm:text-2xl"
              : "text-lg font-medium tabular-nums text-slate-900 sm:text-xl"
          }
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
