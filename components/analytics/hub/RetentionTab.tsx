"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
 * Onglet RÉTENTION (churn). Deux états séparés : RÉSILIÉ (annulé, accès encore
 * valide) vs EXPIRÉ (accès perdu = vrai churn). La carte montre AUSSI ce qui ARRIVE
 * (pertes d'accès à venir + clients projetés), et pour chaque résiliation le DÉLAI
 * paiement→annulation : c'est lui qui distingue le bug (annulé en minutes, jamais
 * eu d'accès) du produit (annulé après avoir eu accès). L'accès applicatif exact par
 * personne n'est pas ingéré ici, donc on ne l'arbitre pas sur une date : on montre
 * le délai, qui est le fait.
 */

/** Sous ce nombre d'abonnements arrivés à échéance, aucun taux n'est interprétable. */
const SAMPLE_THRESHOLD = 10;
/** Horizon « perdront l'accès prochainement ». */
const HORIZON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Délai lisible depuis des ms : minutes si court, puis heures, puis jours. */
function formatDelay(ms: number | null): string {
  if (ms === null) return "—";
  const min = ms / 60000;
  if (min < 90) return `${Math.round(min)} min`;
  const h = ms / 3_600_000;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} j`;
}

/** Date courte « 4 août 11:49 ». */
function frDateTime(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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
        periodStartMs: now - ANALYSIS_WINDOW_DAYS * DAY_MS,
        webhookFixMs: WHOP_WEBHOOK_FIX_MS,
        horizonMs: HORIZON_DAYS * DAY_MS,
        sampleThreshold: SAMPLE_THRESHOLD,
      }),
    [churn.memberships, now],
  );

  const planName = useMemo(
    () => new Map(churn.planLabels.map((p) => [p.planId, p.name])),
    [churn.planLabels],
  );
  const planLabel = (planId: string) => planName.get(planId) ?? planId;

  // Projection LTV = net/paiement × nombre moyen de paiements (1 + renouvellements).
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
      {/* Avertissement — échantillon (premiers renouvellements ~2 août) */}
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

      {/* KPI : résiliations, expirations, taux, LTV */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Résiliations"
          value={dash(result.resiliations)}
          delta={null}
          hint="annulés, accès encore valide"
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

      {/* Ce qui ARRIVE — pertes d'accès à venir + clients projetés */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Ce qui arrive"
            subtitle={`Clients qui perdront l'accès dans les ${HORIZON_DAYS} prochains jours (résiliés dont la période se termine).`}
            info={EXPLAIN.churnAVenir}
          />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-3xl font-bold tabular-nums text-amber-600">
              {formatNumber(result.upcomingExpirations.length)}
            </span>
            <span className="text-sm text-slate-600">
              perte(s) d&apos;accès à venir · clients payants{" "}
              <strong className="tabular-nums">{formatNumber(result.clients)}</strong> →{" "}
              <strong className="tabular-nums text-amber-700">
                {formatNumber(result.projectedClients)}
              </strong>
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Ces personnes ont <strong>encore l&apos;accès</strong> jusqu&apos;à la date
            ci-dessous : elles sont <strong>récupérables</strong> tant que leur accès
            est valide.
          </p>
          {result.upcomingExpirations.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Abonnement</TableHead>
                  <TableHead>Offre</TableHead>
                  <TableHead className="text-right">Accès expire</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.upcomingExpirations.map((u) => (
                  <TableRow key={u.membershipId}>
                    <TableCell className="font-mono text-[11px] text-slate-500">
                      {u.membershipId}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {planLabel(u.planId)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-medium text-amber-700">
                      {frDateTime(u.accessEndsAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-xs text-slate-400">
              — aucune perte d&apos;accès prévue dans les {HORIZON_DAYS} prochains jours.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Délai avant résiliation */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Délai avant résiliation"
              subtitle="Entre le premier paiement et l'annulation. La métrique la plus parlante ici : toutes ces annulations précèdent le premier renouvellement."
              info={EXPLAIN.delaiResiliation}
            />
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    <ColLabel label="Médiane" info={EXPLAIN.delaiResiliation} />
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-semibold">
                    {formatDelay(result.medMsToCancel)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    <ColLabel label="9 sur 10 sous" info={EXPLAIN.delaiResiliation} />
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-semibold">
                    {formatDelay(result.p90MsToCancel)}
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

      {/* Résiliations en détail — le délai distingue le bug du produit */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Résiliations en détail"
            subtitle="Une annulation en quelques minutes n'a jamais eu d'accès (bug) ; une annulation après des heures ou des jours en a eu (produit)."
            info={EXPLAIN.churnDetail}
          />
          {result.resiliationDetails.length === 0 ? (
            <p className="text-xs text-slate-400">— aucune résiliation sur la période.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Abonnement</TableHead>
                    <TableHead>Offre</TableHead>
                    <TableHead className="text-right">Payé</TableHead>
                    <TableHead className="text-right">Annulé</TableHead>
                    <TableHead className="text-right">
                      <ColLabel label="Délai" info={EXPLAIN.churnDetail} />
                    </TableHead>
                    <TableHead className="text-right">Accès expire</TableHead>
                    <TableHead className="text-right">Indice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.resiliationDetails.map((d) => (
                    <TableRow key={d.membershipId}>
                      <TableCell className="font-mono text-[11px] text-slate-500">
                        {d.membershipId}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {planLabel(d.planId)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-slate-500">
                        {frDateTime(d.firstPaidAt)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-slate-500">
                        {frDateTime(d.canceledAt)}
                      </TableCell>
                      <TableCell
                        className={
                          d.delayMs !== null && d.delayMs < 90 * 60_000
                            ? "text-right text-xs tabular-nums font-semibold text-red-600"
                            : "text-right text-xs tabular-nums font-semibold"
                        }
                      >
                        {formatDelay(d.delayMs)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-slate-500">
                        {frDateTime(d.accessEndsAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {d.paidDuringOutage ? (
                          <Badge
                            variant="outline"
                            className="border-red-200 bg-red-50 text-[10px] text-red-700"
                          >
                            payé pendant la panne
                          </Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-xs text-slate-400">
            L&apos;accès applicatif exact par personne n&apos;est pas ingéré ici : le
            délai est le fait, et « payé pendant la panne » (paiement avant la
            réparation du webhook) n&apos;est qu&apos;un indice, pas une preuve.
          </p>
        </CardContent>
      </Card>

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
