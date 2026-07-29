"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { formatMoney, formatViews } from "@/lib/format-rate";
import { buildCoherenceChecks } from "@/lib/analytics-hub";
import { effectiveFxRate } from "@/lib/currency";
import {
  KpiTile,
  HubCardHeader,
  HubNotice,
  WebhookFixNotice,
  dash,
  pct,
} from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
import type { TrendPoint } from "./HubTrendChart";
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
 * choisie (série quotidienne PostHog, ancrée sur la date d'événement) et portent
 * une courbe LISIBLE (survol daté). La table « Détail par jour » donne la lecture
 * du matin : une ligne par jour, les chiffres clés côte à côte.
 */

function stepCount(steps: { key: string; count: number }[], key: string): number | null {
  const s = steps.find((x) => x.key === key);
  return s ? s.count : null;
}

/** Jour « métier » Europe/Paris d'un timestamp (ms) → "YYYY-MM-DD" (join du net Whop). */
function parisDay(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
    new Date(ts),
  );
}

/** "YYYY-MM-DD" → "28 juil." (midi local, pas de décalage de fuseau). */
function frDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
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

  const visitorsPts: TrendPoint[] = daily.map((d) => ({ ts: d.ts, value: d.visitors }));
  const signupsPts: TrendPoint[] = daily.map((d) => ({ ts: d.ts, value: d.signups }));
  const subsPts: TrendPoint[] = daily.map((d) => ({ ts: d.ts, value: d.subs }));

  // Deux devises : le REVENU Whop (€, currency de la donnée) et la PAIE créatrices
  // ($, payCurrency). Jamais l'une pour l'autre.
  const currency = revenue?.currency ?? undefined; // revenu (€)
  const payCurrency = attribution?.payCurrency ?? undefined; // coût créateurs ($)
  // Taux paie→revenu pour la marge (croise coût $ et revenu €) ; null → non calculée.
  const fx = effectiveFxRate(
    attribution?.payCurrency,
    revenue?.currency,
    attribution?.fxRateToRevenue,
  );

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
      dailyClientsSum: c.dailyClientsSum,
      dailySignupsSum: c.dailySignupsSum,
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
      ? "ancré sur le paiement Whop"
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
  // Marge % = (revenu − coût converti) / revenu. Coût ($) converti vers le revenu
  // (€) via le taux ; sans taux (fx null), pas de marge (jamais mélanger deux devises).
  const margin =
    revenue?.ltv != null && cac !== null && revenue.ltv > 0 && fx !== null
      ? Math.round(((revenue.ltv - cac * fx) / revenue.ltv) * 1000) / 10
      : null;

  // Table « Détail par jour » : net Whop joint par jour Europe/Paris, plus récent d'abord.
  const netByDay = useMemo(
    () => new Map((revenue?.dailyNet ?? []).map((d) => [d.day, d.net])),
    [revenue],
  );
  const dailyRows = useMemo(() => [...daily].reverse(), [daily]);

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
              points={subsPts}
              hint={clientsHint}
              info={EXPLAIN.clientsPayants}
            />
            <KpiTile
              label="Revenu net encaissé"
              value={totalNet === null ? "—" : formatMoney(totalNet, currency)}
              delta={null}
              hint={
                revenue?.feeRate != null
                  ? `frais ${formatNumber(Math.round(revenue.feeRate * 1000) / 10)} % · cumulé`
                  : "cumulé · ancré sur le paiement"
              }
              info={EXPLAIN.revenuNet}
            />
          </>
        )}
        <KpiTile
          label="Vues promo → abonné"
          value={viewsPerClient === null ? "—" : `1 / ${formatViews(viewsPerClient)}`}
          delta={null}
          hint="métrique de pilotage · vues à la publication"
          info={EXPLAIN.vuesPromoClient}
        />
        <KpiTile
          label="Coût d'acquisition"
          value={cac === null ? "—" : formatMoney(cac, payCurrency)}
          delta={null}
          hint={margin !== null ? `marge ${formatNumber(margin)} %` : "jours solo uniquement"}
          info={EXPLAIN.cac}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Complétion checkout"
          value={pct(completion)}
          delta={null}
          hint={
            checkoutN !== null && paidN !== null
              ? `${formatNumber(paidN)} / ${formatNumber(checkoutN)} checkouts`
              : "—"
          }
          info={EXPLAIN.completionCheckout}
        />
        <KpiTile
          label="Visiteurs (période)"
          value={dash(daily.reduce((s, d) => s + d.visitors, 0))}
          delta={null}
          points={visitorsPts}
          hint="ancré sur l'événement"
          info={EXPLAIN.visiteurs}
        />
        <KpiTile
          label="Inscrits (période)"
          value={dash(daily.reduce((s, d) => s + d.signups, 0))}
          delta={null}
          points={signupsPts}
          hint="ancré sur l'inscription"
          info={EXPLAIN.inscrits}
        />
        <KpiTile
          label="Comptes internes exclus"
          value={dash(reliability?.internalExcluded.persons ?? null)}
          delta={null}
          hint={
            reliability
              ? `PostHog · ${dash(reliability.whopInternalExcluded)} côté Whop`
              : "—"
          }
          info={EXPLAIN.comptesInternes}
        />
      </div>

      {/* Détail par jour — la lecture du matin. */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Détail par jour"
            subtitle="Une ligne par jour, du plus récent au plus ancien. Le pic du 27/07 saute aux yeux ici."
            info={EXPLAIN.detailParJour}
          />
          {dailyRows.length === 0 ? (
            <p className="text-sm text-slate-400">
              — en attente de la synchro PostHog.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Jour</TableHead>
                    <TableHead className="text-right">Visiteurs</TableHead>
                    <TableHead className="text-right">Inscriptions</TableHead>
                    <TableHead className="text-right">Checkouts ouverts</TableHead>
                    <TableHead className="text-right">Paiements</TableHead>
                    <TableHead className="text-right">Revenu net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailyRows.map((d) => {
                    const net = netByDay.get(parisDay(d.ts));
                    return (
                      <TableRow key={d.ts}>
                        <TableCell className="text-xs tabular-nums text-slate-600">
                          {frDay(parisDay(d.ts))}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(d.visitors)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(d.signups)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(d.checkouts)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(d.subs)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums font-medium">
                          {net === undefined ? "—" : formatMoney(net, currency)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
