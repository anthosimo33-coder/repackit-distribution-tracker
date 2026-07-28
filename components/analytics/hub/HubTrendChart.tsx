"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

/**
 * Courbe LISIBLE du hub (remplace la sparkline muette). Une sparkline ne servait
 * à rien : on ne distinguait pas une croissance régulière d'un pic sur une seule
 * journée (exactement ce qui s'est passé le 27/07). Ici :
 *  - valeur au survol, avec la date et le nombre ;
 *  - dates lisibles en abscisse ;
 *  - la série suit le sélecteur de période (les points sont déjà découpés amont).
 *
 * SVG inline plutôt que recharts : un ResponsiveContainer dans une carte étroite
 * se rend en 0×0 dans certains contextes. Le tracé stretch en preserveAspectRatio
 * (trait non-scaling) et le survol se repère au pointeur, sans mesure de largeur.
 */

export interface TrendPoint {
  ts: number;
  value: number;
}

/** Abscisse courte « 28 juil. » (midi local pour éviter tout décalage de fuseau). */
function frShortDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

const PAD = 12; // marge verticale (%) — la courbe ne touche pas les bords.

export function HubTrendChart({
  points,
  formatValue = formatNumber,
  height = 132,
  maxTicks = 4,
  ariaLabel,
  className,
}: {
  points: TrendPoint[];
  formatValue?: (n: number) => string;
  height?: number;
  /** Nombre max d'étiquettes de dates en abscisse (2 pour une tuile compacte). */
  maxTicks?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();

  const geo = useMemo(() => {
    if (points.length === 0) return null;
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const n = points.length;
    const coords = points.map((p, i) => {
      const x = n === 1 ? 50 : (i / (n - 1)) * 100;
      const yFrac = (p.value - min) / span; // 0 (bas) → 1 (haut)
      const y = PAD + (1 - yFrac) * (100 - 2 * PAD);
      return { x, y };
    });
    return { coords, min, max };
  }, [points]);

  if (!geo || points.length === 0) {
    return (
      <div
        className={cn("flex items-center justify-center text-xs text-slate-300", className)}
        style={{ height }}
      >
        pas encore de données
      </div>
    );
  }

  const { coords } = geo;
  const n = points.length;
  const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const area = `0,100 ${line} 100,100`;

  // Étiquettes d'abscisse : jusqu'à `maxTicks` dates réparties (début → fin).
  const ticks = Math.max(2, maxTicks);
  const tickIdx = Array.from(
    new Set(
      n <= ticks
        ? points.map((_, i) => i)
        : Array.from({ length: ticks }, (_, k) =>
            Math.round((k / (ticks - 1)) * (n - 1)),
          ),
    ),
  );

  const onMove = (clientX: number, rect: DOMRect) => {
    if (rect.width === 0) return;
    const rel = (clientX - rect.left) / rect.width;
    const idx = Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1))));
    setActive(idx);
  };

  const act = active !== null ? { ...coords[active], p: points[active] } : null;
  // Ancrage horizontal de l'infobulle pour ne pas déborder aux extrémités.
  const tipShift =
    act === null ? "-50%" : act.x < 16 ? "0%" : act.x > 84 ? "-100%" : "-50%";

  return (
    <div className={cn("space-y-1", className)}>
      <div
        className="relative w-full"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setActive(null)}
        onTouchStart={(e) =>
          onMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())
        }
        onTouchMove={(e) =>
          onMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())
        }
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#${gradientId})`} />
          <polyline
            points={line}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={1.75}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {act ? (
            <line
              x1={act.x}
              y1={0}
              x2={act.x}
              y2={100}
              stroke="var(--primary)"
              strokeWidth={1}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
              opacity={0.45}
            />
          ) : null}
        </svg>

        {/* Point actif (HTML pour un rendu net, hors distorsion du viewBox). */}
        {act ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow"
            style={{ left: `${act.x}%`, top: `${act.y}%` }}
          />
        ) : null}

        {/* Infobulle : date + valeur au survol. */}
        {act ? (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg"
            style={{
              left: `${act.x}%`,
              top: `${act.y}%`,
              transform: `translate(${tipShift}, -140%)`,
            }}
          >
            <span className="tabular-nums text-slate-300">{frShortDate(act.p.ts)}</span>{" "}
            <span className="tabular-nums">{formatValue(act.p.value)}</span>
          </div>
        ) : null}
      </div>

      {/* Abscisse : dates lisibles. */}
      <div className="relative h-3.5 w-full text-[10px] text-slate-400">
        {tickIdx.map((i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 tabular-nums"
            style={{
              left: `${Math.max(4, Math.min(96, coords[i].x))}%`,
            }}
          >
            {frShortDate(points[i].ts)}
          </span>
        ))}
      </div>
    </div>
  );
}
