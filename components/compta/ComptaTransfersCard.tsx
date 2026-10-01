"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { CheckCircle2Icon, ClockIcon, InfoIcon, LandmarkIcon, MessageSquareTextIcon, PencilIcon, XCircleIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { TRANSFER_USAGES, parisDayKey, type TransferUsage } from "@/convex/comptaMath";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import { useComptaFormat } from "./compta-format";

type Transfer = FunctionReturnType<typeof api.compta.listComptaTransfers>[number];

const USAGE_BADGE: Record<TransferUsage, string> = {
  pay: "bg-violet-50 text-violet-700",
  creators: "bg-amber-50 text-amber-700",
  provision: "bg-sky-50 text-sky-700",
  business: "bg-slate-100 text-slate-700",
  other: "bg-slate-100 text-slate-600",
};

/** Statut Whop d'un retrait, ramené à trois états lisibles. */
function statusKind(s: string | null): "done" | "pending" | "failed" | null {
  if (s === null) return null;
  const x = s.toLowerCase();
  if (/(fail|cancel|denied|revers|return)/.test(x)) return "failed";
  if (/(complete|paid|succeed|settled|deposited)/.test(x)) return "done";
  return "pending";
}

/**
 * VIREMENTS WHOP → BANQUE d'un mois. Ils viennent du grand livre : on ne les
 * saisit pas, on dit à quoi ils ont servi (usage + motif). Annotation seule,
 * le résultat n'en dépend jamais.
 */
export function ComptaTransfersCard({
  months,
  defaultMonth,
}: {
  months: string[];
  defaultMonth: string;
}) {
  const t = useTranslations("admin.money.Compta.transfers");
  const tu = useTranslations("admin.money.Compta.usages");
  const f = useComptaFormat();
  const [month, setMonth] = useState(defaultMonth);
  const [edit, setEdit] = useState<Transfer | null>(null);
  const list = useProjectQuery(api.compta.listComptaTransfers, { month });
  const options = months.includes(month) ? months : [...months, month].sort();
  const sansMotif = (list ?? []).filter((x) => x.usage === null);
  const total = (list ?? []).reduce((s, x) => s + x.amount, 0);
  const cur = list?.[0]?.currency ?? null;
  const byUsage = new Map<string, number>();
  for (const x of list ?? []) byUsage.set(x.usage ?? "", (byUsage.get(x.usage ?? "") ?? 0) + x.amount);

  return (
    <Card className="gap-0 py-0" data-testid="compta-transfers">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="space-y-0.5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            {t("title")}
            {sansMotif.length > 0 && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-700">
                {t("noMotifBadge", { count: sansMotif.length })}
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-500">{t("subtitle")}</p>
        </div>
        <Select
          value={month}
          onValueChange={(v) => v !== null && setMonth(v)}
          items={Object.fromEntries(options.map((m) => [m, f.month(m)]))}
        >
          <SelectTrigger className="w-44" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            {options.map((m) => (
              <SelectItem key={m} value={m}>
                {f.month(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {list === undefined ? (
        <Skeleton className="m-5 h-24" />
      ) : list.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">{t("none")}</p>
      ) : (
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5 text-xs text-slate-500">{t("date")}</TableHead>
              <TableHead className="text-right text-xs text-slate-500">{t("amount")}</TableHead>
              <TableHead className="text-xs text-slate-500">{t("to")}</TableHead>
              <TableHead className="text-xs text-slate-500">{t("status")}</TableHead>
              <TableHead className="text-xs text-slate-500">{t("usage")}</TableHead>
              <TableHead className="text-xs text-slate-500">{t("note")}</TableHead>
              <TableHead className="w-12 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((x) => {
              const st = statusKind(x.status);
              return (
                <TableRow key={x._id} data-testid={`compta-transfer-${x.sourceId ?? x._id}`}>
                  <TableCell className="pl-5 tabular-nums text-slate-500">{f.day(x.day)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-slate-900">
                    {f.money(x.amount, x.currency)}
                  </TableCell>
                  <TableCell className="text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <LandmarkIcon className="size-3.5 text-slate-400" />
                      {x.destination ?? t("bank")}
                    </span>
                    {x.sourceId && (
                      <code className="ml-2 font-mono text-[10px] text-slate-400">{x.sourceId}</code>
                    )}
                  </TableCell>
                  <TableCell>
                    {st === "done" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2Icon className="size-3.5" />
                        {t("statusDone")}
                      </span>
                    ) : st === "failed" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-red-600">
                        <XCircleIcon className="size-3.5" />
                        {t("statusFailed")}
                      </span>
                    ) : st === "pending" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                        <ClockIcon className="size-3.5" />
                        {t("statusPending")}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {x.usage ? (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          USAGE_BADGE[x.usage as TransferUsage] ?? USAGE_BADGE.other,
                        )}
                      >
                        {tu(x.usage as TransferUsage)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal">
                    {x.note ? (
                      <span className="block text-slate-700">
                        {x.note}
                        {x.annotatedAt !== null && (
                          <span className="block text-[11px] text-slate-400">
                            {t("annotatedOn", { date: f.dayShort(parisDayKey(x.annotatedAt)) })}
                          </span>
                        )}
                      </span>
                    ) : x.usage ? (
                      <span className="text-xs text-slate-300">—</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEdit(x)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <MessageSquareTextIcon className="size-3.5" />
                        {t("annotate")}
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={() => setEdit(x)}>
                      <PencilIcon className="size-3.5 text-slate-400" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter className="bg-slate-50/80">
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-5 text-xs font-normal text-slate-500">
                {t("count", { count: list.length })}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums text-slate-900">
                {f.money(total, cur)}
              </TableCell>
              <TableCell colSpan={5} className="text-xs font-normal text-slate-500">
                {[...byUsage.entries()]
                  .filter(([u]) => u !== "")
                  .map(([u, v]) => `${tu(u as TransferUsage)} ${f.money(v, cur)}`)
                  .join(" · ")}
                {byUsage.has("") && (
                  <span className="text-amber-700">
                    {byUsage.size > 1 ? " · " : ""}
                    {t("withoutMotif", { amount: f.money(byUsage.get("") ?? 0, cur) })}
                  </span>
                )}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
      <AnnotateDialog transfer={edit} onClose={() => setEdit(null)} />
    </Card>
  );
}

function AnnotateDialog({ transfer, onClose }: { transfer: Transfer | null; onClose: () => void }) {
  return (
    <Dialog open={transfer !== null} onOpenChange={(o) => !o && onClose()}>
      {transfer && <AnnotateForm key={transfer._id} transfer={transfer} onClose={onClose} />}
    </Dialog>
  );
}

function AnnotateForm({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  const t = useTranslations("admin.money.Compta.transfers");
  const tu = useTranslations("admin.money.Compta.usages");
  const f = useComptaFormat();
  const annotate = useProjectMutation(api.compta.annotateTransfer);
  const [usage, setUsage] = useState<string>(transfer.usage ?? "");
  const [note, setNote] = useState(transfer.note ?? "");
  const [busy, setBusy] = useState(false);
  const NONE = "";

  async function save() {
    setBusy(true);
    try {
      await annotate({
        lineId: transfer._id,
        usage: usage === NONE ? null : usage,
        note: note.trim() === "" ? null : note,
      });
      toast.success(t("saved"));
      onClose();
    } catch (e) {
      toast.error(convexErrorMessage(e, t("failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-md" initialFocus={false}>
      <DialogHeader>
        <DialogTitle>{t("dialogTitle")}</DialogTitle>
        <DialogDescription>
          {t("dialogDescription", {
            amount: f.money(transfer.amount, transfer.currency),
            destination: transfer.destination ?? t("bank"),
            date: f.day(transfer.day),
          })}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <InfoIcon className="mt-px size-3.5 shrink-0 text-slate-400" />
          <span>{t("dialogRule")}</span>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-600">{t("usageLabel")}</Label>
          <Select
            value={usage}
            onValueChange={(v) => v !== null && setUsage(v)}
            items={{ [NONE]: t("usageNone"), ...Object.fromEntries(TRANSFER_USAGES.map((u) => [u, tu(u)])) }}
          >
            <SelectTrigger className="w-full" data-testid="compta-transfer-usage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              <SelectItem value={NONE}>{t("usageNone")}</SelectItem>
              {TRANSFER_USAGES.map((u) => (
                <SelectItem key={u} value={u}>
                  {tu(u)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-600" htmlFor="compta-transfer-note">
            {t("noteLabel")}
          </Label>
          <Textarea
            id="compta-transfer-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-[11px] text-slate-400">{t("noteHint")}</p>
        </div>
        <p className="text-xs text-slate-500">{t("noDoubleCount")}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button onClick={save} disabled={busy}>
          {t("save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
