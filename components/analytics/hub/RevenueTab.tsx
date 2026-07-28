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
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { formatMoney } from "@/lib/format-rate";
import { computeDelta, computeUnitEconomics } from "@/lib/analytics-hub";
import {
  AwaitingEvents,
  DeltaBadge,
  HubCardHeader,
  HubEmptyState,
  HubNotice,
  dash,
} from "./HubPrimitives";
import { CreditCardIcon } from "lucide-react";
import type { AttributionData, RevenueData } from "./types";

/**
 * Onglet REVENUS — bâti sur le NET Whop DÉJÀ INGÉRÉ (aucune nouvelle source).
 *
 * Limite structurelle assumée : whopPayments ne porte aucun cycle de vie
 * d'abonnement (pas d'annulation, pas d'intervalle de plan). Le CHURN n'est donc
 * pas dérivable et ses cartes attendent l'event `subscription_cancelled`. Le
 * partage nouveau/récurrent s'appuie sur le premier paiement observé par
 * membership — approximation explicitement affichée.
 */
export function RevenueTab({
  revenue,
  attribution,
}: {
  revenue: RevenueData;
  attribution: AttributionData | undefined;
}) {
  // CAC sur la base des JOURS SOLO (A3, attribution certaine) : coût ET abonnés
  // appariés sur la MÊME base — les vidéos publiées un jour solo pour le coût, les
  // clients de ces mêmes jours solo pour les abonnés. Fini la fenêtre 24 h qui
  // dupliquait les inscriptions sur toutes les créatrices d'un même jour.
  const unit = useMemo(() => {
    const rows = attribution?.rows ?? [];
    const soloDays = attribution?.soloDays ?? [];
    const soloDaySet = new Set(
      soloDays.filter((d) => d.isSolo).map((d) => d.day),
    );
    const creatorCost = rows
      .filter((r) => soloDaySet.has(r.day))
      .reduce((s, r) => s + (r.cost ?? 0), 0);
    const attributedDays = soloDays.filter(
      (d) => d.isSolo && d.attribution && d.attribution.clients !== null,
    );
    const hasSubs = attributedDays.length > 0;
    const attributedSubs = attributedDays.reduce(
      (s, d) => s + (d.attribution?.clients ?? 0),
      0,
    );
    return {
      creatorCost,
      attributedSubs,
      hasSubs,
      metrics: computeUnitEconomics({
        creatorCost,
        attributedSubs,
        ltv: revenue.ltv,
        monthlyArpu: revenue.monthlyArpu,
      }),
    };
  }, [attribution, revenue.ltv, revenue.monthlyArpu]);

  if (!revenue.configured) {
    return (
      <HubEmptyState
        icon={CreditCardIcon}
        title="Whop n'est pas configuré sur ce projet"
        description="Le volet Revenus s'appuie sur le revenu net Whop déjà ingéré. Configure le mapping projet ↔ compte Whop pour l'alimenter — les autres onglets fonctionnent sans."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── MRR décomposé ───────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Revenu net par période"
            subtitle="Net encaissé Whop (après frais et remboursements), décomposé entre nouveaux membres et récurrents."
          />
          {revenue.periods.length === 0 ? (
            <AwaitingEvents compact what="les premiers paiements Whop" />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mois</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Évolution</TableHead>
                    <TableHead className="text-right">Nouveau</TableHead>
                    <TableHead className="text-right">Récurrent</TableHead>
                    <TableHead className="text-right">Membres</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revenue.periods.map((p, i) => {
                    const prev = revenue.periods[i + 1];
                    return (
                      <TableRow key={p.period}>
                        <TableCell className="text-xs font-medium text-slate-700">
                          {p.period}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold tabular-nums">
                          {formatMoney(p.net)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DeltaBadge
                            delta={prev ? computeDelta(p.net, prev.net) : null}
                          />
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-emerald-700">
                          {formatMoney(p.newNet)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-600">
                          {formatMoney(p.returningNet)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(p.members)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <HubNotice>
                <strong>Pas de churn dans ce tableau.</strong> Les paiements Whop
                ne portent aucun cycle de vie d&apos;abonnement (ni annulation, ni
                intervalle de plan) : le MRR perdu n&apos;est pas calculable depuis
                cette source. « Nouveau » = premier paiement observé pour un
                membership, borné à l&apos;historique importé.
              </HubNotice>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── Churn par plan (en attente d'events) ────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Churn par plan"
            subtitle="Actifs, taux de churn 30 j et durée de vie moyenne par offre."
          />
          <AwaitingEvents
            compact
            what="les événements `subscription_completed` et `subscription_cancelled` (avec leur propriété `plan`)"
          />
          <p className="text-xs text-slate-400">
            La cadence d&apos;une offre (hebdomadaire / mensuelle) n&apos;est pas
            stockée côté paiements : elle viendra de la propriété `plan` des
            événements. En attendant, la LTV réalisée par offre ci-dessous est
            calculable, le churn non.
          </p>
        </CardContent>
      </Card>

      {/* ─── LTV réalisée par offre ──────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="LTV réalisée par offre"
            subtitle="Net cumulé rapporté au nombre de membres. Constatée, jamais projetée : sans signal de churn, une LTV prédictive serait inventée."
          />
          {revenue.plans.length === 0 ? (
            <AwaitingEvents compact what="des paiements rattachés à une offre" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Offre</TableHead>
                  <TableHead className="text-right">Membres</TableHead>
                  <TableHead className="text-right">Net cumulé</TableHead>
                  <TableHead className="text-right">LTV réalisée</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenue.plans.map((p) => (
                  <TableRow key={p.planId}>
                    <TableCell className="font-mono text-xs text-slate-700">
                      {p.planId}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(p.members)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatMoney(p.netTotal)}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold tabular-nums">
                      {dash(p.ltv, formatMoney)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ─── Économie unitaire ───────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Économie unitaire"
            subtitle="CAC = coût créateurs réel ÷ abonnés attribués, sur les jours solo uniquement (attribution certaine)."
          />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <UnitTile
              label="CAC"
              value={dash(unit.metrics.cac, formatMoney)}
              hint={
                unit.hasSubs
                  ? `${formatMoney(unit.creatorCost)} ÷ ${formatNumber(unit.attributedSubs)} abonnés`
                  : "En attente des abonnés attribués"
              }
            />
            <UnitTile
              label="LTV réalisée"
              value={dash(unit.metrics.ltv, formatMoney)}
              hint="Net cumulé / membre"
            />
            <UnitTile
              label="LTV / CAC"
              value={unit.metrics.ltvCacRatio === null ? "—" : `×${unit.metrics.ltvCacRatio}`}
              hint="≥ 3 = économie saine"
              emphasis={
                unit.metrics.ltvCacRatio !== null && unit.metrics.ltvCacRatio >= 3
              }
            />
            <UnitTile
              label="Délai de récupération"
              value={
                unit.metrics.paybackMonths === null
                  ? "—"
                  : `${unit.metrics.paybackMonths} mois`
              }
              hint="CAC / revenu net mensuel par membre"
            />
          </div>
          {!unit.hasSubs ? (
            <HubNotice className="border-slate-200 bg-slate-50 text-slate-600">
              Le coût créateurs est déjà réel ({formatMoney(unit.creatorCost)}),
              mais le CAC attend les abonnés attribués : il se calculera dès que
              PostHog émettra `subscription_completed`.
            </HubNotice>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function UnitTile({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <div className="space-y-1 rounded-lg border border-slate-200 p-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div
        className={cn(
          "text-xl font-bold tabular-nums",
          emphasis ? "text-primary" : "text-slate-900",
        )}
      >
        {value}
      </div>
      <div className="text-xs text-slate-400">{hint}</div>
    </div>
  );
}
