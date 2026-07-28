"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { formatMoney } from "@/lib/format-rate";
import {
  buildFunnel,
  computeConversion,
  computeDelta,
  delayStatus,
  hasLongTail,
  overallRate,
  type Delta,
} from "@/lib/analytics-hub";
import { ConversionTable, FunnelChart } from "./HubCharts";
import {
  AwaitingEvents,
  CorrelationNote,
  HubCardHeader,
  KpiTile,
  SampleBadge,
  formatDuration,
} from "./HubPrimitives";
import type { ProductAnalyticsData, RevenueData } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Libellés des étapes du funnel principal (clés côté convex/posthogSync). */
const FUNNEL_LABELS: Record<string, string> = {
  visit: "Visite",
  signup_completed: "Inscription",
  paywall_viewed: "Offre vue",
  checkout_started: "Checkout ouvert",
  subscription_completed: "Abonnement",
  // Jalons d'activation (hors chemin de monétisation) — conservés pour d'autres
  // vues éventuelles ; le funnel principal ne les liste plus.
  username_entered: "Nom d'utilisateur saisi",
  target_added: "1re cible ajoutée",
  first_alert_received: "1re alerte reçue",
};

/**
 * Budgets de délai attendus par étape d'activation. Au-delà → « lent », au-delà
 * du double → « anormal ». Ce sont des HYPOTHÈSES produit (pas une mesure) :
 * elles sont ici pour être ajustées quand les premiers délais réels arriveront.
 */
const TTV_STEPS = [
  { key: "signup_to_target", label: "Inscription → 1re cible", budgetMs: 10 * 60 * 1000 },
  { key: "target_to_alert", label: "1re cible → 1re alerte", budgetMs: DAY_MS },
  { key: "alert_to_payment", label: "1re alerte → paiement", budgetMs: 7 * DAY_MS },
] as const;

const PERIODS = [
  { key: "J7", label: "7 j", days: 7 },
  { key: "J30", label: "30 j", days: 30 },
  { key: "J90", label: "90 j", days: 90 },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

type Dimension = "global" | "source" | "language";
const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: "global", label: "Global" },
  { key: "source", label: "Par source" },
  { key: "language", label: "Par langue" },
];

/** Segmented control à l'accent du projet (bg-primary sur l'état actif). */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.key
              ? "border-primary bg-primary text-primary-foreground"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function OverviewTab({
  analytics,
  revenue,
}: {
  analytics: ProductAnalyticsData;
  revenue: RevenueData | undefined;
}) {
  const [period, setPeriod] = useState<PeriodKey>("J30");
  const [dimension, setDimension] = useState<Dimension>("global");
  const [segment, setSegment] = useState<string | null>(null);

  const days = PERIODS.find((p) => p.key === period)?.days ?? 30;
  const daily = analytics.overview.daily;

  // Fenêtre courante vs fenêtre précédente de MÊME longueur. L'ancre est la fin
  // du DERNIER jour mesuré (et non l'horloge du navigateur) : la série vient
  // d'un cache horaire, s'appuyer sur Date.now() rendrait le calcul impur et
  // ferait diverger l'affichage du jeu de données réellement disponible.
  const kpis = useMemo(() => {
    const anchor = daily.length > 0 ? daily[daily.length - 1].ts + DAY_MS : 0;
    const curFrom = anchor - days * DAY_MS;
    const prevFrom = anchor - 2 * days * DAY_MS;
    const cur = daily.filter((d) => d.ts >= curFrom);
    const prev = daily.filter((d) => d.ts >= prevFrom && d.ts < curFrom);
    const sum = (rows: typeof daily, k: "visitors" | "signups" | "subs") =>
      rows.reduce((s, r) => s + r[k], 0);
    return {
      visitors: {
        value: sum(cur, "visitors"),
        delta: computeDelta(sum(cur, "visitors"), sum(prev, "visitors")),
        series: cur.map((d) => d.visitors),
      },
      signups: {
        value: sum(cur, "signups"),
        delta: computeDelta(sum(cur, "signups"), sum(prev, "signups")),
        series: cur.map((d) => d.signups),
      },
      subs: {
        value: sum(cur, "subs"),
        delta: computeDelta(sum(cur, "subs"), sum(prev, "subs")),
        series: cur.map((d) => d.subs),
      },
    };
  }, [daily, days]);

  // MRR = net Whop du mois courant vs mois précédent (mensuel par nature,
  // indépendant du sélecteur de période ci-dessus).
  const mrr = useMemo((): {
    value: number | null;
    delta: Delta | null;
    series: number[];
  } => {
    if (!revenue?.configured || revenue.periods.length === 0) {
      return { value: null, delta: null, series: [] };
    }
    const [cur, prev] = revenue.periods; // triées récent → ancien
    return {
      value: cur.net,
      delta: prev ? computeDelta(cur.net, prev.net) : null,
      series: [...revenue.periods].reverse().map((p) => p.net),
    };
  }, [revenue]);

  const hasProductData = daily.length > 0;

  // Funnel : dimension globale ou segment choisi (le plus gros par défaut).
  const funnelPayload =
    dimension === "global"
      ? analytics.funnels.global
      : dimension === "source"
        ? analytics.funnels.source
        : analytics.funnels.language;
  const activeSegment =
    funnelPayload.segments.find((s) => s.key === segment) ??
    funnelPayload.segments[0];
  const funnelSteps = activeSegment ? buildFunnel(
    activeSegment.steps.map((s) => ({
      key: s.key,
      label: FUNNEL_LABELS[s.key] ?? s.key,
      count: s.count,
    })),
  ) : [];

  const paywallRows = computeConversion(
    analytics.paywall.rows.map((r) => ({
      key: r.key,
      label: r.key,
      n: r.n,
      converted: r.converted,
    })),
  );
  const sourceRows = computeConversion(
    analytics.sources.rows.map((r) => ({
      key: r.key,
      label: r.key,
      n: r.n,
      converted: r.converted,
    })),
  );
  const sourceBaseline = overallRate(
    analytics.sources.rows.map((r) => ({
      key: r.key,
      label: r.key,
      n: r.n,
      converted: r.converted,
    })),
  );

  return (
    <div className="space-y-6">
      {/* ─── KPI ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Indicateurs clés
        </h2>
        <Segmented options={[...PERIODS]} value={period} onChange={setPeriod} />
      </div>
      {hasProductData ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Visiteurs"
            value={formatNumber(kpis.visitors.value)}
            delta={kpis.visitors.delta}
            series={kpis.visitors.series}
            hint="Somme des visiteurs uniques par jour"
          />
          <KpiTile
            label="Inscriptions"
            value={formatNumber(kpis.signups.value)}
            delta={kpis.signups.delta}
            series={kpis.signups.series}
          />
          <KpiTile
            label="Abonnements"
            value={formatNumber(kpis.subs.value)}
            delta={kpis.subs.delta}
            series={kpis.subs.series}
          />
          <KpiTile
            label="MRR (net Whop, mois courant)"
            value={mrr.value === null ? "—" : formatMoney(mrr.value)}
            delta={mrr.delta}
            series={mrr.series}
            hint={
              revenue?.configured
                ? "Net encaissé du mois, après frais et remboursements"
                : "Whop non configuré sur ce projet"
            }
          />
        </div>
      ) : (
        <AwaitingEvents what="ses premiers événements de navigation et d'inscription" />
      )}

      {/* ─── Funnel ──────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <HubCardHeader
            title="Funnel principal"
            subtitle="Atteinte d'étape (personnes distinctes), pas un funnel séquentiel strict : une étape peut être court-circuitée."
            action={
              <Segmented
                options={DIMENSIONS}
                value={dimension}
                onChange={(d) => {
                  setDimension(d);
                  setSegment(null);
                }}
              />
            }
          />
          {dimension !== "global" && funnelPayload.segments.length > 0 ? (
            <div className="flex flex-wrap gap-1 border-b border-slate-100 pb-3">
              {funnelPayload.segments.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSegment(s.key)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs transition-colors",
                    activeSegment?.key === s.key
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {s.key}
                </button>
              ))}
            </div>
          ) : null}
          {funnelSteps.length > 0 ? (
            <FunnelChart steps={funnelSteps} labels={FUNNEL_LABELS} />
          ) : (
            <AwaitingEvents
              compact
              what="les événements du parcours (visite → abonnement)"
            />
          )}
        </CardContent>
      </Card>

      {/* ─── Time-to-value ───────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <HubCardHeader
            title="Time-to-value"
            subtitle="Délais médians et p90 entre les jalons d'activation — l'insight que le funnel ne donne pas : une étape peut convertir et pourtant traîner."
          />
          {analytics.timeToValue.steps.some((s) => s.n > 0) ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {TTV_STEPS.map((def) => {
                const step = analytics.timeToValue.steps.find(
                  (s) => s.key === def.key,
                );
                const status = delayStatus(step?.medianMs ?? null, def.budgetMs);
                const tail = hasLongTail(
                  step?.medianMs ?? null,
                  step?.p90Ms ?? null,
                );
                return (
                  <div
                    key={def.key}
                    className={cn(
                      "space-y-1 rounded-lg border p-3",
                      status === "alert"
                        ? "border-red-200 bg-red-50/60"
                        : status === "warn"
                          ? "border-amber-200 bg-amber-50/60"
                          : "border-slate-200",
                    )}
                  >
                    <div className="text-xs font-medium text-slate-500">
                      {def.label}
                    </div>
                    <div className="text-xl font-bold tabular-nums text-slate-900">
                      {formatDuration(step?.medianMs ?? null)}
                    </div>
                    <div className="text-xs text-slate-500">
                      p90 {formatDuration(step?.p90Ms ?? null)}
                      {tail ? (
                        <span className="ml-1 text-amber-700">· queue longue</span>
                      ) : null}
                    </div>
                    {status === "alert" || status === "warn" ? (
                      <div
                        className={cn(
                          "text-xs font-medium",
                          status === "alert" ? "text-red-700" : "text-amber-700",
                        )}
                      >
                        {status === "alert" ? "Anormalement long" : "Plus lent qu'attendu"}
                        {" "}(cible {formatDuration(def.budgetMs)})
                      </div>
                    ) : null}
                    <SampleBadge
                      n={step?.n ?? 0}
                      conclusive={(step?.n ?? 0) >= 30}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <AwaitingEvents
              compact
              what="les jalons d'activation (inscription, 1re cible, 1re alerte)"
            />
          )}
        </CardContent>
      </Card>

      {/* ─── Paywall + sources ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Conversion par paywall"
              subtitle="Taux d'abonnement des personnes ayant vu chaque variante."
            />
            {paywallRows.length > 0 ? (
              <>
                <ConversionTable
                  rows={paywallRows}
                  labelHeader="Variante"
                  nHeader="Vus"
                  convertedHeader="Abonnés"
                />
                <CorrelationNote />
              </>
            ) : (
              <AwaitingEvents compact what="l'événement paywall_viewed (avec sa propriété variant)" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Sources → abonnés"
              subtitle="Inscrits, abonnés et taux de conversion par source d'acquisition."
            />
            {sourceRows.length > 0 ? (
              <>
                <ConversionTable
                  rows={sourceRows}
                  baseline={sourceBaseline}
                  labelHeader="Source"
                  nHeader="Inscrits"
                  convertedHeader="Abonnés"
                  showLift
                />
                <CorrelationNote />
              </>
            ) : (
              <AwaitingEvents compact what="la propriété utilisateur `source`" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
