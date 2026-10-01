"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangleIcon, ArrowRightIcon, InfoIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
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
import { COMPTA_BUCKETS, isComptaBucket, parisDayKey, type ComptaBucket } from "@/convex/comptaMath";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import { useComptaFormat } from "./compta-format";
import type { ComptaOverview } from "./ComptaPage";
import { exportedMonthsFor } from "./ComptaMethod";

/** Ce que la fenêtre range : les types en attente, ou un type déjà réglé. */
export type ClassifyTarget = { kind: "pending" } | { kind: "rule"; lineType: string };

type Item = {
  lineType: string;
  count: number;
  amount: number;
  months: string[];
  current: ComptaBucket | null;
  example: { postedAt: number; amount: number; currency: string; paymentId: string | null; label: string | null } | null;
};

export function ComptaClassifyDialog({
  data,
  target,
  onClose,
}: {
  data: ComptaOverview;
  target: ClassifyTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      {target && (
        <ClassifyForm
          key={target.kind === "rule" ? target.lineType : "pending"}
          data={data}
          target={target}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function ClassifyForm({
  data,
  target,
  onClose,
}: {
  data: ComptaOverview;
  target: ClassifyTarget;
  onClose: () => void;
}) {
  const t = useTranslations("admin.money.Compta.classify");
  const tb = useTranslations("admin.money.Compta.buckets");
  const f = useComptaFormat();
  const setRule = useProjectMutation(api.compta.setLineRule);
  const items: Item[] =
    target.kind === "pending"
      ? data.unclassified.map((u) => ({ ...u, current: null }))
      : data.rules
          .filter((r) => r.lineType === target.lineType)
          .map((r) => ({
            lineType: r.lineType,
            count: r.count,
            amount: r.amount,
            months: r.months,
            current: isComptaBucket(r.bucket) ? r.bucket : null,
            example: null,
          }));
  const [chosen, setChosen] = useState<Record<string, ComptaBucket | null>>(() =>
    Object.fromEntries(items.map((i) => [i.lineType, i.current])),
  );
  const [busy, setBusy] = useState(false);
  const changed = items.filter((i) => chosen[i.lineType] && chosen[i.lineType] !== i.current);
  const cur = data.currency;

  async function save() {
    setBusy(true);
    try {
      for (const i of changed) await setRule({ lineType: i.lineType, bucket: chosen[i.lineType]! });
      toast.success(t("saved", { count: changed.length }));
      onClose();
    } catch (e) {
      toast.error(convexErrorMessage(e, t("failed")));
    } finally {
      setBusy(false);
    }
  }

  const effect = (i: Item, b: ComptaBucket) => {
    const amount = f.signed(i.amount, cur);
    if (b === "transfers") return [t("effectTransfers", { amount })];
    if (b === "internal") return [t("effectInternal", { amount })];
    const lines = [t("effectNet", { amount, bucket: tb(b) })];
    if (b === "gross") lines.push(t("effectGross"));
    return lines;
  };

  return (
    <DialogContent className="sm:max-w-2xl" initialFocus={false}>
      <DialogHeader>
        <DialogTitle>
          {target.kind === "rule" ? t("titleOne", { lineType: target.lineType }) : t("title")}
        </DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {items.map((i) => {
          const b = chosen[i.lineType];
          const exported = exportedMonthsFor(data, i.lineType);
          return (
            <div
              key={i.lineType}
              className={cn(
                "space-y-2.5 rounded-lg border p-3",
                b ? "border-primary/40 bg-primary/[0.03]" : "border-slate-200",
              )}
              data-testid={`compta-classify-${i.lineType}`}
            >
              <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
                <div className="min-w-0 space-y-0.5">
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                    {i.lineType}
                  </code>
                  <div className="text-xs text-slate-500">
                    {t("lines", {
                      count: i.count,
                      months: i.months.map((m) => f.month(m)).join(", "),
                      amount: f.signed(i.amount, cur),
                    })}
                  </div>
                  {i.example && (
                    <div className="text-[11px] text-slate-400">
                      {t("example", {
                        date: f.day(parisDayKey(i.example.postedAt)),
                        amount: f.signed(i.example.amount, i.example.currency),
                      })}
                      {i.example.paymentId ? ` · ${i.example.paymentId}` : ""}
                      {i.example.label ? ` (${i.example.label})` : ""}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500">{t("into")}</Label>
                  <Select
                    value={b}
                    onValueChange={(v) => v !== null && isComptaBucket(v) && setChosen((c) => ({ ...c, [i.lineType]: v }))}
                    items={Object.fromEntries(COMPTA_BUCKETS.map((x) => [x, tb(x)]))}
                  >
                    <SelectTrigger className="w-full" data-testid={`compta-classify-select-${i.lineType}`}>
                      <SelectValue placeholder={t("choose")} />
                    </SelectTrigger>
                    <SelectContent align="start" alignItemWithTrigger={false}>
                      {COMPTA_BUCKETS.map((x) => (
                        <SelectItem key={x} value={x}>
                          {tb(x)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {b ? (
                <div className="space-y-1 border-t border-primary/15 pt-2">
                  {effect(i, b).map((line) => (
                    <p key={line} className="flex items-start gap-1.5 text-xs text-slate-600">
                      <ArrowRightIcon className="mt-0.5 size-3 shrink-0 text-primary" />
                      {line}
                    </p>
                  ))}
                  {exported.length > 0 && b !== i.current && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700">
                      <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
                      {t("exported", { months: exported.map((m) => f.month(m)).join(", ") })}
                    </p>
                  )}
                </div>
              ) : (
                <p className="border-t border-slate-100 pt-2 text-xs text-slate-400">{t("notYet")}</p>
              )}
            </div>
          );
        })}
        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <InfoIcon className="mt-px size-3.5 shrink-0 text-slate-400" />
          <span>{t("internalHint")}</span>
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button onClick={save} disabled={changed.length === 0 || busy} data-testid="compta-classify-save">
          {t("save", { count: changed.length })}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
