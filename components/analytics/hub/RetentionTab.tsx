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
import { formatMoney } from "@/lib/format-rate";
import { computeChurn } from "@/lib/churn";
import {
  HubCardHeader,
  HubNotice,
  HubEmptyState,
  ColLabel,
  KpiTile,
  dash,
  pct,
  WHOP_WEBHOOK_FIX_MS,
  ANALYSIS_WINDOW_DAYS,
} from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
import { UsersIcon } from "lucide-react";
import type { ChurnData } from "./types";

/**
 * Onglet RÉTENTION (churn) — la métrique sans laquelle aucune projection de revenu
 * ne tient. Deux états séparés : RÉSILIÉ (annulé, accès encore valide) vs EXPIRÉ
 * (accès perdu = vrai churn). Source = l'état des memberships Whop (fait foi), le
 * calcul est fait ici par lib/churn (pur). Deux avertissements obligatoires :
 * échantillon quasi nul avant les premiers renouvellements (~2 août), et les
 * résiliations dues à la panne du webhook (bug, pas produit).
 */

/** Sous ce nombre d'abonnements arrivés à échéance, aucun taux n'est interprétable. */
const SAMPLE_THRESHOLD = 10;

/** Jours (ms) → durée lisible courte (j / mois). */
function formatDays(d: number | null): string {
  if (d === null) return "—";
  if (d < 1) return `${Math.round(d * 24)} h`;
  if (d < 60) return `${Math.round(d * 10) / 10} j`;
  return `${Math.round((d / 30) * 10) / 10} mois`;
}

export function RetentionTab({
  churn,
  now,
}: {
  churn: ChurnData;
  now: number;
}) {
  const result = useMemo(
    () =>
      computeChurn(churn.memberships, {
        now,
        periodStartMs: now - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        webhookFixMs: WHOP_WEBHOOK_FIX_MS,
        sampleThreshold: SAMPLE_THRESHOLD,
      }),
    [churn.memberships, now],
  );

  const planName = useMemo(
    () => new Map(churn.planLabels.map((p) => [p.planId, p.name])),
    [churn.planLabels],
  );
  const planLabel = (planId: string) =>
    planName.get(planId) ?? planId;

  // Projection LTV = net/paiement × nombre moyen de paiements (1 + renouvellements).
  // Tiret tant que l'échantillon de renouvellements est insuffisant.
  const ltv =
    result.sampleSufficient &&
    churn.netPerPayment !== null &&
    result.avgRenewals !== null
      ? Math.round(churn.netPerPayment * (1 + result.avgRenewals) * 100) / 100
      : null;

  if (!churn.configured) {
    return (
      <HubEmptyState
        icon={UsersIcon}
        title="Whop non configuré"
        description="Le churn vient de l'état des abonnements Whop. Reliez le projet à son compte Whop pour l'alimenter."
      />
    );
  }

  if (churn.memberships.length === 0) {
    return (
      <HubEmptyState
        icon={UsersIcon}
        title="En attente des abonnements Whop"
        description="Aucun abonnement n'a encore été synchronisé depuis Whop. La carte s'alimentera dès la première synchro des memberships (cron horaire ou Actualiser)."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Avertissement 1 — échantillon (premiers renouvellements ~2 août) */}
      {!result.sampleSufficient ? (
        <HubNotice>
          <strong>Échantillon insuffisant pour les taux de renouvellement.</strong>{" "}
          Les premiers renouvellements hebdomadaires tombent vers le 2 août :{" "}
          <strong>{formatNumber(result.reachedTerm)}</strong> abonnement(s) sont
          réellement arrivés à échéance, sous le seuil de {SAMPLE_THRESHOLD}. Le taux
          de renouvellement et la projection restent non interprétables tant qu&apos;on
          n&apos;a pas assez d&apos;abonnements arrivés au bout d&apos;une période.
        </HubNotice>
      ) : null}

      {/* Avertissement 2 — résiliations dues à la panne du webhook (bug) */}
      {result.bugAttributed > 0 ? (
        <HubNotice className="border-red-200 bg-red-50/70 text-red-900">
          <strong>
            {formatNumber(result.bugAttributed)} résiliation(s) dues à un bug, pas au
            produit.
          </strong>{" "}
          Elles sont survenues pendant la panne du webhook (avant le 28/07 au soir),
          quand un paiement n&apos;accordait aucun accès automatiquement (l&apos;une
          trois minutes après le paiement, l&apos;app ne montrait rien). Elles sont
          comptées ci-dessous mais signalées à part pour ne pas polluer la lecture.
        </HubNotice>
      ) : null}

      {/* KPI : résiliations, expirations, taux de résiliation */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Résiliations"
          value={dash(result.resiliations)}
          delta={null}
          hint={
            result.bugAttributed > 0
              ? `dont ${formatNumber(result.bugAttributed)} dues au bug webhook`
              : "annulés, accès encore valide"
          }
          info={EXPLAIN.churnResilieExpire}
        />
        <KpiTile
          label="Expirations"
          value={dash(result.expirations)}
          delta={null}
          hint="accès perdu · vrai churn"
          info={EXPLAIN.churnResilieExpire}
        />
        <KpiTile
          label="Taux de résiliation"
          value={pct(result.cancelRate)}
          delta={null}
          hint={`${formatNumber(result.resiliations)} / ${formatNumber(result.clients)} clients`}
          info={EXPLAIN.tauxResiliation}
        />
        <KpiTile
          label="Renouvellement client (LTV)"
          value={ltv === null ? "—" : formatMoney(ltv, churn.currency)}
          delta={null}
          hint={
            ltv === null
              ? "échantillon insuffisant"
              : `net/paiement × ${formatNumber(Math.round((1 + (result.avgRenewals ?? 0)) * 100) / 100)} paiements`
          }
          info={EXPLAIN.projectionLtv}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Délai avant résiliation */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Délai avant résiliation"
              subtitle="Entre le premier paiement et l'annulation, chez ceux qui ont annulé."
              info={EXPLAIN.delaiResiliation}
            />
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    <ColLabel label="Médiane" info={EXPLAIN.delaiResiliation} />
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-semibold">
                    {formatDays(result.medDaysToCancel)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    <ColLabel label="9 sur 10 sous" info={EXPLAIN.delaiResiliation} />
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-semibold">
                    {formatDays(result.p90DaysToCancel)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {result.resiliations === 0 ? (
              <p className="text-xs text-slate-400">
                — aucune résiliation sur la période.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Renouvellement */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Renouvellement"
              subtitle="Parmi les abonnements arrivés à échéance, combien ont repayé."
              info={EXPLAIN.tauxRenouvellement}
            />
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    Arrivés à échéance
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-semibold">
                    {formatNumber(result.reachedTerm)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">Renouvelés</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatNumber(result.renewed)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    Taux de renouvellement
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-semibold">
                    {result.sampleSufficient ? pct(result.renewalRate) : "—"}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {!result.sampleSufficient ? (
              <p className="text-xs text-amber-700">
                Échantillon insuffisant ({formatNumber(result.reachedTerm)} sous{" "}
                {SAMPLE_THRESHOLD}) : taux non interprétable.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Résiliations par offre */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Résiliations par offre"
            subtitle="Pour voir si un prix retient mieux qu'un autre."
            info={EXPLAIN.churnParOffre}
          />
          {result.byPlan.length === 0 ? (
            <p className="text-xs text-slate-400">— aucun abonnement.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Offre</TableHead>
                  <TableHead className="text-right">Clients</TableHead>
                  <TableHead className="text-right">Résiliations</TableHead>
                  <TableHead className="text-right">Expirations</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.byPlan.map((p) => (
                  <TableRow key={p.planId}>
                    <TableCell className="text-xs font-medium text-slate-700">
                      {planLabel(p.planId)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(p.clients)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(p.resiliations)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(p.expirations)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
