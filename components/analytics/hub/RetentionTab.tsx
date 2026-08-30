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
import { toDisplayAmount, conversionNote } from "@/lib/currency-display";
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
import type { ChurnData, AttributionData } from "./types";

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
  attribution,
  now,
}: {
  churn: ChurnData;
  attribution: AttributionData | undefined;
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

  // L'ANCIENNE projection (net/paiement × moyenne de cycles) est SUPPRIMÉE : elle
  // comptait les abonnements encore en cours comme des clients à un seul cycle,
  // ce qui écrasait la durée de vie — mesurer une espérance de vie sur une
  // population encore vivante. Remplacée par les trois chiffres nommés plus bas
  // (revenu à ce jour, projection dérivée du TAUX, cohortes).

  // Renouvellements — Whop SEUL fait foi (billing_reason + état des abonnements).
  const renewals = churn.configured ? churn.renewals : null;

  /**
   * Sous ce nombre d'échéances TRANCHÉES, aucun taux n'est interprétable et la
   * projection qui en dérive encore moins.
   */
  const MIN_RESOLVED_DUE = 10;
  /** Sous cet effectif, une cohorte n'est pas une tendance mais une anecdote. */
  const COHORT_MIN_CLIENTS = 5;
  const concluant =
    renewals !== null && renewals.resolvedDueCount >= MIN_RESOLVED_DUE;
  /** Cohortes mûres = la majorité des clients a atteint au moins une échéance. */
  const cohortsMature =
    renewals !== null && renewals.matureShare !== null && renewals.matureShare >= 0.5;

  // Projection : dérivée du TAUX (1/(1−t)), pas d'une moyenne de cycles que les
  // abonnements jeunes écrasent. À 100 % la formule diverge — un taux sans échec
  // observé ne vaut pas « valeur infinie », on affiche la borne basse à la place.
  const projectedLabel = !renewals
    ? "—"
    : !concluant
      ? "non concluant"
      : renewals.projectedPerClientResolved !== null
        ? formatMoney(renewals.projectedPerClientResolved, churn.currency)
        : renewals.projectedPerClientWorstCase !== null
          ? `≥ ${formatMoney(renewals.projectedPerClientWorstCase, churn.currency)}`
          : "—";
  const projectedHint = !renewals
    ? ""
    : !concluant
      ? `${formatNumber(renewals.resolvedDueCount)} échéance(s) tranchée(s), seuil ${MIN_RESOLVED_DUE}`
      : renewals.projectedPerClientResolved !== null
        ? `taux ${pct(renewals.renewalRateResolved)} · ${formatNumber(renewals.resolvedDueCount)} échéances observées`
        : `taux ${pct(renewals.renewalRateResolved)} — 1/(1−t) diverge, borne basse affichée`;

  // Coût d'acquisition : MÊME dénominateur que le revenu par client (les clients
  // payants Whop), et converti dans la devise du revenu — le comparer brut
  // reviendrait à opposer des dollars à des euros.
  const acqCostPayCur =
    attribution?.costs.promo != null && attribution.costs.promoBonus != null && renewals
      ? renewals.payingMembers > 0
        ? Math.round(
            ((attribution.costs.promo + attribution.costs.promoBonus) /
              renewals.payingMembers) *
              100,
          ) / 100
        : null
      : null;
  // Passage par le module partagé (cf ConvertedAmount) plutôt qu'une
  // multiplication locale. Deux raisons : un seul site du hub formate un montant
  // de paie, et surtout ce calcul lisait `fxRateToRevenue` BRUT — si paie et
  // revenu venaient à partager la même devise, il aurait appliqué le taux du
  // projet au lieu de 1. `effectiveFxRate`, derrière le module, tranche ce cas.
  const acqCost = toDisplayAmount(acqCostPayCur, {
    payCurrency: attribution?.payCurrency,
    revenueCurrency: churn?.currency,
    fxRateToRevenue: attribution?.fxRateToRevenue,
  });
  const acqCostRevCur = acqCost !== null && acqCost.converted ? acqCost.value : null;
  const ratioOf = (v: number | null | undefined): number | null =>
    v != null && acqCostRevCur !== null && acqCostRevCur > 0
      ? Math.round((v / acqCostRevCur) * 100) / 100
      : null;
  const ratioToDate = ratioOf(renewals?.revenueToDatePerClient);
  const ratioWorst = ratioOf(renewals?.projectedPerClientWorstCase);

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

      {/* KPI churn : résiliations, expirations, taux */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
      </div>

      {/* RENOUVELLEMENTS — la métrique qui décide si le moteur est viable */}
      {renewals ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label="Revenu à ce jour par client"
              value={
                renewals.revenueToDatePerClient === null
                  ? "—"
                  : formatMoney(renewals.revenueToDatePerClient, churn.currency)
              }
              delta={null}
              hint={
                renewals.securedCurrencies.length > 1
                  ? `devises mélangées (${renewals.securedCurrencies.join(", ")}) — aucun ratio calculable`
                  : `${formatMoney(renewals.netTotal, churn.currency)} encaissés / ${formatNumber(renewals.securedMembers)} clients au net sécurisé${
                      renewals.atRiskOnlyMembers > 0
                        ? ` · ${formatNumber(renewals.atRiskOnlyMembers)} client(s) hors ratio (argent en litige)`
                        : ""
                    }`
              }
            />
            <KpiTile
              label="Revenu projeté par client"
              value={projectedLabel}
              delta={null}
              hint={projectedHint}
            />
            <KpiTile
              label="Revenu de renouvellement"
              value={formatMoney(renewals.renewalNet, churn.currency)}
              delta={null}
              hint={
                renewals.renewalShare === null
                  ? "aucun revenu classé"
                  : `${pct(renewals.renewalShare)} du revenu classé · ${formatNumber(renewals.renewalCount)} paiements`
              }
            />
            <KpiTile
              label="Maturité des cohortes"
              value={renewals.matureShare === null ? "—" : pct(renewals.matureShare)}
              delta={null}
              hint={`${formatNumber(renewals.due.notYetDue)} client(s) encore dans leur 1re période`}
            />
          </div>

          {/* Le ratio ne veut rien dire tant que les cohortes sont vertes. */}
          {!cohortsMature ? (
            <HubNotice className="border-amber-200 bg-amber-50/70 text-amber-900">
              <strong>Cohortes encore vertes.</strong>{" "}
              {formatNumber(renewals.due.notYetDue)} client(s) sur{" "}
              {formatNumber(renewals.payingMembers)} n&apos;ont pas encore atteint une
              seule échéance. Tant que c&apos;est le cas, ni le taux de renouvellement
              ni la projection ni le ratio face au coût d&apos;acquisition ne sont
              interprétables — c&apos;est mesurer une espérance de vie sur une
              population encore vivante.
            </HubNotice>
          ) : null}

          {/* Taux de renouvellement — DEUX bornes, et le sort des past_due dit. */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <HubCardHeader
                title="Taux de renouvellement"
                subtitle="Calculé sur les seules échéances TRANCHÉES. Les renouvellements en cours de relance ne sont comptés ni en succès ni en échec — ils bornent la fourchette."
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <KpiTile
                  label="Sur échéances résolues"
                  value={
                    renewals.renewalRateResolved === null
                      ? "—"
                      : pct(renewals.renewalRateResolved)
                  }
                  delta={null}
                  hint={`${formatNumber(renewals.due.renewed)} renouvelées / ${formatNumber(renewals.resolvedDueCount)} tranchées`}
                />
                <KpiTile
                  label="Borne basse"
                  value={
                    renewals.renewalRateWorstCase === null
                      ? "—"
                      : pct(renewals.renewalRateWorstCase)
                  }
                  delta={null}
                  hint={`si les ${formatNumber(renewals.due.pending)} en attente échouaient toutes`}
                />
                <KpiTile
                  label="En attente de relance"
                  value={dash(renewals.due.pending)}
                  delta={null}
                  hint={`${formatMoney(renewals.pendingRenewalAmount, churn.currency)} bruts en suspens`}
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Issue de l&apos;échéance</TableHead>
                    <TableHead className="text-right">Abonnements</TableHead>
                    <TableHead>Compté dans le taux ?</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-xs">Renouvelée</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(renewals.due.renewed)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      oui — au numérateur
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs">
                      Échouée (accès expiré, sans relance)
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(renewals.due.failed)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      oui — au dénominateur
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs font-medium text-amber-800">
                      En attente (past_due, Whop relance)
                    </TableCell>
                    <TableCell className="text-right text-xs font-medium tabular-nums text-amber-800">
                      {formatNumber(renewals.due.pending)}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-amber-800">
                      NON — issue inconnue, uniquement dans la borne basse
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs">Pas encore due</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(renewals.due.notYetDue)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      non — n&apos;a rien décidé
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Face au coût d'acquisition — même dénominateur, devises converties. */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <HubCardHeader
                title="Revenu par client contre coût d'acquisition"
                subtitle="Deux devises : le coût créatrices est en dollars, le revenu Whop en euros. Le coût est converti au taux du projet pour être comparable — jamais soustrait brut."
              />
              {acqCostRevCur === null ? (
                <p className="text-xs text-slate-500">
                  Coût d&apos;acquisition indisponible (coût par vidéo manquant ou taux
                  de change du projet non réglé) — aucun ratio affiché plutôt qu&apos;un
                  ratio inventé.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Grandeur</TableHead>
                      <TableHead className="text-right">Par client</TableHead>
                      <TableHead className="text-right">
                        Ratio / coût d&apos;acquisition
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="text-xs">
                        Coût d&apos;acquisition
                        <span className="text-slate-400">
                          {" "}
                          ({conversionNote(acqCost)})
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatMoney(acqCostRevCur, churn.currency)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-slate-400">
                        1,00
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs">Revenu à ce jour</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {renewals.revenueToDatePerClient === null
                          ? "—"
                          : formatMoney(renewals.revenueToDatePerClient, churn.currency)}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium tabular-nums">
                        {ratioToDate === null ? "—" : ratioToDate.toFixed(2)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs">
                        Revenu projeté (borne basse)
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {renewals.projectedPerClientWorstCase === null
                          ? "—"
                          : formatMoney(
                              renewals.projectedPerClientWorstCase,
                              churn.currency,
                            )}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium tabular-nums">
                        {ratioWorst === null ? "—" : ratioWorst.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
              <p className="text-xs text-slate-500">
                Un ratio supérieur à 1 signifie que le client rapporte plus qu&apos;il
                n&apos;a coûté. {cohortsMature ? "" : "Non concluant à ce stade : "}
                {cohortsMature
                  ? ""
                  : "la majorité des abonnements n'a pas franchi une seule échéance."}
              </p>
            </CardContent>
          </Card>

          {/* Renouvellement PAR OFFRE — un écart ici est une décision de pricing */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <HubCardHeader
                title="Renouvellement par offre"
                subtitle="Deux offres au même taux global peuvent diverger. Si la petite renouvelle deux fois moins bien que la grande, c'est une décision de pricing — elle ne dépend d'aucun test A/B."
              />
              {renewals.byPlanOutcome.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Aucune échéance atteinte sur aucune offre.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Offre</TableHead>
                      <TableHead className="text-right">Renouvelés</TableHead>
                      <TableHead className="text-right">En attente</TableHead>
                      <TableHead className="text-right">Échecs</TableHead>
                      <TableHead className="text-right">Taux résolu</TableHead>
                      <TableHead className="text-right">Borne basse</TableHead>
                      <TableHead>Cause d&apos;échec dominante</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renewals.byPlanOutcome.map((o) => (
                      <TableRow key={o.planId}>
                        <TableCell className="text-xs">{planLabel(o.planId)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(o.renewed)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {o.pending > 0 ? (
                            <span className="font-medium text-amber-800">
                              {formatNumber(o.pending)}
                            </span>
                          ) : (
                            <span className="text-slate-300">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {o.failed > 0 ? (
                            <span className="font-medium text-red-600">
                              {formatNumber(o.failed)}
                            </span>
                          ) : (
                            <span className="text-slate-300">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {o.rateResolved === null ? "—" : pct(o.rateResolved)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium tabular-nums">
                          {o.rateWorstCase === null ? "—" : pct(o.rateWorstCase)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {o.topFailureCause ?? (
                            <span className="text-slate-300">—</span>
                          )}
                          {o.pendingAmount > 0 ? (
                            <span className="text-slate-400">
                              {" "}
                              · {formatMoney(o.pendingAmount, churn.currency)} en suspens
                            </span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {renewals.failureCauses.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-500">
                    Causes d&apos;échec, telles que Whop les formule
                  </p>
                  {renewals.failureCauses.map((f) => (
                    <p key={f.cause} className="text-xs text-slate-600">
                      <strong>{formatNumber(f.count)}×</strong> {f.cause}
                    </p>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Cohortes — la seule lecture honnête de la durée de vie qui se construit */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <HubCardHeader
                title="Cohortes par semaine d'acquisition"
                subtitle="Les cohortes anciennes ont un historique, les récentes non. C'est là qu'on voit la durée de vie se construire, sans moyenne qui écrase."
              />
              {renewals.cohorts.length === 0 ? (
                <p className="text-xs text-slate-500">Aucun client encaissé.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Semaine d&apos;acquisition</TableHead>
                      <TableHead className="text-right">Clients</TableHead>
                      <TableHead className="text-right">Cycles franchis</TableHead>
                      <TableHead className="text-right">Revenu cumulé</TableHead>
                      <TableHead className="text-right">Par client</TableHead>
                      <TableHead>Lecture</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renewals.cohorts.map((c) => (
                      <TableRow key={c.week}>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums">
                          {c.week}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(c.clients)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatNumber(c.cycles)}
                          {c.cyclesWithoutNet > 0 ? (
                            <span className="text-amber-700">
                              {" "}
                              (dont {formatNumber(c.cyclesWithoutNet)} à 0 €)
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatMoney(c.net, churn.currency)}
                        </TableCell>
                        <TableCell
                          className={`text-right text-xs tabular-nums ${
                            c.clients < COHORT_MIN_CLIENTS
                              ? "text-slate-400"
                              : "font-medium"
                          }`}
                        >
                          {formatMoney(c.netPerClient, churn.currency)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {c.clients < COHORT_MIN_CLIENTS ? (
                            <span className="text-slate-500">
                              non interprétable ({formatNumber(c.clients)} client
                              {c.clients > 1 ? "s" : ""})
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="text-xs text-slate-500">
                Sous {COHORT_MIN_CLIENTS} clients, une cohorte n&apos;est pas une
                tendance : c&apos;est une poignée de personnes. Un cycle « à 0 € » est
                un paiement encaissé puis mis en LITIGE — il compte comme cycle
                (le client a bien payé) mais vaut 0 au net tant que l&apos;issue du
                litige est inconnue, ce qui explique un revenu plus bas que le nombre
                de cycles ne le laisse attendre.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <HubCardHeader
                title="Revenu nouveau contre revenu de renouvellement"
                subtitle="Source Whop (billing_reason). Un renouvellement n'est PAS un nouveau client : sans cette séparation, une journée faite de renouvellements affiche « 0 client payant » à côté d'un revenu non nul."
              />
              {renewals.unknownPayments > 0 ? (
                <HubNotice>
                  <strong>
                    {formatNumber(renewals.unknownPayments)} paiement(s) d&apos;origine
                    inconnue
                  </strong>{" "}
                  ({formatMoney(renewals.unknownNet, churn.currency)}) : importés avant
                  la capture de <code>billing_reason</code>. Ils ne sont comptés ni en
                  acquisition ni en rétention — la part de renouvellement porte
                  uniquement sur le revenu classé.
                </HubNotice>
              ) : null}
              {renewals.days.length === 0 ? (
                <p className="text-xs text-slate-500">Aucun paiement encaissé.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Jour</TableHead>
                      <TableHead className="text-right">
                        <ColLabel label="Nouveau" />
                      </TableHead>
                      <TableHead className="text-right">
                        <ColLabel label="Renouvellement" />
                      </TableHead>
                      <TableHead className="text-right">
                        <ColLabel label="Cumul renouv." />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...renewals.days].reverse().map((d) => (
                      <TableRow key={d.day}>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums">
                          {d.day}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {d.newCount === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <>
                              {formatMoney(d.newNet, churn.currency)}{" "}
                              <span className="text-slate-400">
                                ({formatNumber(d.newCount)})
                              </span>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium tabular-nums">
                          {d.renewalCount === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <>
                              {formatMoney(d.renewalNet, churn.currency)}{" "}
                              <span className="text-slate-400">
                                ({formatNumber(d.renewalCount)})
                              </span>
                            </>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-500">
                          {formatMoney(d.cumulativeRenewalNet, churn.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardContent className="space-y-3 p-4">
                <HubCardHeader
                  title="Renouvellements par offre"
                  subtitle="Quelle offre se reconduit, et pour combien de clients distincts."
                />
                {renewals.byPlan.length === 0 ? (
                  <p className="text-xs text-slate-500">Aucun renouvellement encaissé.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Offre</TableHead>
                        <TableHead className="text-right">Renouv.</TableHead>
                        <TableHead className="text-right">Clients</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {renewals.byPlan.map((r) => (
                        <TableRow key={r.planId}>
                          <TableCell className="text-xs">
                            {planLabel(r.planId)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {formatNumber(r.renewalCount)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {formatNumber(r.members)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {formatMoney(r.renewalNet, churn.currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 p-4">
                <HubCardHeader
                  title="Cycles par client"
                  subtitle="Combien de fois un même abonnement a payé. La moyenne SOUS-ESTIME tant que des abonnements sont jeunes."
                />
                {renewals.cycleDistribution.length === 0 ? (
                  <p className="text-xs text-slate-500">Aucun paiement encaissé.</p>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Cycles payés</TableHead>
                          <TableHead className="text-right">Clients</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {renewals.cycleDistribution.map((c) => (
                          <TableRow key={c.cycles}>
                            <TableCell className="text-xs tabular-nums">
                              {formatNumber(c.cycles)}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {formatNumber(c.members)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <p className="text-xs text-slate-500">
                      {formatNumber(renewals.due.notYetDue)} abonnement(s) sont encore
                      dans leur première période : ils n&apos;ont pas encore décidé, et
                      sont exclus du taux (les compter en échec l&apos;écraserait).
                      Cette moyenne de cycles est DESCRIPTIVE — elle ne sert pas à
                      projeter, justement parce que les abonnements jeunes l&apos;écrasent.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

        </>
      ) : null}

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
