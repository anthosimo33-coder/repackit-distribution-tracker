"use client";

import { useState } from "react";
import { computeEarnings, type RateSnapshot } from "@/lib/earnings";
import { formatMoney, formatViews } from "@/lib/format-rate";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useTranslations } from "next-intl";

/**
 * P7 — calculateur de gains : slider de vues → base + bonus (+ primes) = total,
 * calculé sur le rateSnapshot FIGÉ de l'assignment (lib/earnings, pur + testé).
 */
const STEPS = [0, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000];

export function EarningsCalculator({
  rate,
  currency,
}: {
  rate: RateSnapshot;
  currency?: string | null;
}) {
  const te = useTranslations("estimator");
  const loc = useIntlLocale();
  const [idx, setIdx] = useState(3); // 10k par défaut
  const views = STEPS[idx];
  const e = computeEarnings(rate, views);

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-700">
          Estimation pour {formatViews(views, loc)} vues
        </span>
        <span className="text-2xl font-semibold tabular-nums text-slate-900">
          {formatMoney(e.total, currency, loc)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={STEPS.length - 1}
        step={1}
        value={idx}
        onChange={(ev) => setIdx(Number(ev.target.value))}
        className="h-6 w-full cursor-pointer accent-primary"
        aria-label={te("views")}
      />
      <ul className="space-y-1 text-sm text-slate-600">
        <li className="flex justify-between">
          <span>{te("base")}</span>
          <span className="tabular-nums">{formatMoney(e.base, currency, loc)}</span>
        </li>
        {rate.viewBonusPer1k != null && rate.viewBonusPer1k > 0 && (
          <li className="flex justify-between">
            <span>{te("viewBonus")}</span>
            <span className="tabular-nums">{formatMoney(e.viewBonus, currency, loc)}</span>
          </li>
        )}
        {e.bounty > 0 && (
          <li className="flex justify-between">
            <span>{te("bounties")}</span>
            <span className="tabular-nums">{formatMoney(e.bounty, currency, loc)}</span>
          </li>
        )}
        <li className="flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-900">
          <span>{te("total")}</span>
          <span className="tabular-nums" data-testid="earnings-total">
            {formatMoney(e.total, currency, loc)}
          </span>
        </li>
      </ul>
      <p className="text-xs text-slate-400">
        {te("disclaimer")}
      </p>
    </div>
  );
}
