"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  HourglassIcon,
  Loader2Icon,
  RefreshCwIcon,
  WalletIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  useProjectMutation,
  useProjectQuerySafe,
} from "@/components/project/use-project-convex";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoTip } from "@/components/InfoTip";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import { parisDayKey } from "@/convex/comptaMath";
import { useComptaFormat } from "./compta-format";
import { ComptaThresholdCard } from "./ComptaThresholdCard";
import { ComptaMonthlyTable } from "./ComptaMonthlyTable";
import { ComptaTransfersCard } from "./ComptaTransfersCard";
import { ComptaChargesCard } from "./ComptaChargesCard";
import { ComptaTreasuryCard } from "./ComptaTreasuryCard";
import { ComptaMethod } from "./ComptaMethod";
import { ComptaClassifyDialog, type ClassifyTarget } from "./ComptaClassifyDialog";
import { ComptaExportDialog } from "./ComptaExportDialog";

export type ComptaOverview = FunctionReturnType<typeof api.compta.getComptaOverview>;

/**
 * ONGLET COMPTA — revenus du grand livre Whop, charges (créatrices versées,
 * scans, autres charges), résultat du mois, compteur des seuils de CA, export
 * pour le comptable. Les calculs vivent dans convex/compta.ts et
 * convex/comptaMath.ts : l'écran affiche, il ne recalcule pas.
 */
export function ComptaPage() {
  const t = useTranslations("admin.money.Compta");
  const f = useComptaFormat();
  const [year, setYear] = useState(() => Number(parisDayKey(Date.now()).slice(0, 4)));
  const overviewQ = useProjectQuerySafe(api.compta.getComptaOverview, { year });
  const requestSync = useProjectMutation(api.compta.requestComptaSync);
  const [syncing, setSyncing] = useState(false);
  const [now] = useState(() => Date.now());
  const [exportMonth, setExportMonth] = useState<string | null>(null);
  const [classify, setClassify] = useState<ClassifyTarget | null>(null);
  // « Voir le virement » depuis l'argent à récupérer : le bloc Virements se
  // rouvre sur le mois du retrait (le compteur force la réouverture).
  const [transfersFocus, setTransfersFocus] = useState<{ month: string; n: number } | null>(null);
  const transfersRef = useRef<HTMLDivElement>(null);

  if (overviewQ.status === "error") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
        {t("loadError", { error: overviewQ.error })}
      </div>
    );
  }
  const data = overviewQ.data;
  if (data === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-80 max-w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  async function onSync() {
    setSyncing(true);
    try {
      const r = await requestSync({});
      if (r.scheduled) toast.success(t("syncStarted"));
      else toast.info(t("syncNotConfigured"));
    } catch (e) {
      toast.error(convexErrorMessage(e, t("syncFailed")));
    } finally {
      setSyncing(false);
    }
  }

  const months = data.rows.map((r) => r.month);
  const defaultMonth = months.length > 0 ? months[months.length - 1] : data.currentMonth;
  // Les virements s'ouvrent sur le dernier mois qui en a : un mois en cours
  // sans virement afficherait un bloc vide à chaque visite.
  const lastTransferMonth =
    [...data.rows].reverse().find((r) => r.ledger.transfersReceived !== 0)?.month ?? defaultMonth;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{t("title")}</h1>
          <p className="text-sm text-slate-500">
            {data.currency
              ? t("subtitle", { year: data.year, currency: data.currency.toUpperCase() })
              : t("subtitleNoCurrency", { year: data.year })}
          </p>
          <SyncStatus data={data} now={now} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(year)}
            onValueChange={(v) => v !== null && setYear(Number(v))}
            items={Object.fromEntries(data.years.map((y) => [String(y), t("yearOption", { year: y })]))}
          >
            <SelectTrigger className="w-40" aria-label={t("yearOption", { year })}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {data.years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {t("yearOption", { year: y })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {data.configured && (
            <Button variant="outline" onClick={onSync} disabled={syncing}>
              {syncing ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-4" />
              )}
              {t("sync")}
            </Button>
          )}
          <Button onClick={() => setExportMonth(defaultMonth)} disabled={months.length === 0}>
            <DownloadIcon className="size-4" />
            {t("export")}
          </Button>
        </div>
      </header>

      {!data.configured ? (
        <Card>
          <CardContent className="space-y-2 py-12 text-center">
            <WalletIcon className="mx-auto size-6 text-slate-400" />
            <p className="font-medium text-slate-900">{t("notConfigured.title")}</p>
            <p className="mx-auto max-w-md text-sm text-slate-500">{t("notConfigured.body")}</p>
          </CardContent>
        </Card>
      ) : null}

      {data.unclassified.length > 0 && (
        <div
          className="grid items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto]"
          data-testid="compta-unclassified-banner"
        >
          <div className="flex items-start gap-2.5 text-sm text-amber-900">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <strong className="font-semibold">
                {t("banner.title", { count: data.unclassified.length })}
              </strong>
              <span className="block text-xs text-amber-800/90">
                {t("banner.body", {
                  types: data.unclassified.map((u) => u.lineType).join(", "),
                  lines: data.unclassified.reduce((s, u) => s + u.count, 0),
                  amount: f.signed(
                    data.unclassified.reduce((s, u) => s + u.amount, 0),
                    data.currency,
                  ),
                })}
              </span>
            </div>
          </div>
          <Button size="sm" onClick={() => setClassify({ kind: "pending" })}>
            {t("banner.action")}
          </Button>
        </div>
      )}

      {data.toRecover.length > 0 && (
        <RecoverBanner
          data={data}
          onSee={(month) => {
            setTransfersFocus((cur) => ({ month, n: (cur?.n ?? 0) + 1 }));
            transfersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <ComptaThresholdCard data={data} />
        <div className="grid gap-4">
          <ResultCard data={data} />
          <BalanceCard data={data} />
        </div>
      </div>

      {data.configured && <ComptaTreasuryCard />}

      <ComptaMonthlyTable data={data} onExport={(m) => setExportMonth(m)} />

      <div ref={transfersRef} className="scroll-mt-4">
        <ComptaTransfersCard
          key={transfersFocus ? `${transfersFocus.month}:${transfersFocus.n}` : "default"}
          months={months}
          defaultMonth={transfersFocus?.month ?? lastTransferMonth}
        />
      </div>

      <ComptaChargesCard
        months={months}
        defaultMonth={defaultMonth}
        currentMonth={data.currentMonth}
        neverSynced={data.sync.lastSyncAt === null}
      />

      <ComptaMethod data={data} onClassify={setClassify} />

      <ComptaClassifyDialog
        data={data}
        target={classify}
        onClose={() => setClassify(null)}
      />
      <ComptaExportDialog
        data={data}
        month={exportMonth}
        onMonthChange={setExportMonth}
        onClose={() => setExportMonth(null)}
      />
    </div>
  );
}

/**
 * ARGENT À RÉCUPÉRER — les parts de virement marquées « À récupérer » : sorties
 * de Whop, jamais arrivées. Toutes années : elles restent ici tant que l'usage
 * de la part ne change pas.
 */
function RecoverBanner({ data, onSee }: { data: ComptaOverview; onSee: (month: string) => void }) {
  const t = useTranslations("admin.money.Compta.recover");
  const f = useComptaFormat();
  const items = data.toRecover;
  const total = items.every((x) => x.converted !== null)
    ? f.money(items.reduce((s, x) => s + (x.converted ?? 0), 0), data.currency)
    : items.map((x) => f.money(x.amount, x.currency)).join(" + ");
  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50/70 px-4 py-3" data-testid="compta-recover-banner">
      <div className="flex items-start gap-2.5 text-sm text-orange-900">
        <HourglassIcon className="mt-0.5 size-4 shrink-0 text-orange-600" />
        <div className="min-w-0 flex-1">
          <strong className="font-semibold">{t("title", { amount: total })}</strong>
          <span className="block text-xs text-orange-800/90">{t("subtitle")}</span>
          <ul className="mt-2 space-y-1.5">
            {items.map((x) => (
              <li
                key={`${x.lineId}:${x.partId}`}
                className="grid items-center gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <span className="min-w-0">
                  <span className="font-semibold tabular-nums text-orange-950">{f.money(x.amount, x.currency)}</span>
                  {x.currency !== data.currency && x.converted !== null && (
                    <span className="tabular-nums text-orange-800/80"> (≈ {f.money(x.converted, data.currency)})</span>
                  )}
                  <span className="text-orange-900"> · {x.note ?? t("noNote")}</span>
                  <span className="block text-[11px] text-orange-800/80">
                    {t("meta", { date: f.day(x.day), destination: x.destination ?? "—", days: x.ageDays })}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-self-start border-orange-200 bg-white/70 text-orange-900 hover:bg-white sm:justify-self-end"
                  onClick={() => onSee(x.day.slice(0, 7))}
                >
                  {t("see")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SyncStatus({ data, now }: { data: ComptaOverview; now: number }) {
  const t = useTranslations("admin.money.Compta.status");
  const f = useComptaFormat();
  if (!data.configured) return null;
  const { sync } = data;
  const lines: { tone: "ok" | "warn"; text: string }[] = [];
  if (sync.lastSyncAt === null) {
    lines.push({ tone: "warn", text: t("never") });
  } else if (sync.lastError) {
    lines.push({
      tone: "warn",
      text: sync.lastError.includes("company:balance:read")
        ? t("scope")
        : t("error", { ago: f.ago(sync.lastSyncAt, now), error: sync.lastError }),
    });
  } else if (data.unclassified.length > 0) {
    lines.push({
      tone: "warn",
      text: t("pending", { ago: f.ago(sync.lastSyncAt, now), count: data.unclassified.length }),
    });
  } else {
    lines.push({ tone: "ok", text: t("ok", { ago: f.ago(sync.lastSyncAt, now) }) });
  }
  if (sync.lastSyncAt !== null && !sync.historyComplete) lines.push({ tone: "warn", text: t("partial") });
  if (sync.scanError) lines.push({ tone: "warn", text: t("scanError", { error: sync.scanError }) });
  // Avant le premier import, aucune devise n'a été vue : la référence est
  // inconnue par construction, et « jamais lu » le dit déjà. L'alerte ne vaut
  // qu'après un import qui n'a pas pu la fixer.
  if (data.currency === null && sync.lastSyncAt !== null) lines.push({ tone: "warn", text: t("noCurrency") });
  return (
    <div className="space-y-0.5" data-testid="compta-sync-status">
      {lines.map((l) => (
        <p key={l.text} className="flex items-start gap-1.5 text-xs text-slate-400">
          {l.tone === "ok" ? (
            <CheckCircle2Icon className="mt-px size-3.5 shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangleIcon className="mt-px size-3.5 shrink-0 text-amber-500" />
          )}
          <span className={cn(l.tone === "warn" && "text-amber-800/90")}>{l.text}</span>
        </p>
      ))}
    </div>
  );
}

function ResultCard({ data }: { data: ComptaOverview }) {
  const t = useTranslations("admin.money.Compta.kpi");
  const f = useComptaFormat();
  const { totals, currency } = data;
  const charges = totals.creators + totals.scans + totals.other;
  return (
    <Card className="py-0">
      <CardContent className="space-y-2 p-5">
        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          {t("result", { year: data.year })}
          <InfoTip label={t("resultInfoLabel")}>{t("resultInfo")}</InfoTip>
        </div>
        <div
          className={cn(
            "text-3xl font-semibold tracking-tight tabular-nums",
            totals.result >= 0 ? "text-emerald-700" : "text-red-600",
          )}
          data-testid="compta-result-total"
        >
          {f.signed(totals.result, currency)}
        </div>
        <div className="text-xs text-slate-500 tabular-nums">
          {t("resultDetail", { net: f.money(totals.net, currency), charges: f.money(charges, currency) })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500 tabular-nums">
          <span>
            {t("creators")}{" "}
            <span className="font-medium text-slate-700">{f.money(totals.creators, currency)}</span>
          </span>
          <span>
            {t("scans")}{" "}
            <span className="font-medium text-slate-700">{f.money(totals.scans, currency)}</span>
          </span>
          <span>
            {t("other")}{" "}
            <span className="font-medium text-slate-700">{f.money(totals.other, currency)}</span>
          </span>
        </div>
        {totals.incomplete && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700">
            <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
            {t("incomplete")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BalanceCard({ data }: { data: ComptaOverview }) {
  const t = useTranslations("admin.money.Compta.kpi");
  const f = useComptaFormat();
  const { balance, currency } = data;
  const unconverted = balance.byCurrency.filter((b) => b.converted === null);
  return (
    <Card className="py-0">
      <CardContent className="space-y-2 p-5">
        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          {t("balance")}
          <InfoTip label={t("balanceInfoLabel")}>{t("balanceInfo")}</InfoTip>
        </div>
        <div className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums" data-testid="compta-balance">
          {balance.converted === null ? "—" : f.signed(balance.converted, currency)}
        </div>
        <div className="text-xs text-slate-500 tabular-nums">
          {t("transfersYear", { amount: f.money(data.totals.transfersReceived, currency) })}
          {" · "}
          {balance.lastTransfer
            ? t("lastTransfer", {
                date: f.dayShort(parisDayKey(balance.lastTransfer.at)),
                amount: f.money(balance.lastTransfer.amount, balance.lastTransfer.currency),
              })
            : t("noTransfer")}
        </div>
        {unconverted.length > 0 && (
          <p className="text-xs text-amber-700">
            {t("balanceUnconverted", {
              list: unconverted.map((b) => f.money(b.amount, b.currency)).join(" · "),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
