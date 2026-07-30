"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import {
  AlertTriangleIcon,
  ClockIcon,
  InfoIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";
import type { Delta } from "@/lib/analytics-hub";
import { MIN_SAMPLE_SIZE, daysUntil } from "@/lib/analytics-hub";
import { HubTrendChart, type TrendPoint } from "./HubTrendChart";

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

/**
 * Décompte de réponse à un LITIGE (chargeback). L'échéance `needs_response_by`
 * vient de Whop ; on n'invente JAMAIS un délai si elle manque. Rouge dès qu'il
 * reste ≤ 3 jours (ou dépassé) : répondre passé l'échéance = litige perdu d'office.
 */
export function disputeDeadlineLabel(
  dueAt: number | null,
  now: number,
): { label: string; urgent: boolean } {
  const d = daysUntil(dueAt, now);
  if (d === null) return { label: "délai à vérifier sur Whop", urgent: true };
  if (d < 0) return { label: "échéance dépassée", urgent: true };
  if (d === 0) return { label: "dernier jour pour répondre", urgent: true };
  return { label: `${d} j pour répondre`, urgent: d <= 3 };
}

// ─── « i » explicatifs ───────────────────────────────────────────────────────

/**
 * Icône « i » ouvrant une explication courte AU CLIC. Un dashboard qu'on doit
 * faire interpréter par quelqu'un n'est pas terminé : chaque carte (et chaque
 * colonne au nom insuffisant) en porte une. La copie vit dans ./explanations.
 */
export function InfoDot({
  label,
  children,
  side = "top",
  className,
}: {
  /** Nom de ce qu'on explique — sert l'accessibilité (« Explication : … »). */
  label: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Explication : ${label}`}
        className={cn(
          "inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full align-middle text-slate-400 outline-none transition-colors hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-slate-300",
          className,
        )}
      >
        <InfoIcon className="size-3.5" strokeWidth={2} />
      </PopoverTrigger>
      <PopoverContent
        side={side}
        className="w-72 max-w-[calc(100vw-2rem)] text-xs leading-relaxed text-slate-600"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Libellé de colonne avec un « i » optionnel — à placer dans un TableHead. */
export function ColLabel({
  label,
  info,
  className,
}: {
  label: string;
  info?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {label}
      {info ? (
        <InfoDot label={label} side="top">
          {info}
        </InfoDot>
      ) : null}
    </span>
  );
}

// ─── Fraîcheur de synchro (en-tête) ──────────────────────────────────────────

/** Au-delà de ce délai depuis la dernière synchro, on le signale visiblement. */
export const STALE_SYNC_MS = 12 * 60 * 60 * 1000;

/**
 * « Dernière synchro : 28 juil., 19:58 » dans l'en-tête. Sans elle, impossible de
 * savoir si on lit des données de cinq minutes ou d'hier. Au-delà de 12 h, un
 * signalement ambre apparaît. Se met à jour d'elle-même après un Actualiser
 * (computedAt du cache est réactif).
 */
export function LastSyncIndicator({
  computedAt,
  now,
}: {
  computedAt: number | null;
  now: number;
}) {
  if (computedAt === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
        <ClockIcon className="size-3.5" />
        Jamais synchronisé
      </span>
    );
  }
  const stale = now - computedAt > STALE_SYNC_MS;
  const label = new Date(computedAt).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        stale ? "font-medium text-amber-700" : "text-slate-500",
      )}
      title={
        stale
          ? "Dernière synchro il y a plus de 12 heures — cliquez sur Actualiser."
          : undefined
      }
    >
      {stale ? (
        <AlertTriangleIcon className="size-3.5" />
      ) : (
        <ClockIcon className="size-3.5" />
      )}
      Dernière synchro : {label}
      {stale ? " · plus de 12 h" : null}
    </span>
  );
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

// ─── Marqueurs de rupture (séries non comparables au-delà d'une date) ────────

/** Réparation du webhook Whop de confirmation de paiement — 28/07/2026 au soir. */
export const WHOP_WEBHOOK_FIX_MS = Date.UTC(2026, 6, 28, 18, 0, 0);
/** Fenêtre d'analyse des agrégats PostHog (jours). */
export const ANALYSIS_WINDOW_DAYS = 90;

/** La fenêtre d'analyse (90 j finissant à `nowMs`) englobe-t-elle la réparation ? */
export function spansWebhookFix(nowMs: number): boolean {
  const start = nowMs - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return start <= WHOP_WEBHOOK_FIX_MS && WHOP_WEBHOOK_FIX_MS <= nowMs;
}

/**
 * Avertissement de rupture : avant la réparation du webhook (28/07 au soir),
 * AUCUN paiement n'accordait l'accès automatiquement — les clients devaient faire
 * « Restore purchases ». Les délais et taux de complétion qui TRAVERSENT cette
 * date ne mesurent pas un tunnel de paiement mais le temps pour trouver un bouton
 * de secours : non comparables. N'affiche rien si la fenêtre ne traverse pas la date.
 */
export function WebhookFixNotice({
  now,
  className,
}: {
  now: number;
  className?: string;
}) {
  if (!spansWebhookFix(now)) return null;
  return (
    <HubNotice className={cn("border-red-200 bg-red-50/70 text-red-900", className)}>
      <strong>Webhook de confirmation réparé le 28/07 au soir.</strong> Avant cette
      date, aucun paiement n&apos;accordait l&apos;accès automatiquement — les clients
      devaient faire « Restore purchases ». Les délais et taux de complétion qui
      traversent cette date ne mesurent pas un tunnel de paiement : ils ne sont
      comparables à rien.
    </HubNotice>
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

/**
 * Tuile KPI : valeur, évolution, « i » optionnel, et courbe LISIBLE (survol =
 * date + valeur, dates en abscisse). `points` porte l'horodatage — sans lui, pas
 * de survol daté. Rétro-compat : `series` (valeurs seules) reste accepté mais
 * sans dates au survol.
 */
export function KpiTile({
  label,
  value,
  delta,
  points,
  series,
  hint,
  info,
  formatValue,
}: {
  label: string;
  value: string;
  delta: Delta | null;
  points?: TrendPoint[];
  series?: number[];
  hint?: string;
  info?: ReactNode;
  formatValue?: (n: number) => string;
}) {
  const chartPoints: TrendPoint[] =
    points ?? (series ?? []).map((v, i) => ({ ts: i, value: v }));
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
            {label}
            {info ? <InfoDot label={label}>{info}</InfoDot> : null}
          </span>
          <DeltaBadge delta={delta} />
        </div>
        <div className="text-2xl font-bold tabular-nums text-slate-900">
          {value}
        </div>
        {chartPoints.length >= 2 && points ? (
          <HubTrendChart
            points={chartPoints}
            height={64}
            maxTicks={2}
            formatValue={formatValue}
            ariaLabel={`Évolution : ${label}`}
            className="mt-auto"
          />
        ) : chartPoints.length >= 2 ? (
          <Sparkline values={chartPoints.map((p) => p.value)} className="mt-auto" />
        ) : null}
        {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/** En-tête de carte du hub (titre + « i » + sous-titre + action optionnelle). */
export function HubCardHeader({
  title,
  subtitle,
  action,
  info,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Explication ouverte au clic sur un « i » collé au titre. */
  info?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="space-y-0.5">
        <h3 className="flex items-center gap-1.5 text-base font-semibold text-slate-900">
          {title}
          {info ? <InfoDot label={title}>{info}</InfoDot> : null}
        </h3>
        {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
