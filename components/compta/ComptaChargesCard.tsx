"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { CheckIcon, Link2Icon, PencilIcon, PlusIcon, RepeatIcon, Trash2Icon, XIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CHARGE_CATEGORIES, parisDayKey, type ChargeCategory } from "@/convex/comptaMath";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import { useComptaFormat } from "./compta-format";

type ChargesData = FunctionReturnType<typeof api.compta.listComptaCharges>;
type Charge = ChargesData["charges"][number];

const CATEGORY_BADGE: Record<ChargeCategory, string> = {
  hosting: "bg-sky-50 text-sky-700",
  tools: "bg-indigo-50 text-indigo-700",
  subscriptions: "bg-emerald-50 text-emerald-700",
  ads: "bg-pink-50 text-pink-700",
  scans: "bg-orange-50 text-orange-700",
  other: "bg-slate-100 text-slate-600",
};

type DialogState = { mode: "add" } | { mode: "edit"; charge: Charge };

/**
 * AUTRES CHARGES saisies à la main. Une charge « chaque mois » est PRÉVUE les
 * mois suivants (calculée, jamais écrite seule) : on la confirme, on la corrige,
 * ou on arrête la série.
 */
export function ComptaChargesCard({
  months,
  defaultMonth,
  currentMonth,
}: {
  months: string[];
  defaultMonth: string;
  currentMonth: string;
}) {
  const t = useTranslations("admin.money.Compta.charges");
  const tc = useTranslations("admin.money.Compta.categories");
  const f = useComptaFormat();
  const [month, setMonth] = useState(defaultMonth);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toDelete, setToDelete] = useState<Charge | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [today] = useState(() => parisDayKey(Date.now()));
  const data = useProjectQuery(api.compta.listComptaCharges, { month });
  const confirmPlanned = useProjectMutation(api.compta.confirmPlannedCharge);
  const stopSeries = useProjectMutation(api.compta.stopChargeSeries);
  const options = [...new Set([...months, month, currentMonth])].sort();
  const cur = data?.currency ?? null;

  async function run(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(convexErrorMessage(e, t("failed")));
    } finally {
      setBusy(null);
    }
  }

  // Le total est celui des AUTRES CHARGES : un paiement au fournisseur des
  // scans est listé ici (c'est une charge), mais il compte dans la colonne Scans.
  const byCat = new Map<string, number>();
  let total = 0;
  let missing = false;
  for (const c of data?.charges ?? []) {
    if (c.converted === null) {
      if (c.category !== "scans") missing = true;
    } else {
      if (c.category !== "scans") total += c.converted;
      byCat.set(c.category, (byCat.get(c.category) ?? 0) + c.converted);
    }
  }

  return (
    <Card className="gap-0 py-0" data-testid="compta-charges">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-slate-900">{t("title")}</h2>
          <p className="text-xs text-slate-500">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button size="sm" onClick={() => setDialog({ mode: "add" })} disabled={cur === null}>
            <PlusIcon className="size-3.5" />
            {t("add")}
          </Button>
        </div>
      </div>
      {data === undefined ? (
        <Skeleton className="m-5 h-24" />
      ) : cur === null ? (
        <p className="px-5 py-8 text-center text-sm text-amber-700">{t("noCurrency")}</p>
      ) : data.charges.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">{t("none")}</p>
      ) : (
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5 text-xs text-slate-500">{t("date")}</TableHead>
              <TableHead className="text-xs text-slate-500">{t("label")}</TableHead>
              <TableHead className="text-xs text-slate-500">{t("category")}</TableHead>
              <TableHead className="text-right text-xs text-slate-500">{t("billed")}</TableHead>
              <TableHead className="text-right text-xs text-slate-500">
                {t("converted", { currency: cur.toUpperCase() })}
              </TableHead>
              <TableHead className="text-xs text-slate-500">{t("recurrence")}</TableHead>
              <TableHead className="w-36 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.charges.map((c) => (
              <TableRow
                key={c.id}
                className={cn(c.planned && "bg-slate-50/60")}
                data-testid={`compta-charge-${c.label}`}
              >
                <TableCell className="pl-5 tabular-nums text-slate-500">{f.day(c.day)}</TableCell>
                <TableCell className="font-medium text-slate-900">
                  {c.label}
                  {c.transferLineId !== null && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-px text-[10px] font-medium text-slate-500">
                      <Link2Icon className="size-2.5" />
                      {t("linked", { date: f.dayShort(c.day) })}
                    </span>
                  )}
                  {c.planned && (
                    <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700">
                      {t("planned")}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      CATEGORY_BADGE[c.category as ChargeCategory] ?? CATEGORY_BADGE.other,
                    )}
                  >
                    {tc(c.category as ChargeCategory)}
                  </span>
                  {c.category === "scans" && (
                    <span className="ml-1.5 text-[11px] text-slate-400">{t("scanHint")}</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-slate-500">{f.money(c.amount, c.currency)}</TableCell>
                <TableCell className="text-right tabular-nums text-slate-900">
                  {c.converted === null ? (
                    <span className="text-amber-700">{t("noRate")}</span>
                  ) : (
                    f.money(c.converted, cur)
                  )}
                </TableCell>
                <TableCell>
                  {c.recurring ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                      <RepeatIcon className="size-3.5 text-slate-400" />
                      {t("monthly")}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">{t("oneOff")}</span>
                  )}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  {c.transferLineId !== null ? (
                    <span className="text-xs text-slate-400">{t("linkedEdit")}</span>
                  ) : c.planned ? (
                    <span className="inline-flex gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy === c.id}
                        onClick={() =>
                          run(c.id, () => confirmPlanned({ sourceId: c.sourceId, day: c.day }), t("confirmed"))
                        }
                      >
                        <CheckIcon className="size-3" />
                        {t("confirm")}
                      </Button>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={t("stop")}
                              disabled={busy === c.id}
                              onClick={() =>
                                run(c.id, () => stopSeries({ chargeId: c.sourceId }), t("stopped"))
                              }
                            >
                              <XIcon className="size-3.5 text-slate-400" />
                            </Button>
                          }
                        />
                        <TooltipContent>{t("stop")}</TooltipContent>
                      </Tooltip>
                    </span>
                  ) : (
                    <span className="inline-flex gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("edit")}
                        onClick={() => setDialog({ mode: "edit", charge: c })}
                      >
                        <PencilIcon className="size-3.5 text-slate-400" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={t("delete")} onClick={() => setToDelete(c)}>
                        <Trash2Icon className="size-3.5 text-slate-400" />
                      </Button>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="bg-slate-50/80">
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="pl-5 text-xs font-normal text-slate-500">
                {[...byCat.entries()]
                  .map(([cat, v]) =>
                    cat === "scans"
                      ? `${tc("scans")} ${f.money(Math.round(v * 100) / 100, cur)} (${t("scanHint")})`
                      : `${tc(cat as ChargeCategory)} ${f.money(Math.round(v * 100) / 100, cur)}`,
                  )
                  .join(" · ")}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums text-slate-900" data-testid="compta-charges-total">
                {missing ? "—" : f.money(Math.round(total * 100) / 100, cur)}
              </TableCell>
              <TableCell colSpan={2} className="pr-4 text-xs font-normal text-slate-400">
                {t("total", { month: f.month(month) })}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
      <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">{t("footer")}</p>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog && data && (
          <ChargeForm
            key={dialog.mode === "edit" ? dialog.charge.id : "add"}
            state={dialog}
            data={data}
            defaultDay={month === today.slice(0, 7) ? today : `${month}-01`}
            onClose={() => setDialog(null)}
          />
        )}
      </Dialog>

      <DeleteDialog charge={toDelete} onClose={() => setToDelete(null)} />
    </Card>
  );
}

function ChargeForm({
  state,
  data,
  defaultDay,
  onClose,
}: {
  state: DialogState;
  data: ChargesData;
  defaultDay: string;
  onClose: () => void;
}) {
  const t = useTranslations("admin.money.Compta.charges");
  const tc = useTranslations("admin.money.Compta.categories");
  const f = useComptaFormat();
  const add = useProjectMutation(api.compta.addComptaCharge);
  const update = useProjectMutation(api.compta.updateComptaCharge);
  const edit = state.mode === "edit" ? state.charge : null;
  const [day, setDay] = useState(edit?.day ?? defaultDay);
  const [category, setCategory] = useState<string>(edit?.category ?? "hosting");
  const [label, setLabel] = useState(edit?.label ?? "");
  const [amount, setAmount] = useState(edit ? String(edit.amount).replace(".", ",") : "");
  const [currency, setCurrency] = useState(edit?.currency ?? data.currency ?? "");
  const [recurring, setRecurring] = useState(edit?.recurring ?? false);
  const [busy, setBusy] = useState(false);
  const value = Number(amount.replace(/\s/g, "").replace(",", "."));
  const rate = data.rates[currency] ?? null;
  const valid = /^\d\d\d\d-\d\d-\d\d$/.test(day) && label.trim() !== "" && value > 0 && rate !== null;

  async function save() {
    if (!valid) return;
    setBusy(true);
    try {
      const args = { day, label, category, amount: value, currency, recurring };
      if (edit?.chargeId) await update({ chargeId: edit.chargeId, ...args });
      else await add(args);
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
        <DialogTitle>{edit ? t("dialogEdit") : t("dialogAdd")}</DialogTitle>
        <DialogDescription>{t("dialogDescription")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600" htmlFor="compta-charge-day">
              {t("dateLabel")}
            </Label>
            <Input id="compta-charge-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">{t("categoryLabel")}</Label>
            <Select
              value={category}
              onValueChange={(v) => v !== null && setCategory(v)}
              items={Object.fromEntries(CHARGE_CATEGORIES.map((c) => [c, tc(c)]))}
            >
              <SelectTrigger className="w-full" data-testid="compta-charge-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                {CHARGE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {tc(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-slate-600" htmlFor="compta-charge-label">
            {t("labelLabel")}
          </Label>
          <Input
            id="compta-charge-label"
            value={label}
            maxLength={120}
            placeholder={t("labelPlaceholder")}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600" htmlFor="compta-charge-amount">
              {t("amountLabel")}
            </Label>
            <Input
              id="compta-charge-amount"
              inputMode="decimal"
              className="tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">{t("currencyLabel")}</Label>
            <Select
              value={currency}
              onValueChange={(v) => v !== null && setCurrency(v)}
              items={Object.fromEntries(data.currencies.map((c) => [c, c.toUpperCase()]))}
            >
              <SelectTrigger className="w-full" data-testid="compta-charge-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                {data.currencies.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {rate !== null && rate !== 1 && value > 0 && (
          <p className="-mt-1 text-xs text-slate-500 tabular-nums">
            {t("conversion", { amount: f.money(Math.round(value * rate * 100) / 100, data.currency), rate: f.rate(rate) })}
          </p>
        )}
        <label className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium text-slate-900">{t("monthlyLabel")}</span>
            <span className="block text-xs text-slate-500">{t("monthlyHint")}</span>
          </span>
          <Switch checked={recurring} onCheckedChange={setRecurring} />
        </label>
        <p className="text-xs text-slate-400">{t("scanWarning")}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button onClick={save} disabled={!valid || busy} data-testid="compta-charge-save">
          {edit ? t("save") : t("addAction")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function DeleteDialog({ charge, onClose }: { charge: Charge | null; onClose: () => void }) {
  const t = useTranslations("admin.money.Compta.charges");
  const remove = useProjectMutation(api.compta.deleteComptaCharge);
  const [busy, setBusy] = useState(false);
  async function confirm() {
    if (!charge?.chargeId) return;
    setBusy(true);
    try {
      await remove({ chargeId: charge.chargeId });
      toast.success(t("deleted"));
      onClose();
    } catch (e) {
      toast.error(convexErrorMessage(e, t("failed")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog open={charge !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteTitle", { label: charge?.label ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteBody")}
            {charge?.seriesTail ? ` ${t("deleteSeries")}` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            {t("deleteConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
