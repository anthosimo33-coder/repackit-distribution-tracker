"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useConvex } from "convex/react";
import { toast } from "sonner";
import { AlertTriangleIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProject, useProjectId } from "@/components/project/ProjectProvider";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildJournalRows,
  buildSummaryRows,
  toSemicolonCsv,
  type ExportLabels,
  type JournalData,
} from "@/lib/compta-export";
import { downloadCsvText } from "@/lib/csv";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import { useComptaFormat } from "./compta-format";
import type { ComptaOverview } from "./ComptaPage";

type Kind = "journal" | "summary";

/** Libellés du fichier, traduits — le module d'export est pur. */
function useExportLabels(): ExportLabels {
  const t = useTranslations("admin.money.Compta.csv");
  const tb = useTranslations("admin.money.Compta.buckets");
  const tc = useTranslations("admin.money.Compta.categories");
  const tu = useTranslations("admin.money.Compta.usages");
  return useMemo(
    () => ({
      header: {
        date: t("date"),
        nature: t("nature"),
        post: t("post"),
        label: t("label"),
        reference: t("reference"),
        amount: t("amount"),
        currency: t("currency"),
        rate: t("rate"),
        converted: (currency) => t("converted", { currency }),
      },
      nature: {
        revenue: t("natureRevenue"),
        refund: t("natureRefund"),
        dispute: t("natureDispute"),
        fee: t("natureFee"),
        treasury: t("natureTreasury"),
        internal: t("natureInternal"),
        unclassified: t("natureUnclassified"),
        expense: t("natureExpense"),
      },
      bucket: {
        gross: tb("gross"),
        refunds: tb("refunds"),
        disputes: tb("disputes"),
        fees: tb("fees"),
        transfers: t("transferPost"),
        internal: tb("internal"),
        unclassified: tb("unclassified"),
      },
      creators: t("creators"),
      scans: t("scans"),
      other: (category) => t("other", { category }),
      category: {
        hosting: tc("hosting"),
        tools: tc("tools"),
        subscriptions: tc("subscriptions"),
        ads: tc("ads"),
        scans: tc("scans"),
        other: tc("other"),
      },
      creatorLine: (name, period) => t("creatorLine", { name, period }),
      advanceLine: (name) => t("advanceLine", { name }),
      unknownCreator: t("unknownCreator"),
      scanLine: (k) => (k === "light" ? t("scanLight") : k === "full" ? t("scanFull") : t("scanOther")),
      plannedSuffix: t("plannedSuffix"),
      transferLine: (destination) => t("transferLine", { destination: destination ?? t("bank") }),
      usage: {
        pay: tu("pay"),
        creators: tu("creators"),
        provision: tu("provision"),
        business: tu("business"),
        other: tu("other"),
      },
      summary: {
        month: t("summaryMonth"),
        post: t("summaryPost"),
        gross: t("summaryGross"),
        refunds: t("summaryRefunds"),
        disputes: t("summaryDisputes"),
        fees: t("summaryFees"),
        net: t("summaryNet"),
        creators: t("summaryCreators"),
        scans: t("summaryScans"),
        otherCategory: (category) => t("summaryOther", { category }),
        result: t("summaryResult"),
        transfers: t("summaryTransfers"),
        unclassified: t("summaryUnclassified"),
      },
    }),
    [t, tb, tc, tu],
  );
}

/**
 * EXPORT POUR LE COMPTABLE — un fichier par mois. Le journal du mois est lu À
 * LA DEMANDE (pas d'abonnement sur ~3 000 lignes), le CSV est construit dans le
 * navigateur par lib/compta-export (testé), et l'export est journalisé : une
 * règle posée plus tard sur ce mois préviendra qu'elle change un envoi.
 */
export function ComptaExportDialog({
  data,
  month,
  onMonthChange,
  onClose,
}: {
  data: ComptaOverview;
  month: string | null;
  onMonthChange: (m: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("admin.money.Compta.exportDialog");
  const f = useComptaFormat();
  const labels = useExportLabels();
  const convex = useConvex();
  const projectId = useProjectId();
  const { project } = useProject();
  const logExport = useProjectMutation(api.compta.logComptaExport);
  const [kind, setKind] = useState<Kind>("journal");
  const [journal, setJournal] = useState<{ month: string; data: JournalData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (month === null) return;
    let alive = true;
    convex
      .query(api.compta.getComptaJournal, { projectId, month })
      .then((d) => {
        if (alive) {
          setJournal({ month, data: d });
          setError(null);
        }
      })
      .catch((e) => {
        if (alive) setError(convexErrorMessage(e, t("failed")));
      });
    return () => {
      alive = false;
    };
  }, [convex, projectId, month, t]);

  const ready = journal !== null && journal.month === month;
  const rows = useMemo(() => {
    if (!ready) return null;
    return kind === "journal" ? buildJournalRows(journal.data, labels) : buildSummaryRows(journal.data, labels);
  }, [ready, journal, kind, labels]);
  const row = data.rows.find((r) => r.month === month);
  const fileName = `${project.slug}-compta-${month}${kind === "summary" ? "-recap" : ""}.csv`;

  async function download() {
    if (!rows || month === null) return;
    setBusy(true);
    try {
      downloadCsvText(fileName, toSemicolonCsv(rows));
      await logExport({ month, kind });
      toast.success(t("downloaded"));
      onClose();
    } catch (e) {
      toast.error(convexErrorMessage(e, t("failed")));
    } finally {
      setBusy(false);
    }
  }

  const months = data.rows.map((r) => r.month);
  return (
    <Dialog open={month !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-5xl" initialFocus={false}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">{t("month")}</Label>
            <Select
              value={month ?? ""}
              onValueChange={(v) => v && onMonthChange(v)}
              items={Object.fromEntries(months.map((m) => [m, f.month(m)]))}
            >
              <SelectTrigger className="w-full" data-testid="compta-export-month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {f.month(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">{t("content")}</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["journal", t("journal"), t("journalHint")],
                  ["summary", t("summary"), t("summaryHint")],
                ] as const
              ).map(([k, title, hint]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    kind === k ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-slate-200 hover:bg-slate-50",
                  )}
                  data-testid={`compta-export-kind-${k}`}
                >
                  <div className="text-sm font-medium text-slate-900">{title}</div>
                  <div className="text-xs text-slate-500">
                    {hint}
                    {ready && kind === k && rows ? ` · ${t("rows", { count: rows.length - 1 })}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Label className="text-xs text-slate-600">{t("preview")}</Label>
            <span className="font-mono text-[11px] text-slate-400">{fileName}</span>
          </div>
          {error ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p>
          ) : !rows ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-xs text-slate-500">
              <Loader2Icon className="size-4 animate-spin" />
              {t("loading")}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50" data-testid="compta-export-preview">
              <table className="w-full font-mono text-[11px]">
                <tbody>
                  {rows.slice(0, 8).map((r, i) => (
                    <tr
                      key={i}
                      className={cn(
                        "border-b border-slate-200/70 last:border-0",
                        i === 0 && "bg-slate-100 font-semibold text-slate-700",
                      )}
                    >
                      {r.map((c, j) => (
                        <td
                          key={j}
                          className={cn(
                            "whitespace-nowrap px-2 py-1 text-slate-600",
                            i > 0 && /^-?\d+(,\d+)?$/.test(c) && "text-right",
                          )}
                        >
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-slate-400">{kind === "journal" ? t("journalNote") : t("summaryNote")}</p>
          {row && row.incomplete.some((r) => r !== "unclassified") && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
              <AlertTriangleIcon className="mt-px size-3 shrink-0" />
              {t("incomplete")}
            </p>
          )}
          {row && row.ledger.unclassified.count > 0 && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
              <AlertTriangleIcon className="mt-px size-3 shrink-0" />
              {t("unclassified", { count: row.ledger.unclassified.count })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={download} disabled={!rows || busy} data-testid="compta-export-download">
            <DownloadIcon className="size-4" />
            {t("download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
