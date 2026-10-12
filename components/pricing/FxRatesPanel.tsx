"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftRightIcon, Loader2Icon } from "lucide-react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { usePermissions } from "@/components/project/use-permissions";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useConvexError } from "@/lib/use-convex-error";
import { isCurrencyCode } from "@/lib/currency";

type FxData = NonNullable<FunctionReturnType<typeof api.fxRates.getFxRates>>;
type FxRow = FxData["rows"][number];

/**
 * TAUX DE CHANGE DU PROJET — ouvert depuis l'écran des barèmes.
 *
 * Même arrangement que `ComboCooldownSettingsButton` : le dépôt n'a pas de
 * route « réglages du projet ». Le panneau vit là où le besoin se fait sentir —
 * un barème dans une autre devise est refusé tant que son taux n'est pas réglé.
 *
 * Toute la règle est côté serveur (convex/fxRatesMath) : l'écran montre ce
 * qu'elle accepterait, le serveur refuse ce qu'elle refuse.
 */
export function FxRatesButton() {
  const tr = useTranslations("admin.money.FxRates");
  const droits = usePermissions();
  if (!droits.has("project.settings")) return null;
  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="outline" data-testid="fx-rates-button">
            <ArrowLeftRightIcon className="mr-2 size-4" />
            {tr("button")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b border-slate-100 p-4">
          <SheetTitle>{tr("title")}</SheetTitle>
          <SheetDescription>{tr("description")}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <FxRatesCard />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** « 0,86 » comme « 0.86 » ; `null` si ce n'est pas un nombre > 0. */
function parseRate(raw: string): number | null {
  const n = Number(raw.trim().replace(",", "."));
  return raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

function FxRatesCard() {
  const tr = useTranslations("admin.money.FxRates");
  const data = useProjectQuery(api.fxRates.getFxRates, {});
  const save = useProjectMutation(api.fxRates.setFxRate);
  const showError = useConvexError();
  // Cible choisie à l'écran, quand celle du projet est indéterminée.
  const [chosen, setChosen] = useState<string | null>(null);
  // Devises ajoutées à la main, pas encore enregistrées.
  const [added, setAdded] = useState<string[]>([]);
  const [newCode, setNewCode] = useState("");

  if (data === undefined) return <Skeleton className="h-48 w-full" />;
  if (data === null) return null;

  const target = data.target ?? chosen ?? data.candidates[0] ?? null;
  const T = target?.toUpperCase() ?? "?";
  const known = new Set(data.rows.map((r) => r.currency));
  const rows: FxRow[] = [
    ...data.rows,
    ...added
      .filter((c) => !known.has(c))
      .map((c) => ({
        currency: c,
        rate: null,
        isPay: false,
        pricingCount: 0,
        collected: false,
        inCatalog: false,
        removable: null,
        removalBlockedBy: null,
      })),
  ].filter((r) => r.currency !== target);
  // Un taux posé sur la cible elle-même : réparable, et l'écran le dit.
  const targetRate =
    data.target !== null
      ? data.targetRate
      : (data.rows.find((r) => r.currency === target)?.rate ?? null);

  async function write(currency: string, rate: number | null): Promise<boolean> {
    try {
      await save({
        currency,
        rate,
        ...(data!.target === null && target !== null ? { target } : {}),
      });
      toast.success(rate === null ? tr("removed", { currency: currency.toUpperCase() }) : tr("saved", { currency: currency.toUpperCase() }));
      return true;
    } catch (e) {
      toast.error(showError(e, tr("error")));
      return false;
    }
  }

  const code = newCode.trim().toLowerCase();
  const codeValid =
    isCurrencyCode(code) && code !== target && !rows.some((r) => r.currency === code);

  return (
    <div className="space-y-4" data-testid="fx-rates">
      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
        {tr("payUnaffected")}
      </p>

      {data.source === "revenue" && (
        <p className="text-sm text-slate-700" data-testid="fx-target">
          {tr("targetRevenue", { target: T })}
        </p>
      )}
      {data.source === "pay" && (
        <p className="text-sm text-slate-700" data-testid="fx-target">
          {tr("targetPay", { target: T })}
        </p>
      )}
      {data.target === null && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          <p>
            {tr("targetUnknown", {
              currencies: data.candidates.map((c) => c.toUpperCase()).join(", "),
            })}
          </p>
          <Select
            value={target ?? ""}
            onValueChange={(v) => v && setChosen(String(v))}
            items={data.candidates.map((c) => ({ value: c, label: c.toUpperCase() }))}
          >
            <SelectTrigger className="h-8 w-40 bg-white" aria-label={tr("targetPick")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {data.candidates.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {target !== null && targetRate !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-900">
          <p>{tr("targetHasRate", { target: T })}</p>
          <Button size="sm" variant="outline" onClick={() => void write(target, null)}>
            {tr("remove")}
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{tr("empty", { target: T })}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {rows.map((r) => (
            <FxRateRow
              key={r.currency}
              row={r}
              target={T}
              disabled={target === null}
              onSave={(rate) => write(r.currency, rate)}
            />
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor="fx-new-currency" className="text-xs font-medium text-slate-600">
            {tr("addLabel")}
          </label>
          <Input
            id="fx-new-currency"
            value={newCode}
            maxLength={3}
            placeholder={tr("addPlaceholder")}
            onChange={(e) => setNewCode(e.target.value.toUpperCase())}
          />
        </div>
        <Button
          variant="outline"
          disabled={!codeValid}
          onClick={() => {
            setAdded((a) => [...a, code]);
            setNewCode("");
          }}
        >
          {tr("add")}
        </Button>
      </div>
    </div>
  );
}

function FxRateRow({
  row,
  target,
  disabled,
  onSave,
}: {
  row: FxRow;
  target: string;
  disabled: boolean;
  onSave: (rate: number | null) => Promise<boolean>;
}) {
  const tr = useTranslations("admin.money.FxRates");
  const locale = useLocale();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const C = row.currency.toUpperCase();
  const value = draft ?? (row.rate === null ? "" : String(row.rate));
  const parsed = parseRate(value);
  const dirty = draft !== null && parsed !== row.rate;
  const invalid = value.trim() !== "" && parsed === null;
  const fmt = (n: number) =>
    n.toLocaleString(locale, { maximumSignificantDigits: 6 });

  async function run(rate: number | null) {
    setBusy(true);
    if (await onSave(rate)) setDraft(null);
    setBusy(false);
  }

  const tags = [
    row.isPay ? tr("tagPay") : null,
    row.pricingCount > 0 ? tr("tagPricings", { count: row.pricingCount }) : null,
    row.collected ? tr("tagCollected") : null,
    !row.collected && row.inCatalog ? tr("tagCatalog") : null,
  ].filter((x): x is string => x !== null);

  return (
    <li className="space-y-1.5 px-3 py-3" data-testid={`fx-row-${row.currency}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-700">1 {C} =</span>
        <Input
          inputMode="decimal"
          className="h-8 w-32"
          aria-label={tr("rateOf", { currency: C, target })}
          aria-invalid={invalid}
          placeholder={tr("noRate")}
          value={value}
          disabled={disabled || busy}
          onChange={(e) => setDraft(e.target.value)}
        />
        <span className="text-sm text-slate-700">{target}</span>
        <div className="ml-auto flex gap-2">
          {dirty && parsed !== null && (
            <Button size="sm" disabled={busy} onClick={() => void run(parsed)}>
              {busy && <Loader2Icon className="mr-1 size-3 animate-spin" />}
              {tr("save")}
            </Button>
          )}
          {row.rate !== null && !dirty && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || disabled || row.removable === false}
              title={
                row.removalBlockedBy !== null
                  ? tr(`blocked.${row.removalBlockedBy}`, { currency: C, target })
                  : undefined
              }
              onClick={() => void run(null)}
            >
              {tr("remove")}
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {parsed !== null ? (
          <span>{tr("inverse", { target, inverse: fmt(1 / parsed), currency: C })}</span>
        ) : (
          <span className={row.pricingCount > 0 || row.collected ? "text-amber-700" : undefined}>
            {tr("missing")}
          </span>
        )}
        {tags.map((t) => (
          <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
            {t}
          </span>
        ))}
      </div>
      {invalid && <p className="text-xs text-rose-600">{tr("invalid")}</p>}
      {row.rate !== null && !dirty && row.removalBlockedBy !== null && (
        <p className="text-xs text-slate-400">
          {tr(`blocked.${row.removalBlockedBy}`, { currency: C, target })}
        </p>
      )}
    </li>
  );
}
