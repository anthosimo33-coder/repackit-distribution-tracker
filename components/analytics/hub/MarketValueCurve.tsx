"use client";

import { formatMoney } from "@/lib/format-rate";
import { curveScale, marchesTraces } from "@/lib/market-plot";
import type { MarketDerived } from "@/lib/market-aggregate";

/** Teintes de série — lisibles côte à côte, et distinctes en niveaux de gris. */
const TEINTES = ["#6d28d9", "#0d7a6f", "#c01048", "#a8620a", "#2563eb"];

/**
 * LA VALEUR D'UN CLIENT, JOUR APRÈS JOUR — et ce qu'il a coûté.
 *
 * Trait plein : le revenu net cumulé d'un client depuis son premier paiement.
 * Pointillé de la même couleur : son coût d'acquisition. La courbe franchit le
 * pointillé le jour du remboursement — c'est la même information que la barre
 * d'à côté, mais on y voit la PENTE, donc si le marché ralentit ou continue.
 *
 * ⚠️ CHAQUE POINT A SON PROPRE EFFECTIF. Le jalon 90 ne porte que les clients
 * assez âgés, le jalon 0 les porte tous : la courbe n'est pas une cohorte unique
 * suivie dans le temps. Un point sous le seuil d'effectif est SAUTÉ et la ligne
 * le traverse — la remplacer par un zéro ferait plonger la courbe là où on ne
 * sait simplement pas.
 */
export function MarketValueCurve({
  marches,
  devise,
  selection,
  onSelect,
}: {
  marches: MarketDerived[];
  devise: string | null;
  selection: string | null;
  onSelect: (key: string) => void;
}) {
  const traces = marchesTraces(marches);
  const echelle = curveScale(traces);
  const argent = (n: number) => formatMoney(n, devise ?? undefined);

  if (traces.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-xs text-slate-400">
        Aucun marché n&apos;a encore assez de clients mûrs pour tracer une courbe.
      </p>
    );
  }

  // 3:1 — le temps a besoin de largeur, la valeur non.
  const W = 300;
  const H = 100;
  const px = (f: number) => f * W;
  const py = (f: number) => H - f * H;

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_11rem]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="aspect-[3/1] w-full overflow-visible"
        role="img"
        aria-label="Valeur cumulée par client acquis, de 0 à 90 jours, face au coût d'acquisition"
      >
        {echelle.ticks.map((t) => (
          <g key={t}>
            <line
              x1={px(echelle.x(0))}
              y1={py(echelle.y(t))}
              x2={px(echelle.x(echelle.jourMax))}
              y2={py(echelle.y(t))}
              stroke="#e2e8f0"
              strokeWidth={0.5}
            />
            <text
              x={px(echelle.x(0)) - 3}
              y={py(echelle.y(t)) + 1.8}
              textAnchor="end"
              fontSize={5}
              fill="#94a3b8"
            >
              {argent(t)}
            </text>
          </g>
        ))}
        {echelle.jours.map((j) => (
          <text
            key={j}
            x={px(echelle.x(j))}
            y={py(echelle.y(0)) + 7}
            textAnchor="middle"
            fontSize={5}
            fill="#94a3b8"
          >
            J+{j}
          </text>
        ))}
        {traces.map((m, i) => {
          const teinte = TEINTES[i % TEINTES.length];
          const attenue = selection !== null && selection !== m.key;
          // Les points MESURABLES seulement : un jalon sous le seuil est sauté,
          // et la ligne le traverse au lieu de plonger à zéro.
          const points = m.value
            .filter((p) => p.value !== null)
            .map((p) => ({ x: px(echelle.x(p.day)), y: py(echelle.y(p.value!)) }));
          if (points.length === 0) return null;
          const d = points
            .map((p, k) => `${k === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
            .join(" ");
          const dernier = points[points.length - 1];
          return (
            <g
              key={m.key}
              className="cursor-pointer"
              opacity={attenue ? 0.28 : 1}
              onClick={() => onSelect(m.key)}
            >
              {m.cac !== null && m.cac > 0 && m.cac <= echelle.max ? (
                <line
                  x1={px(echelle.x(0))}
                  y1={py(echelle.y(m.cac))}
                  x2={px(echelle.x(echelle.jourMax))}
                  y2={py(echelle.y(m.cac))}
                  stroke={teinte}
                  strokeWidth={0.6}
                  strokeDasharray="1.5 1.5"
                  opacity={0.65}
                />
              ) : null}
              <path
                d={d}
                fill="none"
                stroke={teinte}
                strokeWidth={selection === m.key ? 1.8 : 1.1}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle cx={dernier.x} cy={dernier.y} r={1.6} fill={teinte} />
            </g>
          );
        })}
      </svg>
      <ul className="space-y-1.5 text-xs">
        {traces.map((m, i) => {
          const fin = [...m.value].reverse().find((p) => p.value !== null);
          return (
            <li key={m.key}>
              <button
                type="button"
                onClick={() => onSelect(m.key)}
                aria-pressed={selection === m.key}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-slate-50"
              >
                <span
                  aria-hidden="true"
                  className="h-0.5 w-3.5 shrink-0 rounded"
                  style={{ background: TEINTES[i % TEINTES.length] }}
                />
                <span className="truncate text-slate-700">{m.label}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-slate-500">
                  {fin?.value !== undefined && fin.value !== null
                    ? argent(fin.value)
                    : "—"}
                </span>
              </button>
            </li>
          );
        })}
        <li className="border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-400">
          Le pointillé de chaque marché est son coût d&apos;acquisition : la
          courbe le franchit le jour du remboursement. Un pointillé ABSENT sort du
          cadre, c&apos;est-à-dire que ce marché coûte bien plus qu&apos;il ne
          rapporte — le remboursement, au-dessus, le dit. Au-delà de 90 jours,
          l&apos;historique ne suffit pas encore.
        </li>
      </ul>
    </div>
  );
}
