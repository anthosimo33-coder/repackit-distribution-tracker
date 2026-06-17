"use client";

import { useState } from "react";
import { computeEarnings, type RateSnapshot } from "@/lib/earnings";
import { formatEuros, formatViews } from "@/lib/format-rate";

/**
 * P7 — calculateur de gains : slider de vues → base + bonus (+ primes) = total,
 * calculé sur le rateSnapshot FIGÉ de l'assignment (lib/earnings, pur + testé).
 */
const STEPS = [0, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000];

export function EarningsCalculator({ rate }: { rate: RateSnapshot }) {
  const [idx, setIdx] = useState(3); // 10k par défaut
  const views = STEPS[idx];
  const e = computeEarnings(rate, views);

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-700">
          Estimation pour {formatViews(views)} vues
        </span>
        <span className="text-2xl font-semibold tabular-nums text-slate-900">
          {formatEuros(e.total)}
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
        aria-label="Nombre de vues estimé"
      />
      <ul className="space-y-1 text-sm text-slate-600">
        <li className="flex justify-between">
          <span>Base</span>
          <span className="tabular-nums">{formatEuros(e.base)}</span>
        </li>
        {rate.viewBonusPer1k != null && rate.viewBonusPer1k > 0 && (
          <li className="flex justify-between">
            <span>Bonus aux vues</span>
            <span className="tabular-nums">{formatEuros(e.viewBonus)}</span>
          </li>
        )}
        {e.bounty > 0 && (
          <li className="flex justify-between">
            <span>Primes paliers</span>
            <span className="tabular-nums">{formatEuros(e.bounty)}</span>
          </li>
        )}
        <li className="flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-900">
          <span>Total estimé</span>
          <span className="tabular-nums" data-testid="earnings-total">
            {formatEuros(e.total)}
          </span>
        </li>
      </ul>
      <p className="text-xs text-slate-400">
        Estimation indicative ; le paiement se fait sur les vues réelles du post
        validé.
      </p>
    </div>
  );
}
