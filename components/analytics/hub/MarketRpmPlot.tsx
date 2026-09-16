"use client";

import { formatMoney } from "@/lib/format-rate";
import type { DecidedMarket } from "./MarketDecisionBoard";
import { VERDICT_UI } from "./marketVerdictUi";

/**
 * CE QUE COÛTENT 1 000 VUES, CE QU'ELLES VALENT.
 *
 * Abscisse : coût promo pour 1 000 vues. Ordonnée : RPM acquisition. Les DEUX
 * axes partagent la même échelle en euros, condition pour que la diagonale
 * (y = x) soit le seuil de rentabilité : au-dessus, les vues rapportent plus
 * qu'elles ne coûtent. Deux échelles ajustées chacune à ses données feraient
 * passer un marché déficitaire du bon côté.
 */
const W = 640;
const H = 320;
const G = { l: 52, r: 16, t: 14, b: 40 };

export function MarketRpmPlot({
  marches,
  devise,
  onSelect,
}: {
  marches: DecidedMarket[];
  devise: string | null;
  onSelect: (key: string) => void;
}) {
  const points = marches.filter(
    (m) => m.key !== "" && m.costPer1000 !== null && m.rpmAcquisition !== null,
  );
  if (points.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        Aucun marché n&apos;a à la fois des vues promo et un coût convertible sur la
        période.
      </p>
    );
  }
  const brut = Math.max(
    ...points.map((m) => Math.max(m.costPer1000 ?? 0, m.rpmAcquisition ?? 0)),
  );
  const max = pasRond(brut * 1.1);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const X = (v: number) => G.l + (v / max) * (W - G.l - G.r);
  const Y = (v: number) => H - G.b - (v / max) * (H - G.t - G.b);
  const maxClients = Math.max(1, ...points.map((m) => m.clients));
  const rayon = (m: DecidedMarket) => 5 + Math.sqrt(m.clients / maxClients) * 14;
  const euros = (n: number) =>
    formatMoney(n, devise ?? undefined).replace(/,00(?=\s)/, "");
  const absents = marches.filter((m) => m.key !== "").length - points.length;

  // ÉTIQUETTES SANS CHEVAUCHEMENT. Les marchés faibles s'entassent près de
  // l'origine : on place les étiquettes de haut en bas et on pousse vers le bas
  // celle qui toucherait la précédente sur la même bande horizontale.
  const etiquettes = new Map<string, { x: number; y: number; anchor: "start" | "end" }>();
  const placees: { x: number; y: number; anchor: "start" | "end" }[] = [];
  for (const m of [...points]
    .filter((p) => p.decision.verdict !== "trop_tot" && p.decision.verdict !== "sans_depense")
    .sort((a, b) => Y(a.rpmAcquisition ?? 0) - Y(b.rpmAcquisition ?? 0))) {
    const cx = X(m.costPer1000 ?? 0);
    const r = rayon(m);
    const anchor = cx < W - 150 ? "start" : "end";
    const x = anchor === "start" ? cx + r + 5 : cx - r - 5;
    let y = Y(m.rpmAcquisition ?? 0) + 4;
    for (const autre of placees) {
      const memeBande =
        Math.abs((anchor === "start" ? x : x - 100) - (autre.anchor === "start" ? autre.x : autre.x - 100)) < 110;
      if (memeBande && Math.abs(y - autre.y) < 15) y = autre.y + 15;
    }
    const pos = { x, y, anchor } as const;
    placees.push(pos);
    etiquettes.set(m.key, pos);
  }

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto h-auto w-full max-w-3xl"
        role="img"
        aria-label="Coût pour 1 000 vues contre RPM acquisition, par marché"
      >
        <polygon
          points={`${X(0)},${Y(0)} ${X(max)},${Y(max)} ${X(0)},${Y(max)}`}
          fill="#10b981"
          fillOpacity={0.06}
        />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={G.l} x2={W - G.r} y1={Y(t)} y2={Y(t)} stroke="#e2e8f0" />
            <text x={G.l - 8} y={Y(t) + 4} textAnchor="end" fontSize={11} fill="#64748b">
              {euros(t)}
            </text>
            <text x={X(t)} y={H - G.b + 18} textAnchor="middle" fontSize={11} fill="#64748b">
              {euros(t)}
            </text>
          </g>
        ))}
        <line x1={X(0)} y1={Y(0)} x2={X(max)} y2={Y(max)} stroke="#059669" strokeWidth={1.2} />
        <text x={X(max) - 4} y={Y(max) + 16} textAnchor="end" fontSize={11} fill="#059669">
          rentable
        </text>
        <text x={W - G.r} y={H - 4} textAnchor="end" fontSize={11} fill="#64748b">
          coût pour 1 000 vues →
        </text>
        {points.map((m) => {
          const ui = VERDICT_UI[m.decision.verdict];
          const cx = X(m.costPer1000 ?? 0);
          const cy = Y(m.rpmAcquisition ?? 0);
          const r = rayon(m);
          const etiquette = etiquettes.get(m.key);
          return (
            <g
              key={m.key}
              role="button"
              tabIndex={0}
              aria-label={`${m.label} : ouvrir la ligne`}
              className="cursor-pointer outline-none"
              onClick={() => onSelect(m.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(m.key);
                }
              }}
            >
              <circle cx={cx} cy={cy} r={r} fill={ui.stroke} fillOpacity={0.18} stroke={ui.stroke} strokeWidth={1.5} />
              {etiquette === undefined ? null : (
                <text
                  x={etiquette.x}
                  y={etiquette.y}
                  textAnchor={etiquette.anchor}
                  fontSize={12}
                  fontWeight={600}
                  fill="#0f172a"
                >
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="text-[11px] text-slate-400">
        Ordonnée : RPM acquisition. Au-dessus de la diagonale, 1 000 vues valent plus
        qu&apos;elles ne coûtent. Taille = nouveaux clients · points gris sans
        étiquette = trop tôt pour juger.
        {absents > 0
          ? ` ${absents} marché${absents > 1 ? "s" : ""} sans vues promo ou sans coût ne ${absents > 1 ? "sont" : "est"} pas placé${absents > 1 ? "s" : ""}.`
          : ""}
      </p>
    </div>
  );
}

/** Arrondit un maximum d'axe à un pas lisible (0,5 · 1 · 2 · 5 × 10ⁿ). */
function pasRond(n: number): number {
  if (n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (n <= m * p) return m * p;
  return 10 * p;
}
