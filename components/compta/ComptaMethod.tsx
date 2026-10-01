"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRightIcon, ChevronRightIcon, TagIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { builtinLineTypes, isComptaBucket, parisDayKey, type ComptaBucket } from "@/convex/comptaMath";
import { convexErrorMessage } from "@/lib/convex-error";
import { cn } from "@/lib/utils";
import { useComptaFormat } from "./compta-format";
import type { ComptaOverview } from "./ComptaPage";
import type { ClassifyTarget } from "./ComptaClassifyDialog";

const ORDER: ComptaBucket[] = ["gross", "refunds", "disputes", "fees", "transfers", "internal"];

/**
 * « Comment chaque colonne est calculée » : la table intégrée (types Whop dont
 * le sens est certain), les règles choisies depuis la page, et la formule.
 */
export function ComptaMethod({
  data,
  onClassify,
}: {
  data: ComptaOverview;
  onClassify: (t: ClassifyTarget) => void;
}) {
  const t = useTranslations("admin.money.Compta.method");
  const tb = useTranslations("admin.money.Compta.buckets");
  const f = useComptaFormat();
  const [open, setOpen] = useState(false);
  const [toRemove, setToRemove] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-lg px-1 py-2 text-left text-sm text-slate-500 hover:text-slate-800"
        data-testid="compta-method-toggle"
      >
        <ChevronRightIcon className={cn("size-4 transition-transform", open && "rotate-90")} />
        {t("toggle")}
      </button>
      {open && (
        <Card className="py-0">
          <CardContent className="space-y-3 p-5 text-xs">
            <p className="text-slate-500">{t("source")}</p>
            <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
              {ORDER.map((b) => (
                <div key={b} className="space-y-1">
                  <div className="font-medium text-slate-800">{tb(b)}</div>
                  <div className="text-slate-500">{t(b)}</div>
                  <div className="flex flex-wrap gap-1">
                    {(b === "fees" ? [t("anyFee")] : builtinLineTypes(b)).map((c) => (
                      <code key={c} className="rounded bg-slate-100 px-1 py-px font-mono text-[10px] text-slate-600">
                        {c}
                      </code>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2 rounded-lg border border-slate-200 p-3" data-testid="compta-rules">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-1.5 font-medium text-slate-800">
                  <TagIcon className="size-3.5 text-slate-400" />
                  {t("userRules")}
                  <span className="font-normal text-slate-400">— {t("userRulesHint")}</span>
                </div>
                {data.unclassified.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => onClassify({ kind: "pending" })}>
                    {t("pendingAction", { count: data.unclassified.length })}
                  </Button>
                )}
              </div>
              {data.rules.length === 0 ? (
                <p className="text-slate-400">{t("noRules")}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.rules.map((r) => (
                    <li key={r.lineType} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span className="flex items-center gap-2">
                        <code className="rounded bg-slate-100 px-1 py-px font-mono text-[10px] text-slate-600">
                          {r.lineType}
                        </code>
                        <ArrowRightIcon className="size-3 text-slate-400" />
                        <span className="font-medium text-slate-700">
                          {isComptaBucket(r.bucket) ? tb(r.bucket) : r.bucket}
                        </span>
                        <span className="text-slate-400">
                          · {t("chosenOn", { date: f.day(parisDayKey(r.at)) })}
                        </span>
                      </span>
                      <span className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => onClassify({ kind: "rule", lineType: r.lineType })}
                        >
                          {t("change")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-slate-500"
                          onClick={() => setToRemove(r.lineType)}
                        >
                          {t("remove")}
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-slate-400">{t("rulesFoot")}</p>
            </div>

            <p className="border-t border-slate-100 pt-3 text-slate-500">{t("formula")}</p>
            {data.conversions.length > 0 && data.currency && (
              <p className="text-slate-500">
                {t("rates", {
                  list: data.conversions
                    .map((c) => `1 ${c.from.toUpperCase()} = ${f.rate(c.rate)} ${data.currency!.toUpperCase()}`)
                    .join(" · "),
                })}
              </p>
            )}
            <p className="text-slate-400">{t("differs")}</p>
          </CardContent>
        </Card>
      )}
      <RemoveRuleDialog data={data} lineType={toRemove} onClose={() => setToRemove(null)} />
    </div>
  );
}

function RemoveRuleDialog({
  data,
  lineType,
  onClose,
}: {
  data: ComptaOverview;
  lineType: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("admin.money.Compta.method");
  const f = useComptaFormat();
  const remove = useProjectMutation(api.compta.removeLineRule);
  const [busy, setBusy] = useState(false);
  const affected = lineType ? exportedMonthsFor(data, lineType) : [];
  async function confirm() {
    if (!lineType) return;
    setBusy(true);
    try {
      await remove({ lineType });
      toast.success(t("removed"));
      onClose();
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog open={lineType !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("removeTitle", { lineType: lineType ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("removeBody")}
            {affected.length > 0
              ? ` ${t("removeExported", { months: affected.map((m) => f.month(m)).join(", ") })}`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("removeCancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            {t("removeConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Mois DÉJÀ EXPORTÉS où un type de ligne a des lignes : une règle posée ou
 * retirée changerait ce qui a été envoyé au comptable.
 */
export function exportedMonthsFor(data: ComptaOverview, lineType: string): string[] {
  const exported = new Set(data.exports.map((e) => e.month));
  const months =
    data.unclassified.find((u) => u.lineType === lineType)?.months ??
    data.rules.find((r) => r.lineType === lineType)?.months ??
    [];
  return months.filter((m) => exported.has(m));
}
