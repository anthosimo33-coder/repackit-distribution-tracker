"use client";

import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  FileSpreadsheetIcon,
  InfoIcon,
  Link2Icon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isScanPaidLow, previousMonthKey } from "@/convex/comptaMath";
import { useComptaFormat, type ComptaFormat } from "./compta-format";
import type { ComptaOverview } from "./ComptaPage";

const NUM = "text-right tabular-nums";
const GROUP = "border-l border-slate-200";
const HEAD = "h-8 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400";

type Row = ComptaOverview["rows"][number];

/** Un montant de sortie (« −19,96 € »), un zéro mesuré en retrait, un inconnu en tiret. */
function Amount({
  v,
  currency,
  f,
  strong,
  title,
  warn,
  testId,
}: {
  v: number | null;
  currency: string | null;
  f: ComptaFormat;
  strong?: boolean;
  title?: string;
  /** Chiffre juste mais à vérifier : souligné en ambre, l'explication au survol. */
  warn?: boolean;
  testId?: string;
}) {
  if (warn && v !== null) {
    return (
      <span
        className="inline-flex items-center gap-1 text-amber-700 underline decoration-amber-300 decoration-dotted underline-offset-4"
        title={title}
        data-testid={testId}
      >
        <AlertTriangleIcon className="size-3 shrink-0" />
        {f.signed(v, currency)}
      </span>
    );
  }
  if (v === null) {
    return (
      <span className="text-slate-400" title={title}>
        —
      </span>
    );
  }
  if (v === 0) return <span className="text-slate-300" title={title}>{f.money(0, currency)}</span>;
  return (
    <span className={cn(v < 0 ? "text-slate-600" : "text-slate-900", strong && "font-semibold")} title={title}>
      {f.signed(v, currency)}
    </span>
  );
}

export function ComptaMonthlyTable({
  data,
  onExport,
}: {
  data: ComptaOverview;
  onExport: (month: string) => void;
}) {
  const t = useTranslations("admin.money.Compta.table");
  const f = useComptaFormat();
  const [open, setOpen] = useState<string | null>(null);
  const cur = data.currency;
  const first = data.rows[0]?.month ?? null;
  const yearStart = `${data.year}-01`;
  // Mois de l'exercice AVANT le premier mouvement : une seule ligne, pas six vides.
  const emptyBefore = first !== null && first > yearStart;

  return (
    <Card className="gap-0 py-0" data-testid="compta-monthly-table">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-base font-semibold text-slate-900">{t("title")}</h2>
        <p className="text-xs text-slate-500">{t("subtitle")}</p>
      </div>
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 pl-5" />
            <TableHead colSpan={5} className={cn(HEAD, GROUP)}>
              {t("groupRevenue")}
            </TableHead>
            <TableHead colSpan={3} className={cn(HEAD, GROUP)}>
              {t("groupCharges")}
            </TableHead>
            <TableHead className={cn("h-8 bg-primary/5", GROUP)} />
            <TableHead className={cn(HEAD, GROUP)}>{t("groupTreasury")}</TableHead>
            <TableHead className="h-8" />
          </TableRow>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-5 text-xs text-slate-500">{t("month")}</TableHead>
            <TableHead className={cn(NUM, GROUP, "text-xs text-slate-500")}>{t("gross")}</TableHead>
            <TableHead className={cn(NUM, "text-xs text-slate-500")}>{t("refunds")}</TableHead>
            <TableHead className={cn(NUM, "text-xs text-slate-500")}>{t("disputes")}</TableHead>
            <TableHead className={cn(NUM, "text-xs text-slate-500")}>{t("fees")}</TableHead>
            <TableHead className={cn(NUM, "bg-slate-50 text-xs text-slate-700")}>{t("net")}</TableHead>
            <TableHead className={cn(NUM, GROUP, "text-xs text-slate-500")}>{t("creators")}</TableHead>
            <TableHead className={cn(NUM, "text-xs text-slate-500")}>{t("scans")}</TableHead>
            <TableHead className={cn(NUM, "text-xs text-slate-500")}>{t("other")}</TableHead>
            <TableHead className={cn(NUM, GROUP, "bg-primary/5 text-xs text-slate-700")}>{t("result")}</TableHead>
            <TableHead className={cn(NUM, GROUP, "text-xs text-slate-500")}>{t("transfers")}</TableHead>
            <TableHead className="w-10 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={12} className="py-10 text-center text-sm text-slate-500">
                {t("empty", { year: data.year })}
              </TableCell>
            </TableRow>
          ) : first !== null && emptyBefore ? (
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-5 text-slate-400">
                {first === `${data.year}-02`
                  ? f.monthShort(yearStart)
                  : `${f.monthShort(yearStart)} → ${f.monthShort(previousMonthKey(first))}`}
              </TableCell>
              <TableCell colSpan={11} className={cn(GROUP, "text-xs text-slate-400")}>
                {t("emptyBefore")}
              </TableCell>
            </TableRow>
          ) : null}
          {data.rows.map((r) => (
            <MonthRows
              key={r.month}
              r={r}
              currency={cur}
              open={open === r.month}
              onToggle={() => setOpen((o) => (o === r.month ? null : r.month))}
              onExport={() => onExport(r.month)}
            />
          ))}
        </TableBody>
        {data.rows.length > 0 && (
          <TableFooter className="bg-slate-50/80">
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-5 font-semibold text-slate-900">{t("total", { year: data.year })}</TableCell>
              <TableCell className={cn(NUM, GROUP, "font-semibold")}>
                <Amount v={data.totals.gross} currency={cur} f={f} />
              </TableCell>
              <TableCell className={NUM}>
                <Amount v={data.totals.refunds} currency={cur} f={f} />
              </TableCell>
              <TableCell className={NUM}>
                <Amount v={data.totals.disputes} currency={cur} f={f} />
              </TableCell>
              <TableCell className={NUM}>
                <Amount v={data.totals.fees} currency={cur} f={f} />
              </TableCell>
              <TableCell className={cn(NUM, "bg-slate-100/70 font-semibold text-slate-900")}>
                {f.signed(data.totals.net, cur)}
              </TableCell>
              <TableCell className={cn(NUM, GROUP)}>
                <Amount v={-data.totals.creators} currency={cur} f={f} />
              </TableCell>
              <TableCell className={NUM}>
                <Amount v={-data.totals.scans} currency={cur} f={f} />
              </TableCell>
              <TableCell className={NUM}>
                <Amount v={-data.totals.other} currency={cur} f={f} />
              </TableCell>
              <TableCell
                className={cn(
                  NUM,
                  GROUP,
                  "bg-primary/10 font-semibold",
                  data.totals.result >= 0 ? "text-emerald-700" : "text-red-600",
                )}
              >
                {f.signed(data.totals.result, cur)}
              </TableCell>
              <TableCell className={cn(NUM, GROUP, "font-medium text-slate-900")}>
                <Amount v={data.totals.transfersReceived} currency={cur} f={f} />
              </TableCell>
              <TableCell className="pr-4" />
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </Card>
  );
}

function MonthRows({
  r,
  currency,
  open,
  onToggle,
  onExport,
}: {
  r: Row;
  currency: string | null;
  open: boolean;
  onToggle: () => void;
  onExport: () => void;
}) {
  const t = useTranslations("admin.money.Compta.table");
  const f = useComptaFormat();
  const reasons = r.incomplete.map((k) => t(`reason.${k as "unclassified"}`));
  return (
    <Fragment>
      <TableRow
        aria-expanded={open}
        onClick={onToggle}
        className={cn("cursor-pointer", open && "border-b-0 bg-slate-50")}
        data-testid={`compta-row-${r.month}`}
      >
        <TableCell className="pl-5">
          <span className="flex items-center gap-1.5 font-medium text-slate-900">
            <ChevronRightIcon className={cn("size-3.5 text-slate-400 transition-transform", open && "rotate-90")} />
            {f.monthName(r.month)}
            {r.inProgress && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-px text-[10px] font-medium text-slate-500">
                {t("inProgress")}
              </span>
            )}
            {r.ledger.unclassified.count > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700">
                <AlertTriangleIcon className="size-2.5" />
                {t("toClassify", { count: r.ledger.unclassified.count })}
              </span>
            )}
            {reasons.length > 0 && r.ledger.unclassified.count === 0 && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className="inline-flex size-4 items-center justify-center text-amber-600"
                      aria-label={t("incompleteTitle")}
                    >
                      <AlertTriangleIcon className="size-3.5" />
                    </span>
                  }
                />
                <TooltipContent>{t("incompleteList", { reasons: reasons.join(" · ") })}</TooltipContent>
              </Tooltip>
            )}
          </span>
        </TableCell>
        <TableCell className={cn(NUM, GROUP)}>
          <Amount v={r.ledger.gross} currency={currency} f={f} />
        </TableCell>
        <TableCell className={NUM}>
          <Amount v={r.ledger.refunds} currency={currency} f={f} />
        </TableCell>
        <TableCell className={NUM}>
          <Amount v={r.ledger.disputes} currency={currency} f={f} />
        </TableCell>
        <TableCell className={NUM}>
          <Amount v={r.ledger.fees} currency={currency} f={f} />
        </TableCell>
        <TableCell className={cn(NUM, "bg-slate-50 font-semibold text-slate-900")}>
          {f.signed(r.ledger.net, currency)}
        </TableCell>
        <TableCell className={cn(NUM, GROUP)}>
          <Amount
            v={r.creators === null ? null : -r.creators}
            currency={currency}
            f={f}
            warn={r.creatorsControl?.significant ?? false}
            testId={`compta-creators-${r.month}`}
            title={
              r.creatorsControl?.significant && r.creatorsControl.gap !== null
                ? t("creatorsGapTitle", {
                    sent: f.money(r.creatorsControl.sent ?? 0, currency),
                    paid: f.money(r.creatorsControl.paid ?? 0, currency),
                    gap: f.delta(r.creatorsControl.gap, currency),
                  })
                : t("reason.creatorsCurrency")
            }
          />
        </TableCell>
        <TableCell className={NUM}>
          <Amount
            v={r.scans === null ? null : -r.scans}
            currency={currency}
            f={f}
            warn={r.scanPaidLow}
            testId={`compta-scans-${r.month}`}
            title={
              r.scanPaidLow && r.scans !== null && r.scanEstimate !== null
                ? t("scanPaidLowTitle", { paid: f.money(r.scans, currency), estimate: f.money(r.scanEstimate, currency) })
                : r.scanSource === "paid"
                ? r.scans === null
                  ? t("reason.scanPaidCurrency")
                  : t("scanPaidTitle")
                : r.incomplete.includes("scanUnknown")
                  ? t("reason.scanUnknown")
                  : r.scans === null
                    ? t("reason.scanMissing")
                    : t("scanEstimateTitle")
            }
          />
        </TableCell>
        <TableCell className={NUM}>
          <Amount v={-r.other} currency={currency} f={f} />
        </TableCell>
        <TableCell
          className={cn(
            NUM,
            GROUP,
            "bg-primary/5 font-semibold",
            r.result >= 0 ? "text-emerald-700" : "text-red-600",
          )}
        >
          {f.signed(r.result, currency)}
        </TableCell>
        <TableCell className={cn(NUM, GROUP)}>
          <Amount v={r.ledger.transfersReceived} currency={currency} f={f} />
        </TableCell>
        <TableCell className="pr-4 text-right">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("exportMonth", { month: f.month(r.month) })}
            onClick={(e) => {
              e.stopPropagation();
              onExport();
            }}
          >
            <FileSpreadsheetIcon className="size-4 text-slate-400" />
          </Button>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-slate-50 hover:bg-slate-50">
          <TableCell colSpan={12} className="whitespace-normal px-5 pt-1 pb-5">
            <MonthDetail month={r.month} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

// ─── Détail d'un mois ───────────────────────────────────────────────────────

function Panel({
  title,
  aside,
  children,
  testId,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        {aside && <span className="text-[11px] text-slate-400">{aside}</span>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

const BUCKET_ORDER = ["gross", "refunds", "disputes", "fees", "transfers", "internal", "unclassified"] as const;

type MonthData = FunctionReturnType<typeof api.compta.getComptaMonth>;

/**
 * Contrôle créatrices d'un mois : la paie marquée versée (au-dessus) face à
 * l'argent sorti de Whop pour elles d'après la ventilation des virements.
 */
function CreatorsControl({ c, cur }: { c: NonNullable<MonthData["creatorsControl"]>; cur: string | null }) {
  const t = useTranslations("admin.money.Compta.detail");
  const f = useComptaFormat();
  const tone = c.gap === null ? "text-slate-500" : c.significant ? "text-amber-700" : "text-emerald-700";
  return (
    <div className="mt-2 space-y-0.5 rounded-md bg-slate-50 px-2 py-1.5 text-xs" data-testid="compta-creators-control">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-slate-600">{t("creatorsSent")}</span>
        <span className="tabular-nums text-slate-700">{c.sent === null ? "—" : f.money(c.sent, cur)}</span>
      </div>
      <div className={cn("flex items-baseline justify-between gap-2 font-medium", tone)}>
        <span>{t("creatorsGap")}</span>
        <span className="tabular-nums">{c.gap === null ? "—" : f.delta(c.gap, cur)}</span>
      </div>
      <p className={cn("flex items-start gap-1 text-[11px]", tone)}>
        {c.significant ? (
          <AlertTriangleIcon className="mt-px size-3 shrink-0" />
        ) : c.gap !== null ? (
          <CheckCircle2Icon className="mt-px size-3 shrink-0" />
        ) : null}
        {c.gap === null
          ? t("creatorsGapNoRate")
          : !c.significant
            ? t("creatorsGapOk")
            : c.gap > 0
              ? t("creatorsGapMore")
              : t("creatorsGapLess")}
      </p>
    </div>
  );
}

function MonthDetail({ month }: { month: string }) {
  const t = useTranslations("admin.money.Compta.detail");
  const tb = useTranslations("admin.money.Compta.buckets");
  const tu = useTranslations("admin.money.Compta.usages");
  const tc = useTranslations("admin.money.Compta.categories");
  const f = useComptaFormat();
  const router = useRouter();
  const projectPath = useProjectPath();
  const d = useProjectQuery(api.compta.getComptaMonth, { month });
  if (d === undefined) {
    return (
      <div className="space-y-2 py-2" aria-label={t("loading")}>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const cur = d.currency;
  const lineCount = d.types.reduce((s, x) => s + x.count, 0);
  const openingDay = `${previousMonthKey(month)}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 0)).getUTCDate()).padStart(2, "0")}`;
  const closingDay = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
  const scanParts = (d.scan?.parts ?? []).filter((p) => p.usd !== 0 || p.kind !== "other");

  return (
    <div className="space-y-3" data-testid={`compta-detail-${month}`}>
      {d.foreign.length > 0 && cur && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-900">
          <InfoIcon className="mt-px size-3.5 shrink-0" />
          <span>
            {t("foreign", {
              currency: cur.toUpperCase(),
              list: d.foreign
                .map((x) =>
                  x.rate === null
                    ? t("foreignNoRate", { currency: x.currency.toUpperCase() })
                    : t("foreignItem", { currency: x.currency.toUpperCase(), rate: f.rate(x.rate) }),
                )
                .join(" · "),
            })}
          </span>
        </div>
      )}
      <div className="grid items-start gap-3 lg:grid-cols-[1.6fr_1fr_0.95fr]">
        <Panel title={t("revenue")} aside={t("revenueLines", { count: lineCount })} testId="compta-detail-revenue">
          <div className="space-y-3">
            {BUCKET_ORDER.filter((b) => b !== "transfers").map((b) => {
              const lines = d.types.filter((x) => x.bucket === b);
              if (lines.length === 0 && (b === "internal" || b === "unclassified")) return null;
              const total = lines.reduce((s, x) => s + (x.converted ?? 0), 0);
              return (
                <div key={b}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className={cn("font-medium", b === "unclassified" ? "text-amber-700" : "text-slate-700")}>
                      {tb(b)}
                    </span>
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        b === "internal" || b === "unclassified" ? "text-slate-400" : "text-slate-900",
                      )}
                    >
                      {f.signed(Math.round(total * 100) / 100, cur)}
                    </span>
                  </div>
                  {lines.length === 0 ? (
                    <p className="mt-0.5 text-[11px] text-slate-400">{t("noLines")}</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {lines.map((x) => (
                        <li
                          key={`${x.lineType}|${x.currency}`}
                          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 text-[11px]"
                        >
                          <span className="min-w-0 truncate text-slate-500">
                            <code className="rounded bg-slate-100 px-1 py-px font-mono text-[10px] text-slate-600">
                              {x.lineType}
                            </code>
                            {x.currency !== cur && (
                              <span className="ml-1.5 text-slate-400">{f.signed(x.amount, x.currency)}</span>
                            )}
                          </span>
                          <span className="text-right tabular-nums text-slate-400">
                            {t("linesShort", { count: f.int(x.count) })}
                          </span>
                          <span className="w-24 text-right tabular-nums text-slate-600">
                            {x.converted === null ? t("noRate") : f.signed(x.converted, cur)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
              <span className="font-semibold text-slate-900">{t("net")}</span>
              <span className="font-semibold tabular-nums text-slate-900">{f.signed(d.ledger.net, cur)}</span>
            </div>
            {d.ledger.unclassified.count === 0 ? (
              <p className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                <CheckCircle2Icon className="size-3.5" />
                {t("allClassified")}
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-[11px] text-amber-700">
                <AlertTriangleIcon className="size-3.5" />
                {t("unclassifiedLeft", { count: d.ledger.unclassified.count })}
              </p>
            )}
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel title={t("creatorsTitle")} aside={t("creatorsAside")} testId="compta-detail-creators">
            {d.creators.length === 0 ? (
              <p className="text-xs text-slate-400">{t("creatorsNone")}</p>
            ) : (
              <>
                <ul className="space-y-1 text-xs">
                  {d.creators.map((c, i) => (
                    <li key={i} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto_auto] items-baseline gap-2">
                      <span className="tabular-nums text-slate-400">{f.dayShort(c.day)}</span>
                      <span className="min-w-0 truncate text-slate-700">
                        {c.name ?? t("creatorDeleted")}
                        {c.kind === "advance" && (
                          <span className="text-[11px] text-slate-400"> · {t("advance")}</span>
                        )}
                      </span>
                      <span className="text-right text-[11px] tabular-nums text-slate-400">
                        {f.money(c.amount, d.payCurrency)}
                      </span>
                      <span className="w-20 text-right tabular-nums text-slate-700">
                        {c.converted === null ? t("noRate") : f.money(c.converted, cur)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-baseline justify-between border-t border-slate-100 pt-2 text-xs">
                  <span className="font-medium text-slate-700">
                    {d.creatorsTotal.rate === null
                      ? t("creatorsTotalNoRate", { pay: f.money(d.creatorsTotal.pay, d.payCurrency) })
                      : t("creatorsTotal", {
                          pay: f.money(d.creatorsTotal.pay, d.payCurrency),
                          rate: f.rate(d.creatorsTotal.rate),
                        })}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {d.creatorsTotal.converted === null ? "—" : f.signed(-d.creatorsTotal.converted, cur)}
                  </span>
                </div>
              </>
            )}
            {d.creatorsControl && <CreatorsControl c={d.creatorsControl} cur={cur} />}
            <button
              type="button"
              onClick={() => router.push(projectPath("/paiements"))}
              className="mt-2 text-[11px] font-medium text-primary hover:underline"
            >
              {t("creatorsLink")}
            </button>
          </Panel>

          <Panel
            title={t("scansTitle")}
            aside={d.scanSource === "paid" ? t("scansAsidePaid") : t("scansAside")}
            testId="compta-detail-scans"
          >
            {d.scanSource === "paid" ? (
              <>
                <ul className="space-y-1 text-xs">
                  {d.scanPaid.map((c) => (
                    <li key={c.id} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto_auto] items-baseline gap-2">
                      <span className="tabular-nums text-slate-400">{f.dayShort(c.day)}</span>
                      <span className="min-w-0 truncate text-slate-700">
                        {c.label}
                        {c.transferLineId !== null && (
                          <Link2Icon
                            className="ml-1 inline size-3 text-slate-300"
                            aria-label={t("scansFromTransfer", { date: f.dayShort(c.day) })}
                          />
                        )}
                      </span>
                      <span className="text-right text-[11px] tabular-nums text-slate-400">
                        {c.currency !== cur ? f.money(c.amount, c.currency) : ""}
                      </span>
                      <span className="w-20 text-right tabular-nums text-slate-700">
                        {c.converted === null ? t("noRate") : f.money(c.converted, cur)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-baseline justify-between border-t border-slate-100 pt-2 text-xs">
                  <span className="font-medium text-slate-700">{t("scansPaidTotal")}</span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {d.scanTotal === null ? "—" : f.signed(-d.scanTotal, cur)}
                  </span>
                </div>
                {d.scan?.converted !== null && d.scan?.converted !== undefined &&
                  (isScanPaidLow(d.scanTotal, d.scan.converted) ? (
                    <p
                      className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-700"
                      data-testid="compta-detail-scans-low"
                    >
                      <AlertTriangleIcon className="mt-px size-3 shrink-0" />
                      {t("scansPaidLow", { estimate: f.money(d.scan.converted, cur) })}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      {t("scansEstimateCompare", { amount: f.money(d.scan.converted, cur) })}
                    </p>
                  ))}
              </>
            ) : d.scan === null ? (
              <p className="text-xs text-slate-400">{t("scansMissing")}</p>
            ) : d.scan.usd === null ? (
              <p className="text-xs text-amber-700">{t("scansUnknown", { runs: f.int(d.scan.runs) })}</p>
            ) : (
              <>
                <ul className="space-y-1 text-xs">
                  {scanParts.map((p) => (
                    <li key={p.kind} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-2">
                      <span className="text-slate-700">
                        {p.kind === "light" ? t("scanLight") : p.kind === "full" ? t("scanFull") : t("scanOther")}
                      </span>
                      <span className="text-right text-[11px] tabular-nums text-slate-400">
                        {f.money(p.usd, d.scanCurrency)}
                      </span>
                      <span className="w-20 text-right tabular-nums text-slate-700">
                        {p.converted === null ? t("noRate") : f.money(p.converted, cur)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-baseline justify-between border-t border-slate-100 pt-2 text-xs">
                  <span className="font-medium text-slate-700">
                    {d.scan.rate === null
                      ? f.money(d.scan.usd, d.scanCurrency)
                      : t("scansTotal", { usd: f.money(d.scan.usd, d.scanCurrency), rate: f.rate(d.scan.rate) })}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {d.scan.converted === null ? "—" : f.signed(-d.scan.converted, cur)}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  {t("scanRuns", { count: f.int(d.scan.runs) })} · {d.scan.frozen ? t("scansFrozen") : t("scansLive")}
                </p>
              </>
            )}
          </Panel>

          <Panel
            title={t("otherTitle")}
            aside={t("otherAside", { count: d.charges.length })}
            testId="compta-detail-other"
          >
            {d.charges.length === 0 ? (
              <p className="text-xs text-slate-400">{t("otherNone")}</p>
            ) : (
              <>
                <ul className="space-y-1 text-xs">
                  {Object.entries(
                    d.charges.reduce<Record<string, { n: number; v: number | null }>>((acc, c) => {
                      const a = acc[c.category] ?? { n: 0, v: 0 };
                      a.n += 1;
                      a.v = a.v === null || c.converted === null ? null : a.v + c.converted;
                      acc[c.category] = a;
                      return acc;
                    }, {}),
                  ).map(([cat, a]) => (
                    <li key={cat} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
                      <span className="text-slate-700">
                        {tc(cat as "hosting")} <span className="text-[11px] text-slate-400">· {a.n}</span>
                      </span>
                      <span className="w-20 text-right tabular-nums text-slate-700">
                        {a.v === null ? t("noRate") : f.money(Math.round(a.v * 100) / 100, cur)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-baseline justify-between border-t border-slate-100 pt-2 text-xs">
                  <span className="font-medium text-slate-700">{t("otherTotal")}</span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {f.signed(
                      -Math.round(d.charges.reduce((s, c) => s + (c.converted ?? 0), 0) * 100) / 100,
                      cur,
                    )}
                  </span>
                </div>
              </>
            )}
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel title={t("transfersTitle")} aside={t("transfersAside")} testId="compta-detail-transfers">
            {d.transfers.filter((x) => !x.failed).length === 0 ? (
              <p className="text-xs text-slate-400">{t("transfersNone")}</p>
            ) : (
              <>
                <ul className="space-y-1 text-xs">
                  {d.transfers
                    .filter((x) => !x.failed)
                    .map((x) => (
                      <li key={x._id} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-baseline gap-2">
                        <span className="tabular-nums text-slate-400">{f.dayShort(x.day)}</span>
                        <span className="min-w-0 truncate">
                          {x.parts.length === 0 ? (
                            <span className="italic text-slate-400">{t("noUsage")}</span>
                          ) : x.parts.length === 1 ? (
                            <span className="text-slate-600">{tu(x.parts[0].usage)}</span>
                          ) : (
                            <span className="text-slate-600">{t("transferParts", { count: x.parts.length })}</span>
                          )}
                        </span>
                        <span className="text-right tabular-nums text-slate-700">{f.money(x.amount, x.currency)}</span>
                      </li>
                    ))}
                </ul>
                <div className="mt-2 flex items-baseline justify-between border-t border-slate-100 pt-2 text-xs">
                  <span className="font-medium text-slate-700">
                    {t("transfersCount", { count: d.transfers.filter((x) => !x.failed).length })}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {f.money(d.ledger.transfersReceived, cur)}
                  </span>
                </div>
              </>
            )}
          </Panel>
          <Panel title={t("reconTitle")} testId="compta-detail-recon">
            {d.reconciliation.opening === null || d.reconciliation.closing === null ? (
              <p className="text-xs text-amber-700">{t("reconNoRate")}</p>
            ) : (
              <>
                <dl className="space-y-1 text-xs tabular-nums">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{t("opening", { date: f.dayShort(openingDay) })}</dt>
                    <dd className="text-slate-700">{f.signed(d.reconciliation.opening, cur)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{t("plusNet")}</dt>
                    <dd className="text-slate-700">{f.signed(d.reconciliation.net, cur)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">{t("minusTransfers")}</dt>
                    <dd className="text-slate-700">{f.signed(-d.reconciliation.transfersReceived, cur)}</dd>
                  </div>
                  {d.reconciliation.otherMovements !== 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500" title={t("otherMovementsHint")}>
                        {t("otherMovements")}
                      </dt>
                      <dd className="text-slate-700">{f.signed(d.reconciliation.otherMovements, cur)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-100 pt-1 font-semibold">
                    <dt className="text-slate-900">{t("closing", { date: f.dayShort(closingDay) })}</dt>
                    <dd className="text-slate-900">{f.signed(d.reconciliation.closing, cur)}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-[11px] text-slate-400">{t("reconNote")}</p>
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
