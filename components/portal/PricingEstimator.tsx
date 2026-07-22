"use client";

import { useState } from "react";
import {
  estimateMissionEarnings,
  type PricingSnapshot,
} from "@/lib/pricing-engine";
import { formatMoney, formatViews } from "@/lib/format-rate";

/**
 * Estimation de rému d'une mission relevant du MODÈLE PRICING v2 (mission de
 * campagne de script : assignment.pricingSnapshot présent). Le barème legacy
 * rateSnapshot y est un placeholder neutre {basePerPost:0} → on calcule depuis
 * pricingSnapshot via lib/pricing-engine (pur, testé) : part FIXE/vidéo
 * (montantFixe/nbVideosCible) + part CPM pilotée par le slider de vues
 * (tauxCPM × vues/1000). PAS de paliers de bonus ici (créateur-niveau, cumul à
 * vie, affichés sur l'écran Paiements). Les missions de FORMAT continuent
 * d'utiliser EarningsCalculator (rateSnapshot réel).
 */
const STEPS = [0, 1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000];

export function PricingEstimator({ snapshot }: { snapshot: PricingSnapshot }) {
  const [idx, setIdx] = useState(3); // 10k par défaut
  const views = STEPS[idx];
  const e = estimateMissionEarnings(snapshot, views);

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-700">
          Estimation pour {formatViews(views)} vues
        </span>
        <span className="text-2xl font-semibold tabular-nums text-slate-900">
          {formatMoney(e.total)}
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
          <span>Base (fixe par vidéo)</span>
          <span className="tabular-nums">{formatMoney(e.fixed)}</span>
        </li>
        {snapshot.tauxCPM > 0 && (
          <li className="flex justify-between">
            <span>CPM (sur tes vues)</span>
            <span className="tabular-nums">{formatMoney(e.cpm)}</span>
          </li>
        )}
        <li className="flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-900">
          <span>Total estimé</span>
          <span className="tabular-nums" data-testid="earnings-total">
            {formatMoney(e.total)}
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
