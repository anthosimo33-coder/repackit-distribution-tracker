"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { AlertTriangleIcon, InfoIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import type { Delta } from "@/lib/analytics-hub";
import { MIN_SAMPLE_SIZE } from "@/lib/analytics-hub";

/**
 * Briques partagées du hub Analytics.
 *
 * Deux règles transverses y sont matérialisées :
 *  - ACCENT = token `primary` du projet (bg-primary / text-primary /
 *    var(--primary) pour le SVG). Aucune couleur d'accent en dur — le shell
 *    admin injecte projects.accentColor dans --primary (cf SidebarLayout).
 *    Les couleurs SÉMANTIQUES (ambre = avertissement, rouge/vert = sens d'une
 *    variation) restent fixes : elles ne sont pas l'accent de marque.
 *  - « — » et jamais 0 quand une valeur est inconnue (event pas encore émis,
 *    effectif nul). Un zéro inventé se lit comme une mesure.
 */

/** Valeur inconnue → tiret cadratin. Ne JAMAIS afficher 0 à la place. */
export function dash(
  value: number | null | undefined,
  format: (n: number) => string = formatNumber,
): string {
  return value === null || value === undefined ? "—" : format(value);
}

/** Pourcentage (1 décimale) tolérant au null. */
export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${formatNumber(value)} %`;
}

/** Facteur multiplicatif (× la moyenne) tolérant au null. */
export function factor(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `×${value}`;
}

/** Durée lisible depuis des millisecondes (s / min / h / j). */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  // Latence / délais de paiement se lisent en SECONDES (jusqu'à ~10 min).
  if (ms < 600000) return `${Math.round(ms / 1000)} s`;
  const min = ms / 60000;
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} j`;
}

// ─── États vides ─────────────────────────────────────────────────────────────

/**
 * État vide informatif — « en attente des premiers événements », JAMAIS un zéro
 * trompeur ni un écran cassé. Reprend le gabarit encadré-pointillé du Radar.
 */
export function HubEmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 text-center",
        compact ? "py-8" : "py-14",
      )}
    >
      <Icon
        className={cn("text-slate-300", compact ? "size-8" : "size-12")}
        strokeWidth={1.5}
      />
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mx-auto max-w-md text-sm text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** Encart « carte alimentée par des events pas encore émis ». */
export function AwaitingEvents({
  what,
  compact,
}: {
  what: string;
  compact?: boolean;
}) {
  return (
    <HubEmptyState
      icon={InfoIcon}
      compact={compact}
      title="En attente des premiers événements"
      description={`Cette carte s'alimentera dès que Snytch émettra ${what}. Aucune donnée n'est encore remontée — rien n'est affiché à zéro pour éviter une lecture trompeuse.`}
    />
  );
}

// ─── Garde-fous statistiques ─────────────────────────────────────────────────

/**
 * Effectif d'une comparaison + verdict. Sous MIN_SAMPLE_SIZE la différence peut
 * n'être que du bruit : badge d'avertissement explicite (garde-fou appliqué
 * PARTOUT où une conclusion est suggérée — paywalls, formats, créatrices,
 * prédicteurs, cohortes).
 */
export function SampleBadge({
  n,
  conclusive,
  className,
}: {
  n: number;
  conclusive: boolean;
  className?: string;
}) {
  if (conclusive) {
    return (
      <span className={cn("text-xs tabular-nums text-slate-400", className)}>
        n = {formatNumber(n)}
      </span>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border-amber-200 bg-amber-50 text-amber-700",
        className,
      )}
      title={`Effectif insuffisant (n < ${MIN_SAMPLE_SIZE}) : la différence observée n'est pas distinguable du bruit.`}
    >
      <AlertTriangleIcon className="size-3" />
      n = {formatNumber(n)} · non concluant
    </Badge>
  );
}

/** Rappel transverse : une corrélation observée n'établit pas une causalité. */
export function CorrelationNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs leading-relaxed text-slate-400", className)}>
      Corrélation ≠ causalité : ces écarts décrivent des populations qui
      diffèrent déjà par ailleurs. Un segment sous {MIN_SAMPLE_SIZE} observations
      est signalé comme non concluant.
    </p>
  );
}

/** Bandeau d'avertissement (limite d'attribution, donnée partielle…). */
export function HubNotice({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-amber-900",
        className,
      )}
    >
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

// ─── Sparkline + KPI ─────────────────────────────────────────────────────────

/**
 * Sparkline SVG inline (pas de recharts : un ResponsiveContainer dans une carte
 * étroite se rend en 0×0 dans certains contextes, et une polyline suffit).
 * Tracée à l'accent du projet via var(--primary).
 */
export function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 24 - ((v - min) / span) * 22 - 1;
      return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("h-6 w-full", className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Variation vs période précédente (flèche + valeur, « — » si non calculable). */
export function DeltaBadge({ delta }: { delta: Delta | null }) {
  if (delta === null || delta.direction === "flat") {
    return <span className="text-xs text-slate-400">stable</span>;
  }
  const up = delta.direction === "up";
  const Icon = up ? TrendingUpIcon : TrendingDownIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        up ? "text-emerald-600" : "text-red-600",
      )}
    >
      <Icon className="size-3" />
      {delta.pct === null ? formatNumber(delta.abs) : `${formatNumber(delta.pct)} %`}
    </span>
  );
}

/** Tuile KPI : valeur, évolution vs période précédente, sparkline. */
export function KpiTile({
  label,
  value,
  delta,
  series,
  hint,
}: {
  label: string;
  value: string;
  delta: Delta | null;
  series: number[];
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-slate-500">{label}</span>
          <DeltaBadge delta={delta} />
        </div>
        <div className="text-2xl font-bold tabular-nums text-slate-900">
          {value}
        </div>
        <Sparkline values={series} />
        {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/** En-tête de carte du hub (titre + sous-titre + action optionnelle). */
export function HubCardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="space-y-0.5">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
