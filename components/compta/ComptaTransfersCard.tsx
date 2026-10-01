"use client";

import { Fragment, useState } from "react";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  CornerDownRightIcon,
  InfoIcon,
  LandmarkIcon,
  Link2Icon,
  MessageSquareTextIcon,
  PlusIcon,
  SplitIcon,
  Trash2Icon,
  Undo2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import {
  CHARGE_CATEGORIES,
  TRANSFER_USAGES,
  parisDayKey,
  type ChargeCategory,
  type TransferUsage,
} from "@/convex/comptaMath";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import { useComptaFormat, type ComptaFormat } from "./compta-format";

type TransfersData = FunctionReturnType<typeof api.compta.listComptaTransfers>;
type Transfer = TransfersData["transfers"][number];

const USAGE_BADGE: Record<TransferUsage, string> = {
  pay: "bg-violet-50 text-violet-700",
  creators: "bg-amber-50 text-amber-700",
  provision: "bg-sky-50 text-sky-700",
  business: "bg-slate-100 text-slate-700",
  other: "bg-slate-100 text-slate-600",
};
const USAGE_BAR: Record<TransferUsage, string> = {
  pay: "bg-violet-400",
  creators: "bg-amber-400",
  provision: "bg-sky-400",
  business: "bg-primary",
  other: "bg-slate-400",
};

/** Statut Whop d'un retrait réussi ou en cours (un échec est signalé par `failed`). */
function pendingStatus(s: string | null): boolean {
  return s !== null && !/(complete|paid|succeed|settled|deposited)/i.test(s);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * VIREMENTS WHOP → BANQUE d'un mois. Ils viennent du grand livre : on ne les
 * saisit pas, on dit à quoi ils ont servi — en une fois, ou VENTILÉS en
 * plusieurs parts. Seule une part « comptée en charge » entre au résultat. Un
 * retrait échoué (revenu sur Whop) est montré, jamais compté.
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
  const tc = useTranslations("admin.money.Compta.categories");
  const f = useComptaFormat();
  const [month, setMonth] = useState(defaultMonth);
  const [edit, setEdit] = useState<Transfer | null>(null);
  const data = useProjectQuery(api.compta.listComptaTransfers, { month });
  const options = months.includes(month) ? months : [...months, month].sort();
  const list = data?.transfers ?? [];
  const cur = data?.currency ?? null;

  const ok = list.filter((x) => !x.failed);
  const failed = list.filter((x) => x.failed);
  const sansMotif = ok.filter((x) => x.parts.length === 0);
  const total = ok.every((x) => x.converted !== null)
    ? round2(ok.reduce((s, x) => s + (x.converted ?? 0), 0))
    : null;
  const byUsage = new Map<TransferUsage, number>();
  let counted = 0;
  let unexplained = 0;
  for (const x of ok) {
    let explained = 0;
    for (const p of x.parts) {
      byUsage.set(p.usage, (byUsage.get(p.usage) ?? 0) + (p.converted ?? 0));
      if (p.countedAs) counted += p.converted ?? 0;
      explained += p.converted ?? 0;
    }
    unexplained += Math.max(0, (x.converted ?? 0) - explained);
  }
  const foreign = ok.filter((x) => x.currency !== cur);

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
      {data === undefined ? (
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
            {list.map((x) => (
              <TransferRows key={x._id} x={x} cur={cur} f={f} onEdit={() => setEdit(x)} />
            ))}
          </TableBody>
          <TableFooter className="bg-slate-50/80">
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-5 text-xs font-normal text-slate-500">
                {t("received", { count: ok.length })}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums text-slate-900" data-testid="compta-transfers-total">
                {total === null ? "—" : f.money(total, cur)}
              </TableCell>
              <TableCell colSpan={5} className="whitespace-normal text-xs font-normal text-slate-500">
                {[...byUsage.entries()]
                  .map(([u, v]) =>
                    u === "business" && counted > 0
                      ? `${tu(u)} ${f.money(round2(v), cur)} (${t("countedOf", { amount: f.money(round2(counted), cur) })})`
                      : `${tu(u)} ${f.money(round2(v), cur)}`,
                  )
                  .join(" · ")}
                {unexplained > 0.005 && (
                  <span className="text-amber-700">
                    {byUsage.size > 0 ? " · " : ""}
                    {t("withoutMotif", { amount: f.money(round2(unexplained), cur) })}
                  </span>
                )}
                {(failed.length > 0 || foreign.length > 0) && (
                  <span className="block text-slate-400">
                    {[
                      failed.length > 0
                        ? t("failedNote", {
                            count: failed.length,
                            list: failed.map((x) => f.money(x.amount, x.currency)).join(" · "),
                          })
                        : null,
                      foreign.length > 0
                        ? t("convertedNote", {
                            list: foreign.map((x) => f.money(x.amount, x.currency)).join(" · "),
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        {edit && (
          <VentilationForm
            key={edit._id}
            transfer={edit}
            month={month}
            categoryLabel={(c) => tc(c)}
            onClose={() => setEdit(null)}
          />
        )}
      </Dialog>
    </Card>
  );
}

function TransferRows({
  x,
  cur,
  f,
  onEdit,
}: {
  x: Transfer;
  cur: string | null;
  f: ComptaFormat;
  onEdit: () => void;
}) {
  const t = useTranslations("admin.money.Compta.transfers");
  const tu = useTranslations("admin.money.Compta.usages");
  const tc = useTranslations("admin.money.Compta.categories");
  const whole = x.parts.length === 1 && Math.abs(x.parts[0].amount - x.amount) < 0.005;
  const split = x.parts.length > 0 && !whole;
  const remaining = round2(x.amount - x.parts.reduce((s, p) => s + p.amount, 0));
  const single = whole ? x.parts[0] : null;
  return (
    <Fragment>
      <TableRow
        className={cn(x.failed && "bg-slate-50/60", split && "border-b-0")}
        data-testid={`compta-transfer-${x.sourceId ?? x._id}`}
      >
        <TableCell className={cn("pl-5 tabular-nums", x.failed ? "text-slate-300" : "text-slate-500")}>
          {f.day(x.day)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          <span className={cn("font-medium", x.failed ? "text-slate-300 line-through" : "text-slate-900")}>
            {f.money(x.amount, x.currency)}
          </span>
          {!x.failed && x.currency !== cur && x.converted !== null && (
            <span className="block text-[11px] font-normal text-slate-400">≈ {f.money(x.converted, cur)}</span>
          )}
        </TableCell>
        <TableCell className={cn(x.failed ? "text-slate-300" : "text-slate-500")}>
          <span className="inline-flex items-center gap-1.5">
            <LandmarkIcon className="size-3.5 text-slate-300" />
            {x.destination ?? t("bank")}
          </span>
          {x.sourceId && <code className="ml-2 font-mono text-[10px] text-slate-300">{x.sourceId}</code>}
        </TableCell>
        <TableCell>
          {x.failed ? (
            <span className="inline-flex items-center gap-1 text-xs text-red-600">
              <XCircleIcon className="size-3.5" />
              {t("statusFailed")}
            </span>
          ) : pendingStatus(x.status) ? (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
              <ClockIcon className="size-3.5" />
              {t("statusPending")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
              <CheckCircle2Icon className="size-3.5" />
              {t("statusDone")}
            </span>
          )}
        </TableCell>
        <TableCell>
          {x.failed || x.parts.length === 0 ? (
            <span className="text-xs text-slate-300">—</span>
          ) : split ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <SplitIcon className="size-3" />
              {t("ventilated", { count: x.parts.length })}
            </span>
          ) : (
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", USAGE_BADGE[single!.usage])}>
              {tu(single!.usage)}
            </span>
          )}
        </TableCell>
        <TableCell className="max-w-80 whitespace-normal">
          {x.failed ? (
            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
              <Undo2Icon className="size-3.5" />
              {x.returnedDay ? t("returned", { date: f.dayShort(x.returnedDay) }) : t("returnedNoDate")}
            </span>
          ) : split ? (
            <span className="text-xs text-slate-400">{t("detailBelow")}</span>
          ) : single ? (
            <span className="block text-slate-700">
              {single.note ?? <span className="text-slate-300">—</span>}
              {single.countedAs && (
                <CountedBadge label={t("countedBadge", { category: tc(single.countedAs as ChargeCategory) })} />
              )}
              {x.annotatedAt !== null && (
                <span className="block text-[11px] text-slate-400">
                  {t("annotatedOn", { date: f.dayShort(parisDayKey(x.annotatedAt)) })}
                </span>
              )}
            </span>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <MessageSquareTextIcon className="size-3.5" />
              {t("annotate")}
            </button>
          )}
        </TableCell>
        <TableCell className="pr-4 text-right">
          {!x.failed && (
            <Button variant="ghost" size="icon-sm" aria-label={t("ventilate")} onClick={onEdit}>
              <SplitIcon className="size-3.5 text-slate-400" />
            </Button>
          )}
        </TableCell>
      </TableRow>
      {split &&
        [...x.parts.map((p) => ({ kind: "part" as const, p })), ...(remaining > 0.005 ? [{ kind: "rest" as const }] : [])].map(
          (row, i, all) => (
            <TableRow
              key={row.kind === "part" ? row.p.id : "rest"}
              className={cn("bg-slate-50/50 hover:bg-slate-50/50", i < all.length - 1 && "border-b-0")}
              data-testid={row.kind === "part" ? `compta-transfer-part-${row.p.id}` : undefined}
            >
              <TableCell className="py-1.5 pl-5 text-right">
                <CornerDownRightIcon className="ml-auto size-3.5 text-slate-300" />
              </TableCell>
              <TableCell className={cn("py-1.5 text-right tabular-nums", row.kind === "rest" ? "text-amber-700" : "text-slate-700")}>
                {f.money(row.kind === "part" ? row.p.amount : remaining, x.currency)}
              </TableCell>
              <TableCell colSpan={2} className="py-1.5" />
              <TableCell className="py-1.5">
                {row.kind === "part" ? (
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", USAGE_BADGE[row.p.usage])}>
                    {tu(row.p.usage)}
                  </span>
                ) : (
                  <span className="text-xs text-slate-300">—</span>
                )}
              </TableCell>
              <TableCell className="py-1.5 whitespace-normal">
                {row.kind === "part" ? (
                  <>
                    <span className="text-slate-700">{row.p.note ?? <span className="text-slate-300">—</span>}</span>
                    {row.p.countedAs && (
                      <CountedBadge label={t("countedBadge", { category: tc(row.p.countedAs as ChargeCategory) })} />
                    )}
                  </>
                ) : (
                  <span className="text-xs text-amber-700">{t("remaining", { amount: f.money(remaining, x.currency) })}</span>
                )}
              </TableCell>
              <TableCell className="pr-4" />
            </TableRow>
          ),
        )}
    </Fragment>
  );
}

function CountedBadge({ label }: { label: string }) {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-medium text-emerald-700">
      <Link2Icon className="size-2.5" />
      {label}
    </span>
  );
}

// ─── Fenêtre « Ventiler le virement » ───────────────────────────────────────

type Draft = {
  id: string;
  amount: string;
  usage: TransferUsage | "";
  note: string;
  counted: boolean;
  category: ChargeCategory;
};

const newId = () => `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const parseAmount = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

function VentilationForm({
  transfer,
  month,
  categoryLabel,
  onClose,
}: {
  transfer: Transfer;
  month: string;
  categoryLabel: (c: ChargeCategory) => string;
  onClose: () => void;
}) {
  const t = useTranslations("admin.money.Compta.transfers");
  const tu = useTranslations("admin.money.Compta.usages");
  const f = useComptaFormat();
  const ventilate = useProjectMutation(api.compta.ventilateTransfer);
  const chargesData = useProjectQuery(api.compta.listComptaCharges, { month });
  const [busy, setBusy] = useState(false);
  const [parts, setParts] = useState<Draft[]>(() =>
    transfer.parts.length > 0
      ? transfer.parts.map((p) => ({
          id: p.id === "legacy" ? newId() : p.id,
          amount: p.amount.toFixed(2).replace(".", ","),
          usage: p.usage,
          note: p.note ?? "",
          counted: p.countedAs !== null,
          category: (p.countedAs as ChargeCategory | null) ?? "ads",
        }))
      : [{ id: newId(), amount: transfer.amount.toFixed(2).replace(".", ","), usage: "", note: "", counted: false, category: "ads" }],
  );
  const cur = chargesData?.currency ?? null;
  const rate = chargesData?.rates[transfer.currency] ?? null;
  const total = transfer.amount;
  const amounts = parts.map((p) => parseAmount(p.amount));
  const done = round2(amounts.reduce((s, a) => s + (Number.isFinite(a) ? a : 0), 0));
  const left = round2(total - done);
  const monthLabel = f.month(month);
  const countedParts = parts
    .map((p, i) => ({ p, amount: amounts[i] }))
    .filter(({ p }) => p.usage === "business" && p.counted);
  const conv = (a: number) => (rate === null ? null : round2(a * rate));
  const invalid =
    parts.some((p, i) => !(amounts[i] > 0) || p.usage === "") ||
    countedParts.some(({ p }) => p.note.trim() === "") ||
    left < -0.005;

  const others = (chargesData?.charges ?? []).filter((c) => c.transferLineId !== transfer._id);
  const similar = (p: Draft, amount: number) =>
    others.find(
      (c) =>
        (c.category === p.category && c.currency === transfer.currency && Math.abs(c.amount - amount) < 0.01) ||
        (p.note.trim() !== "" && c.label.trim().toLowerCase() === p.note.trim().toLowerCase()),
    );

  const update = (i: number, patch: Partial<Draft>) =>
    setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function save(clear = false) {
    setBusy(true);
    try {
      await ventilate({
        lineId: transfer._id,
        parts: clear
          ? []
          : parts.map((p, i) => ({
              id: p.id,
              amount: amounts[i],
              usage: p.usage,
              ...(p.note.trim() ? { note: p.note.trim() } : {}),
              ...(p.usage === "business" && p.counted ? { countedAs: p.category } : {}),
            })),
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
    <DialogContent className="sm:max-w-3xl" initialFocus={false}>
      <DialogHeader>
        <DialogTitle>{t("dialogTitle")}</DialogTitle>
        <DialogDescription>
          {t("dialogDescription", {
            amount: f.money(total, transfer.currency),
            destination: transfer.destination ?? t("bank"),
            date: f.day(transfer.day),
          })}
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <InfoIcon className="mt-px size-3.5 shrink-0 text-slate-400" />
        <span>{t("dialogIntro")}</span>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-[8rem_17rem_minmax(0,1fr)_2rem] gap-2 px-1 text-[11px] font-medium text-slate-500">
          <span>{t("amount")}</span>
          <span>{t("usage")}</span>
          <span>{t("note")}</span>
          <span />
        </div>
        {parts.map((p, i) => {
          const isBusiness = p.usage === "business";
          const sim = isBusiness && p.counted && amounts[i] > 0 ? similar(p, amounts[i]) : undefined;
          return (
            <div
              key={p.id}
              className={cn("rounded-lg border p-2", isBusiness && p.counted ? "border-primary/40 bg-primary/[0.03]" : "border-slate-200")}
              data-testid={`compta-part-${i}`}
            >
              <div className="grid grid-cols-[8rem_17rem_minmax(0,1fr)_2rem] items-center gap-2">
                <div className="relative">
                  <Input
                    value={p.amount}
                    inputMode="decimal"
                    aria-label={t("amount")}
                    onChange={(e) => update(i, { amount: e.target.value })}
                    className="pr-8 text-right tabular-nums"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-slate-400 uppercase">
                    {transfer.currency}
                  </span>
                </div>
                <Select
                  value={p.usage === "" ? null : p.usage}
                  onValueChange={(v) => v !== null && update(i, { usage: v as TransferUsage })}
                  items={Object.fromEntries(TRANSFER_USAGES.map((u) => [u, tu(u)]))}
                >
                  <SelectTrigger className="w-full" aria-label={t("usage")}>
                    <SelectValue placeholder={t("usage")} />
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    {TRANSFER_USAGES.map((u) => (
                      <SelectItem key={u} value={u}>
                        {tu(u)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={p.note}
                  maxLength={500}
                  aria-label={t("note")}
                  onChange={(e) => update(i, { note: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("removePart")}
                  disabled={parts.length === 1}
                  onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}
                >
                  <XIcon className="size-3.5 text-slate-400" />
                </Button>
              </div>
              {isBusiness && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-primary/15 pt-2 pl-1 text-xs">
                  <label className="inline-flex items-center gap-2 font-medium text-slate-800">
                    <Switch
                      checked={p.counted}
                      onCheckedChange={(v) => update(i, { counted: v })}
                      aria-label={t("countIt")}
                    />
                    {t("countIt")}
                  </label>
                  {p.counted && (
                    <>
                      <Select
                        value={p.category}
                        onValueChange={(v) => v !== null && update(i, { category: v as ChargeCategory })}
                        items={Object.fromEntries(CHARGE_CATEGORIES.map((c) => [c, categoryLabel(c)]))}
                      >
                        <SelectTrigger className="w-40" size="sm" aria-label={t("countIt")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start" alignItemWithTrigger={false}>
                          {CHARGE_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {categoryLabel(c)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {amounts[i] > 0 && (
                        <span className="tabular-nums text-slate-600">
                          {p.category === "scans"
                            ? t("effectScansHint", { month: monthLabel })
                            : t("effectLine", {
                                amount: f.money(conv(amounts[i]) ?? amounts[i], conv(amounts[i]) === null ? transfer.currency : cur),
                                month: monthLabel,
                              })}
                        </span>
                      )}
                      {p.note.trim() === "" ? (
                        <span className="w-full text-amber-700">{t("noteRequired")}</span>
                      ) : sim ? (
                        <span className="inline-flex w-full items-start gap-1 text-amber-700">
                          <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
                          {t("similarFound", { label: sim.label, amount: f.money(sim.amount, sim.currency), month: monthLabel })}
                        </span>
                      ) : (
                        <span className="inline-flex w-full items-center gap-1 text-emerald-700">
                          <CheckCircle2Icon className="size-3.5" />
                          {t("similarNone", { month: monthLabel })}
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          disabled={parts.length >= 20}
          onClick={() =>
            setParts((ps) => [
              ...ps,
              {
                id: newId(),
                amount: left > 0 ? left.toFixed(2).replace(".", ",") : "",
                usage: "",
                note: "",
                counted: false,
                category: "ads",
              },
            ])
          }
        >
          <PlusIcon className="size-3.5" />
          {t("addPart")}
        </Button>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium text-slate-700 tabular-nums">
            {t("progress", { done: f.money(done, transfer.currency), total: f.money(total, transfer.currency) })}
          </span>
          {left < -0.005 ? (
            <span className="text-red-600 tabular-nums">{t("over", { amount: f.money(-left, transfer.currency) })}</span>
          ) : left > 0.005 ? (
            <span className="text-amber-700 tabular-nums">{t("remaining", { amount: f.money(left, transfer.currency) })}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <CheckCircle2Icon className="size-3.5" />
              {t("allDone")}
            </span>
          )}
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
          {parts.map((p, i) =>
            amounts[i] > 0 ? (
              <div
                key={p.id}
                className={cn("h-full", p.usage === "" ? "bg-slate-300" : USAGE_BAR[p.usage], i > 0 && "border-l-2 border-white")}
                style={{ width: `${Math.min(100, (amounts[i] / total) * 100)}%` }}
              />
            ) : null,
          )}
        </div>
        <p className="text-[11px] text-slate-400">{t("neverCounted")}</p>
      </div>

      <div className="rounded-lg border border-slate-200 px-3 py-2 text-xs" data-testid="compta-ventilation-effect">
        <div className="font-medium text-slate-800">{t("effectTitle", { month: monthLabel })}</div>
        <ul className="mt-1 space-y-0.5 text-slate-600 tabular-nums">
          {countedParts.length === 0 ? (
            <li>{t("effectNone")}</li>
          ) : (
            <>
              {countedParts.map(({ p, amount }) => (
                <li key={p.id}>
                  {p.category === "scans"
                    ? t("effectScans", { amount: f.money(conv(amount) ?? amount, conv(amount) === null ? transfer.currency : cur), label: p.note.trim() })
                    : t("effectOther", {
                        amount: f.money(conv(amount) ?? amount, conv(amount) === null ? transfer.currency : cur),
                        label: p.note.trim(),
                        category: categoryLabel(p.category),
                      })}
                </li>
              ))}
              {countedParts.some(({ p }) => p.category !== "scans") && (
                <li>
                  {t("effectResult", {
                    amount: f.signed(
                      -round2(
                        countedParts
                          .filter(({ p }) => p.category !== "scans")
                          .reduce((s, { amount }) => s + (conv(amount) ?? 0), 0),
                      ),
                      cur,
                    ),
                  })}
                </li>
              )}
            </>
          )}
          <li className="text-slate-400">{t("effectUnchanged")}</li>
        </ul>
      </div>

      <DialogFooter>
        {transfer.parts.length > 0 && (
          <Button variant="outline" className="mr-auto text-slate-500" disabled={busy} onClick={() => save(true)}>
            <Trash2Icon className="size-3.5" />
            {t("clear")}
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button onClick={() => save()} disabled={invalid || busy} data-testid="compta-ventilation-save">
          {t("save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
