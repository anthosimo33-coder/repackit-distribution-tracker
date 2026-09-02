"use client";

import { useState } from "react";

import { useProjectQuery } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { MixedCurrencyNotice } from "@/components/MixedCurrencyNotice";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format-rate";
import { formatNumber } from "@/lib/format";
import { computeProfitability } from "@/lib/profitability";
import { effectiveFxRate } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { InfoIcon, TrendingUpIcon } from "lucide-react";

/**
 * "2026-07" → "juil. 2026" (fr-FR). La clé vient du serveur, déjà découpée en mois
 * EUROPE/PARIS (convex/dateFr `monthKeyParis`) : ici on ne fait que rendre une clé
 * lisible, l'UTC ne sert qu'à neutraliser le fuseau du navigateur sur un 1er du
 * mois — il ne redécoupe rien.
 */
function formatMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("fr-FR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** RPM = revenu net / 1000 vues → devise du REVENU (€). */
function formatRpm(rpm: number | null, currency: string | null): string {
  return rpm === null ? "—" : formatMoney(rpm, currency);
}

/** Marge dans la devise du revenu ; « — » si non calculable (devises non reliées). */
function formatMargin(margin: number | null, currency: string | null): string {
  return margin === null ? "—" : formatMoney(margin, currency);
}

function Metric({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cn("text-lg font-semibold text-slate-900", valueClass)}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

/**
 * Rentabilité par projet (rentabilité P3) — REVENU net Whop vs COÛT créateurs →
 * MARGE (mise en avant) + RPM business, avec un toggle « avec / sans warmup ».
 *
 * Le toggle change UNIQUEMENT le DÉNOMINATEUR (les vues) → il recalcule les vues
 * et le RPM (dilué avec warmup, vrai RPM sans), JAMAIS le revenu Whop ni le coût
 * (calcul dérivé côté client via lib/profitability). Rendue uniquement si le
 * projet a un mapping Whop. Cumul (cf query : mois calendaires, même moteur de
 * paie que les Paiements).
 */
export function ProfitabilityCard() {
  const data = useProjectQuery(api.profitability.getProjectProfitability, {});
  // Défaut = sans warmup → le VRAI RPM business (vues monétisées).
  const [includeWarmup, setIncludeWarmup] = useState(false);

  if (data === undefined) return <Skeleton className="h-56 w-full" />;
  if (!data.configured) return null;

  // Deux devises : revenu Whop (data.currency, €) et paie créatrices (data.payCurrency,
  // $). Le taux effectif relie les deux pour la marge (null → marge non calculée).
  const revenueCurrency = data.currency;
  const payCurrency = data.payCurrency;
  const fx = effectiveFxRate(payCurrency, revenueCurrency, data.fxRateToRevenue);
  const withFx = <T extends object>(x: T) => ({ ...x, fxRateToRevenue: fx });

  const total = computeProfitability(withFx(data.total), includeWarmup);
  const marginPositive = total.margin !== null && total.margin >= 0;

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <MixedCurrencyNotice
          mixed={data.mixedCurrency}
          present={data.mixedCurrencyPresent}
          currencies={data.currenciesPresent}
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <TrendingUpIcon className="size-4" />
            Rentabilité — cumul
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
            <Switch
              checked={includeWarmup}
              onCheckedChange={setIncludeWarmup}
              aria-label="Inclure les vues des posts warmup"
            />
            Inclure les vues warmup
          </label>
        </div>

        {/* Marge — chiffre central */}
        <div>
          <div className="text-xs font-medium text-slate-500">Marge</div>
          <div
            className={cn(
              "text-3xl font-semibold tracking-tight",
              total.margin === null
                ? "text-slate-400"
                : marginPositive
                  ? "text-emerald-700"
                  : "text-rose-600",
            )}
          >
            {formatMargin(total.margin, revenueCurrency)}
          </div>
          <div className="text-[11px] text-slate-400">
            {total.margin === null
              ? "revenu et coût dans deux devises : renseigne un taux de change pour la marge"
              : "revenu net − coût créateurs converti"}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric
            label="Revenu Whop"
            value={formatMoney(total.revenueNet, revenueCurrency)}
            hint="net — après frais Whop"
            valueClass="text-emerald-700"
          />
          <Metric
            label="Coût créateurs"
            value={formatMoney(total.creatorCost, payCurrency)}
            hint="fixe + CPM + bonus"
          />
          <Metric
            label={includeWarmup ? "RPM dilué" : "RPM business"}
            value={formatRpm(total.rpm, revenueCurrency)}
            hint={
              includeWarmup ? "/ 1000 vues (warmup inclus)" : "/ 1000 vues monétisées"
            }
            valueClass="text-slate-900"
          />
          <Metric
            label="Vues"
            value={formatNumber(total.views)}
            hint={includeWarmup ? "warmup inclus" : "monétisées (hors warmup)"}
          />
        </div>

        <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
          <InfoIcon className="mt-px size-3.5 shrink-0" />
          Le toggle warmup ne change que les vues (donc le RPM) — le revenu Whop
          net et le coût créateurs sont identiques dans les deux cas.
        </p>

        {data.months.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Mois</th>
                  <th className="py-1.5 px-3 text-right font-medium">
                    Revenu net
                  </th>
                  <th className="py-1.5 px-3 text-right font-medium">Coût</th>
                  <th className="py-1.5 px-3 text-right font-medium">Marge</th>
                  <th className="py-1.5 px-3 text-right font-medium">Vues</th>
                  <th className="py-1.5 pl-3 text-right font-medium">RPM</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((m) => {
                  const row = computeProfitability(withFx(m), includeWarmup);
                  return (
                    <tr
                      key={m.period}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="py-1.5 pr-3 whitespace-nowrap text-slate-600">
                        {formatMonth(m.period)}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-emerald-700">
                        {formatMoney(row.revenueNet, revenueCurrency)}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-slate-600">
                        {formatMoney(row.creatorCost, payCurrency)}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 px-3 text-right font-medium tabular-nums",
                          row.margin === null
                            ? "text-slate-400"
                            : row.margin >= 0
                              ? "text-emerald-700"
                              : "text-rose-600",
                        )}
                      >
                        {formatMargin(row.margin, revenueCurrency)}
                      </td>
                      <td className="py-1.5 px-3 text-right tabular-nums text-slate-500">
                        {formatNumber(row.views)}
                      </td>
                      <td className="py-1.5 pl-3 text-right tabular-nums text-slate-700">
                        {formatRpm(row.rpm, revenueCurrency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
