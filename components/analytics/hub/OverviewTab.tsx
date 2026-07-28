"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { formatMoney, formatViews } from "@/lib/format-rate";
import { buildCoherenceChecks } from "@/lib/analytics-hub";
import { KpiTile, HubNotice, WebhookFixNotice, dash, pct } from "./HubPrimitives";
import type {
  ProductAnalyticsData,
  RevenueData,
  ReliabilityData,
  AttributionData,
  ViewCountersData,
} from "./types";

/**
 * Onglet VUE D'ENSEMBLE — les KPI de pilotage, un bandeau d'alerte tiré des
 * contrôles de cohérence, et le garde-fou C2 : si l'écart dashboard/Whop dépasse
 * 5 %, un bandeau REMPLACE les chiffres (un chiffre faux est pire qu'absent).
 *
 * Les KPI de conversion (visiteurs / inscrits / clients) suivent la période
 * choisie (série quotidienne PostHog, ancrée sur la date d'événement). Le revenu
 * et les ratios cumulés portent leur propre ancrage — indiqué en légende.
 */

function stepCount(steps: { key: string; count: number }[], key: string): number | null {
  const s = steps.find((x) => x.key === key);
  return s ? s.count : null;
}

export function OverviewTab({
  analytics,
  revenue,
  reliability,
  attribution,
  viewCounters,
  periodDays,
  now,
}: {
  analytics: ProductAnalyticsData;
  revenue: RevenueData | undefined;
  reliability: ReliabilityData | undefined;
  attribution: AttributionData | undefined;
  viewCounters: ViewCountersData | undefined;
  periodDays: number;
  now: number;
}) {
  // Fenêtre : les N derniers jours de la série quotidienne.
  const daily = useMemo(() => {
    const all = [...analytics.overview.daily].sort((a, b) => a.ts - b.ts);
    return all.slice(Math.max(0, all.length - periodDays));
  }, [analytics.overview.daily, periodDays]);

  const subsSeries = daily.map((d) => d.subs);

  // Garde-fou C2 : écart dashboard vs Whop.
  const checks = useMemo(() => {
    const c = reliability?.coherence;
    if (!c) return [];
    return buildCoherenceChecks({
      sequentialSteps: c.sequentialSteps.map((s) => ({ key: s.key, label: s.key, count: s.count })),
      reachSteps: c.reachSteps.map((s) => ({ key: s.key, label: s.key, count: s.count })),
      currencyCount: c.currencyCount,
      dashboardClients: c.dashboardClients,
      whopMembers: c.whopMembers,
      whopExcludedPre: c.whopExcludedPre,
      whopExcludedAfter: c.whopExcludedAfter,
    });
  }, [reliability]);

  // Écart client comparable (base du garde-fou) + libellé discret toujours visible.
  const coh = reliability?.coherence;
  const clientEcart =
    coh && coh.dashboardClients !== null && coh.whopMembers !== null
      ? Math.abs(coh.dashboardClients - coh.whopMembers)
      : null;
  const clientsHint =
    coh?.whopMembersTotal == null || clientEcart === null
      ? "ancré sur le paiement"
      : clientEcart === 0
        ? "aligné avec le dashboard"
        : `écart de ${clientEcart} avec le dashboard${
            coh.whopExcludedPre > 0
              ? ` · ${coh.whopExcludedPre} antérieur(s) à l'instrumentation`
              : ""
          }`;
  const dashboardWhopViolation = checks.some(
    (c) => c.key === "dashboard_vs_whop" && c.status === "violation",
  );
  const violations = checks.filter((c) => c.status === "violation");

  // CAC (coût pour gagner un client) sur les JOURS SOLO — coût et clients appariés.
  const cac = useMemo(() => {
    const rows = attribution?.rows ?? [];
    const soloDays = attribution?.soloDays ?? [];
    const soloSet = new Set(soloDays.filter((d) => d.isSolo).map((d) => d.day));
    const cost = rows
      .filter((r) => soloSet.has(r.day))
      .reduce((s, r) => s + (r.cost ?? 0), 0);
    const clients = soloDays
      .filter((d) => d.isSolo && d.attribution && d.attribution.clients !== null)
      .reduce((s, d) => s + (d.attribution?.clients ?? 0), 0);
    return clients > 0 ? Math.round((cost / clients) * 100) / 100 : null;
  }, [attribution]);

  const seq = analytics.funnels.sequential.segments[0]?.steps ?? [];
  const checkoutN = stepCount(seq, "checkout_started");
  const paidN = stepCount(seq, "subscription_completed");
  const completion =
    checkoutN !== null && checkoutN > 0 && paidN !== null
      ? Math.round((paidN / checkoutN) * 1000) / 10
      : null;

  const totalNet = revenue?.configured
    ? Math.round(revenue.periods.reduce((s, p) => s + p.net, 0) * 100) / 100
    : null;
  const totalClients = reliability?.coherence.dashboardClients ?? null;
  const viewsPerClient =
    viewCounters && totalClients !== null && totalClients > 0
      ? Math.round(viewCounters.promo / totalClients)
      : null;
  const margin =
    revenue?.ltv != null && cac !== null && revenue.ltv > 0
      ? Math.round(((revenue.ltv - cac) / revenue.ltv) * 1000) / 10
      : null;

  return (
    <div className="space-y-5">
      <WebhookFixNotice now={now} />
      {violations.length > 0 ? (
        <HubNotice className="border-red-200 bg-red-50/70 text-red-900">
          <strong>
            {violations.length} contrôle{violations.length > 1 ? "s" : ""} de
            cohérence en écart.
          </strong>{" "}
          {violations.map((v) => v.label).join(" · ")}. Voir l&apos;onglet Fiabilité.
        </HubNotice>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dashboardWhopViolation ? (
          <Card className="sm:col-span-2">
            <CardContent className="flex h-full items-center p-4">
              <HubNotice className="border-red-200 bg-red-50/70 text-red-900">
                <strong>Clients payants — chiffres suspendus.</strong> L&apos;écart
                dashboard/Whop dépasse À LA FOIS 5 % ET 5 clients. Un chiffre faux est
                pire qu&apos;un chiffre absent : on affiche le contrôle, pas le nombre.
              </HubNotice>
            </CardContent>
          </Card>
        ) : (
          <>
            <KpiTile
              label="Clients payants"
              value={dash(coh?.whopMembersTotal ?? null)}
              delta={null}
              series={subsSeries}
              hint={clientsHint}
            />
            <KpiTile
              label="Revenu net encaissé"
              value={dash(totalNet, formatMoney)}
              delta={null}
              series={[]}
              hint={
                revenue?.feeRate != null
                  ? `frais ${formatNumber(Math.round(revenue.feeRate * 1000) / 10)} % · cumulé`
                  : "cumulé · ancré sur le paiement"
              }
            />
          </>
        )}
        <KpiTile
          label="Vues promo → client"
          value={viewsPerClient === null ? "—" : `1 / ${formatViews(viewsPerClient)}`}
          delta={null}
          series={[]}
          hint="métrique de pilotage · vues à la publication"
        />
        <KpiTile
          label="Coût pour gagner un client"
          value={dash(cac, formatMoney)}
          delta={null}
          series={[]}
          hint={margin !== null ? `marge ${formatNumber(margin)} %` : "jours solo uniquement"}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Complétion checkout"
          value={pct(completion)}
          delta={null}
          series={[]}
          hint={
            checkoutN !== null && paidN !== null
              ? `${formatNumber(paidN)} / ${formatNumber(checkoutN)} checkouts`
              : "—"
          }
        />
        <KpiTile
          label="Visiteurs (période)"
          value={dash(daily.reduce((s, d) => s + d.visitors, 0))}
          delta={null}
          series={daily.map((d) => d.visitors)}
          hint="ancré sur l'événement"
        />
        <KpiTile
          label="Inscrits (période)"
          value={dash(daily.reduce((s, d) => s + d.signups, 0))}
          delta={null}
          series={daily.map((d) => d.signups)}
          hint="ancré sur l'inscription"
        />
        <KpiTile
          label="Comptes internes exclus"
          value={dash(reliability?.internalExcluded.persons ?? null)}
          delta={null}
          series={[]}
          hint={
            reliability
              ? `sur ${formatNumber(reliability.internalExcluded.totalPersons)} personnes`
              : "—"
          }
        />
      </div>
    </div>
  );
}
