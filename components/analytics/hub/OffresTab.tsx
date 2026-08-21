"use client";

import { useMemo } from "react";
import { MixedCurrencyNotice } from "@/components/MixedCurrencyNotice";
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
import { computeConversion, abArmCoherenceChecks } from "@/lib/analytics-hub";
import {
  EXPECTED_ARM_PRICING,
  EXPECTED_PAYWALL_IDS,
} from "@/convex/analyticsContract";
import {
  HubCardHeader,
  HubNotice,
  disputeDeadlineLabel,
  dash,
  pct,
  formatDuration,
} from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
import { AlertTriangleIcon, ReceiptTextIcon } from "lucide-react";
import type { ProductAnalyticsData, RevenueData } from "./types";

/**
 * Onglet OFFRES & TESTS (B3) — les TYPES de paywall émis aujourd'hui (gate/upsell,
 * PAS un test A/B : renommé pour ne pas faire décider sur du vide), une carte Test
 * A/B distincte (« aucun test en cours » tant qu'aucun experiment_id n'arrive),
 * l'économie par offre avec nom et prix lisibles, et le plan gratuit.
 */

/**
 * Libellés des bras du test. `soft`/`hard` sont les valeurs émises ; l'écran
 * dit ce que chaque bras SERT, sinon « hard » ne veut rien dire pour qui lit.
 */
const AB_ARM_LABELS: Record<string, string> = {
  soft: "A — souple (1 cible, plan gratuit)",
  hard: "B — bloquant (3 cibles, sans gratuit)",
};

/** Ratio en % tolérant au 0. */
function ratePct(num: number, den: number): number | null {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : null;
}

/** Type de scan (coût d'infrastructure) → libellé. */
const SCAN_KIND_LABELS: Record<string, string> = {
  light: "Scan léger (cible gratuite)",
  full: "Scan complet (détecte les désabonnements)",
  "(autre)": "Autre",
};

/**
 * Montant en dollars, décimales adaptées aux petits coûts unitaires.
 *
 * Seul endroit du hub où la devise est écrite en dur, et à raison : la source
 * est `cost_usd` sur `scan_completed` — le coût de l'appel HikerAPI, facturé en
 * dollars par le fournisseur. La devise est fixée par la DÉFINITION de la
 * donnée (le nom de la propriété la déclare), pas par la donnée : il n'existe
 * aucun champ `currency` à lire, et en fabriquer un laisserait croire que ce
 * coût pourrait un jour sortir en euros. Ne PAS remplacer par formatMoney avec
 * une devise dynamique — cf. règle des deux devises dans lib/format-rate.
 */
function usd(n: number | null, decimals = 2): string {
  // currency-hardcode-exempt: cost_usd est en dollars par nature (coût HikerAPI), aucune devise à sourcer
  return n === null ? "—" : `${n.toFixed(decimals)} $`;
}

/** Les deux TYPES de paywall (pas des variantes de test). */
const PAYWALL_TYPE_LABELS: Record<string, string> = {
  gate: "Bloquant (gate)",
  upsell: "Appoint (upsell)",
  "(sans variante)": "Type inconnu",
  "(inconnu)": "Type inconnu",
};

export function OffresTab({
  analytics,
  revenue,
  now,
}: {
  analytics: ProductAnalyticsData;
  revenue: RevenueData | undefined;
  now: number;
}) {
  const paywallTypes = useMemo(
    () =>
      analytics.abVariants.rows.map((v) => ({
        ...v,
        completion: ratePct(v.paid, v.checkouts),
        targetsPerClient: v.paid > 0 ? Math.round((v.clientTargets / v.paid) * 10) / 10 : null,
      })),
    [analytics.abVariants.rows],
  );
  const free = analytics.freePlan;

  // Coût d'infrastructure des scans, léger (cible gratuite) vs complet. Le tableau
  // ne se chiffre que si cost_usd est émis ; il sépare toujours les deux tarifs.
  const scanCost = useMemo(() => {
    const rows = analytics.scanCost.rows;
    const order = ["light", "full", "(autre)"];
    return {
      rows: [...rows].sort(
        (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
      ),
      anyRuns: rows.some((r) => r.runs > 0),
      anyCost: rows.some((r) => r.withCost > 0),
    };
  }, [analytics.scanCost.rows]);

  const paywallRows = analytics.paywallById.rows;
  const paywallReady = paywallRows.some(
    (r) => r.key !== "(inconnu)" && r.key !== "(absent)",
  );
  const paywallConv = computeConversion(
    paywallRows.map((r) => ({ key: r.key, label: r.key, n: r.n, converted: r.converted })),
  );
  // Fenêtre RÉELLE de la carte : ancrée sur la première émission de paywall_id,
  // pas sur les 90 jours. Un taux calculé sur une autre fenêtre que celle
  // annoncée est un chiffre faux — on écrit donc la date à l'écran.
  const paywallStart =
    analytics.paywallById.startMs != null
      ? new Date(analytics.paywallById.startMs).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "long",
        })
      : null;

  // ─── Test A/B par BRAS ────────────────────────────────────────────────────
  // Sessions FORCÉES déjà exclues côté requête (notForcedExperimentClause).
  //
  // Chaque taux est calculé UNE fois ici, puis passé au garde-fou avec la valeur
  // affichée : le contrôle compare l'affiché au recalculé, seule façon d'attraper
  // une erreur d'unité (la complétion sortait un ratio dans un formateur de %).
  const arms = useMemo(
    () =>
      analytics.abArms.rows.map((a) => ({
        ...a,
        completion: ratePct(a.paid, a.checkouts),
        // Cibles PAYANTES par client : cibles ajoutées par les clients APRÈS
        // leur paiement ÷ clients. Un bras qui n'émet AUCUN target_added n'a pas
        // « 0 cible par client », il n'est pas mesuré → tiret.
        targetsPerClient:
          a.paid > 0 && a.armTargets > 0
            ? Math.round((a.clientTargets / a.paid) * 100) / 100
            : null,
      })),
    [analytics.abArms.rows],
  );
  const armChecks = useMemo(
    () =>
      abArmCoherenceChecks(
        arms.map((a) => ({
          variant: a.variant,
          exposed: a.exposed,
          paywallViewers: a.paywallViewers,
          checkouts: a.checkouts,
          paid: a.paid,
          paidWithoutCheckout: a.paidWithoutCheckout,
          clientTargets: a.clientTargets,
          armTargets: a.armTargets,
          shownCompletionPct: a.completion,
          shownTargetsPerClient: a.targetsPerClient,
        })),
      ),
    [arms],
  );
  const armAlerts = armChecks.filter((c) => c.status !== "ok");
  /** Sous ce nombre d'exposés PAR BRAS, aucune comparaison n'a de sens. */
  const AB_THRESHOLD = 330;
  /** Personnes écartées du tableau faute de bras stable (cf QUERIES.abArms). */
  const abExcluded = arms.reduce((sum, a) => sum + a.excludedFlippers, 0);
  /**
   * MARQUEUR DE RUPTURE — correctif SERVEUR du tirage de bras. Vérifié en prod le
   * 09/08 : dernière bascule à l'identification le 07/08 22:02:46.735 UTC,
   * première identification propre le 08/08 10:24:45.484 UTC. Non datable par
   * `app_version` : la même build client (20260806-1724) est des deux côtés de la
   * rupture. Écrit en dur ici, comme AB_THRESHOLD : c'est un fait d'observation
   * daté, pas une donnée que le cache saurait recalculer.
   */
  const AB_BREAK_LABEL = "8 août 2026, 10 h 24 UTC";
  const abMinExposed = arms.length > 0 ? Math.min(...arms.map((a) => a.exposed)) : 0;
  const abConcluant = arms.length >= 2 && abMinExposed >= AB_THRESHOLD;
  /** Personnes restantes à recruter, tous bras confondus, pour atteindre le seuil. */
  const abRemaining = arms.reduce(
    (sum, a) => sum + Math.max(0, AB_THRESHOLD - a.exposed),
    arms.length < 2 ? AB_THRESHOLD : 0,
  );
  // Revenu par bras — voie primaire metadata.abVariant, repli distinctId. La carte
  // est restreinte à la fenêtre du test côté serveur : les abonnements antérieurs
  // ne sont PAS des « bras inconnus », le test n'existait pas.
  const abRev = revenue?.abRevenue;
  const netByArm = new Map(
    (abRev?.rows ?? []).map((r) => [r.variant, r] as const),
  );
  const abStart =
    analytics.abArms.startMs != null
      ? new Date(analytics.abArms.startMs).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "long",
        })
      : null;

  // La carte ne se pilote plus par la présence d'`experiment_id` mais par les
  // BRAS réellement assignés : une propriété émise par un seul compte de test ne
  // suffit pas à dire qu'un test tourne (c'est ce qui l'avait allumée à tort).

  const plans = useMemo(() => revenue?.plans ?? [], [revenue]);
  const hasHistorical = plans.some((p) => !p.active);
  const currency = revenue?.currency ?? undefined;
  const mixedCurrency = revenue?.mixedCurrency ?? false;
  const offerChanges = revenue?.offerChanges ?? [];

  // Répartition HEBDO vs MENSUEL (le mensuel ne se vend pas : à faire ressortir).
  const byInterval = useMemo(() => {
    const acc = {
      semaine: { clients: 0, net: 0 },
      mois: { clients: 0, net: 0 },
    };
    for (const p of plans) {
      if (p.interval === "semaine") {
        acc.semaine.clients += p.members;
        acc.semaine.net += p.netTotal;
      } else if (p.interval === "mois") {
        acc.mois.clients += p.members;
        acc.mois.net += p.netTotal;
      }
    }
    // A5 — chaque LIGNE d'offre est rendue avec SA devise (p.currency), mais ce
    // pied de tableau les additionne. En bi-devise les montants ne veulent rien
    // dire : on les neutralise, les COMPTES de clients restent justes.
    if (mixedCurrency) {
      acc.semaine.net = 0;
      acc.mois.net = 0;
    }
    return acc;
  }, [plans, mixedCurrency]);

  // Litiges (chargebacks) EN COURS + remboursements — argent À RISQUE / rendu, déjà
  // DÉDUIT du revenu net. Les litiges sont triés serveur (le plus urgent d'abord).
  const disputes = revenue?.disputes ?? [];
  const disputedTotal = revenue?.disputedTotal ?? 0;
  const refunded = revenue?.refunded ?? 0;
  const refundCount = revenue?.refundCount ?? 0;
  const hasRiskOrRefunds = disputes.length > 0 || refundCount > 0;

  return (
    <div className="space-y-6">
      {/* A5 — chaque ligne d'offre porte SA devise, mais les pieds de tableau
          les additionnent : le signal doit être en tête d'onglet. */}
      <MixedCurrencyNotice
        mixed={revenue?.mixedCurrency}
        present={revenue?.mixedCurrencyPresent}
        currencies={revenue?.currenciesPresent}
      />

      {/* Litiges & remboursements — EN TÊTE : l'info la plus urgente du revenu. */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Litiges et remboursements"
            subtitle="Argent contesté ou rendu — déjà DÉDUIT du revenu net. Un litige coûte plus cher que l'abonnement : répondre avant l'échéance est prioritaire."
            info={EXPLAIN.litigesRemboursements}
          />
          {!revenue?.configured ? (
            <p className="text-xs text-slate-400">— Whop non configuré.</p>
          ) : !hasRiskOrRefunds ? (
            <HubNotice className="border-emerald-200 bg-emerald-50/70 text-emerald-900">
              Aucun litige en cours ni remboursement. Rien n&apos;est retiré du net à
              ce titre.
            </HubNotice>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-red-200 bg-red-50/60 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-red-800">
                    <AlertTriangleIcon className="size-3.5" /> Litiges en cours
                  </div>
                  <div className="mt-1 text-xl font-bold tabular-nums text-red-900">
                    {formatNumber(disputes.length)}
                    {disputedTotal > 0 ? (
                      <span className="ml-1 text-sm font-medium">
                        · {formatMoney(disputedTotal, currency)} à risque
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <ReceiptTextIcon className="size-3.5" /> Remboursements
                  </div>
                  <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                    {formatNumber(refundCount)}
                    {refunded > 0 ? (
                      <span className="ml-1 text-sm font-medium text-slate-500">
                        · −{formatMoney(refunded, currency)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {disputes.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                      <TableHead className="text-right">Délai de réponse</TableHead>
                      <TableHead>Motif</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {disputes.map((d) => {
                      const dl = disputeDeadlineLabel(d.dueAt, now);
                      return (
                        <TableRow key={d.whopId}>
                          <TableCell className="text-xs font-medium text-slate-700">
                            {d.memberName ?? "client Whop"}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {formatMoney(d.amount, d.currency ?? currency)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            <span
                              className={
                                dl.urgent
                                  ? "font-semibold text-red-600"
                                  : "text-slate-600"
                              }
                            >
                              {dl.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-slate-500">
                            {d.reason ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : null}

              <p className="text-xs text-slate-400">
                Ces montants ne sont PAS dans le revenu net encaissé (retirés à la
                source). Un litige gagné y reviendra ; perdu, il devient un
                remboursement.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Types de paywall émis aujourd'hui (ce ne sont PAS des variantes de test) */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Types de paywall"
            subtitle="Les deux paywalls que l'app affiche aujourd'hui. Le nombre de cibles par abonné est clé : le modèle par cible ne tient que si les gens en prennent plusieurs."
            info={EXPLAIN.typesPaywall}
          />
          {paywallTypes.length === 0 ? (
            <p className="text-xs text-slate-400">— aucun paywall émis.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type de paywall</TableHead>
                    <TableHead className="text-right">Exposés</TableHead>
                    <TableHead className="text-right">Checkouts</TableHead>
                    <TableHead className="text-right">Payés</TableHead>
                    <TableHead className="text-right">Complétion</TableHead>
                    <TableHead className="text-right">Cibles/abonné</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paywallTypes.map((v) => (
                    <TableRow key={v.variant}>
                      <TableCell className="text-xs font-medium text-slate-700">
                        {PAYWALL_TYPE_LABELS[v.variant] ?? v.variant}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(v.exposed)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(v.checkouts)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(v.paid)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {pct(v.completion)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums font-semibold">
                        {dash(v.targetsPerClient)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-slate-400">
                Le paywall <strong>bloquant</strong> empêche d&apos;accéder tant
                qu&apos;on n&apos;a pas payé ; le paywall <strong>d&apos;appoint</strong>{" "}
                propose un supplément sans bloquer. Ce sont deux modes du produit, pas
                les bras d&apos;un test.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Test A/B — carte distincte, « aucun test en cours » par défaut */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Test A/B"
            subtitle="Un vrai test compare deux offres pour décider laquelle garder."
            info={EXPLAIN.testAB}
          />
          {arms.length === 0 ? (
            <HubNotice className="border-slate-200 bg-slate-50 text-slate-600">
              Aucun bras assigné naturellement pour l&apos;instant. Les sessions à bras
              FORCÉ (<code>ab_forced</code>, override de QA) sont exclues de ce tableau :
              ce n&apos;est pas du trafic, les compter fausserait autant la répartition
              que les taux.
            </HubNotice>
          ) : (
            <div className="space-y-3">
              {!abConcluant ? (
                <HubNotice className="border-amber-200 bg-amber-50/70 text-amber-900">
                  <strong>Non concluant.</strong> {formatNumber(abMinExposed)} personne(s)
                  exposée(s) sur le plus petit bras, seuil {AB_THRESHOLD}. Il manque{" "}
                  <strong>{formatNumber(abRemaining)}</strong> personne(s) à recruter, en
                  cumulant les deux bras, pour que la comparaison ait un sens. Les
                  chiffres ci-dessous sont affichés pour suivre le recrutement, pas pour
                  décider.
                </HubNotice>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bras</TableHead>
                    {/* « Assignés », pas « exposés » : l'assignation est l'unité de
                        randomisation, la moitié ne verra jamais le paywall. */}
                    <TableHead className="text-right">Assignés</TableHead>
                    <TableHead className="text-right">Ont vu le paywall</TableHead>
                    <TableHead className="text-right">Checkouts</TableHead>
                    <TableHead className="text-right">Nouveaux clients</TableHead>
                    <TableHead className="text-right">Complétion</TableHead>
                    <TableHead className="text-right">Cibles / client</TableHead>
                    <TableHead className="text-right">Net / assigné</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {arms.map((a) => (
                    <TableRow key={a.variant}>
                      <TableCell className="text-xs font-medium text-slate-700">
                        {AB_ARM_LABELS[a.variant] ?? a.variant}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(a.exposed)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(a.paywallViewers)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(a.checkouts)}
                      </TableCell>
                      {/* Nouveaux clients SEULEMENT. subscription_completed est
                          réémis à chaque cycle : un renouvellement compté ici
                          gonflerait le bras d'une conversion qui n'en est pas une. */}
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(a.paid)}
                        {a.renewals > 0 ? (
                          <span
                            className="ml-1 cursor-help font-medium text-slate-400"
                            title={`${a.renewals} renouvellement(s) d'abonnés ANTÉRIEURS au test dans ce bras, exclus des nouveaux clients : leur abonnement n'a pas été décidé par ce paywall. Ils restent comptés dans les assignés.`}
                          >
                            +{formatNumber(a.renewals)} renouv.
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {pct(a.completion)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {dash(a.targetsPerClient)}
                        {a.targetsPerClient === null && a.paid > 0 ? (
                          <span
                            className="ml-1 cursor-help text-slate-400"
                            title="Aucun target_added émis sur ce bras : le nombre de cibles par client n'est pas mesuré. Ce n'est pas « zéro cible »."
                          >
                            (non mesuré)
                          </span>
                        ) : null}
                      </TableCell>
                      {/* Revenu par bras : rattaché par metadata.abVariant du
                          membership Whop, repli par distinctId. Un bras SANS
                          abonnement rattaché reste au tiret — 0,00 € et « aucun
                          abonnement » ne veulent pas dire la même chose. */}
                      <TableCell className="text-right text-xs tabular-nums">
                        {(() => {
                          const r = netByArm.get(a.variant);
                          if (!r || r.memberships === 0) {
                            return <span className="text-slate-300">—</span>;
                          }
                          // Dénominateur = les ASSIGNÉS, pas ceux qui ont vu le
                          // paywall : c'est la comparaison en intention de traiter,
                          // la seule que la randomisation garantit non biaisée.
                          const perAssigned =
                            a.exposed > 0
                              ? Math.round((r.net / a.exposed) * 100) / 100
                              : null;
                          return (
                            <>
                              {perAssigned === null
                                ? "—"
                                : formatMoney(perAssigned, currency)}
                              {r.atRiskMemberships > 0 ? (
                                <span
                                  className="ml-1 cursor-help font-medium text-amber-700"
                                  title={`${r.memberships} abonnement(s) rattaché(s) à ce bras, dont ${r.atRiskMemberships} dont l'argent est EN LITIGE : ${formatMoney(r.atRiskAmount, currency)} contestés, exclus du net tant que l'issue est inconnue. Un net à 0,00 € ici signale un litige, PAS une absence de conversion.`}
                                >
                                  ⚠
                                </span>
                              ) : null}
                            </>
                          );
                        })()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {/* Le garde-fou de la carte : chaque taux doit avoir son numérateur
                  inclus dans son dénominateur ET porter sur la colonne annoncée.
                  Silencieux quand tout va bien, comme le contrôle de ligne du
                  tableau « Détail par jour ». */}
              {armAlerts.length > 0 ? (
                <HubNotice className="border-red-200 bg-red-50/70 text-red-900">
                  <strong>Contrôle du tableau : {formatNumber(armAlerts.length)} écart(s).</strong>{" "}
                  {armAlerts.map((c) => `${c.label} — ${c.detail}`).join(" · ")}. Un taux
                  dont le numérateur sort de son dénominateur, ou qui ne vaut pas le
                  ratio des colonnes affichées, ne se lit pas : corriger avant de
                  décider quoi que ce soit sur ce test.
                </HubNotice>
              ) : null}
              {/* Rupture de comparabilité : le bras était tiré DEUX fois (client
                  avant le compte, serveur à sa création) et les deux tirages
                  divergeaient. Un marqueur visible vaut mieux qu'une note perdue
                  ailleurs — sans lui, on compare deux périodes qui ne se comparent
                  pas. */}
              <HubNotice className="border-amber-200 bg-amber-50/70 text-amber-900">
                <strong>Rupture le {AB_BREAK_LABEL}.</strong> Le bras était tiré deux
                fois — une fois côté navigateur avant le compte, une fois côté serveur
                à sa création — et les deux tirages ne tombaient pas d&apos;accord.
                Avant cette date, <strong>56 % des personnes mises à l&apos;épreuve</strong>{" "}
                (10 sur 18 ayant une assignation de part et d&apos;autre de
                l&apos;inscription) changeaient de bras à l&apos;identification ; après,
                aucune sur 47. <strong>Les données d&apos;avant ne sont pas comparables
                à celles d&apos;après.</strong>
              </HubNotice>
              {abExcluded > 0 ? (
                <p className="text-xs text-slate-500">
                  <strong>
                    {formatNumber(abExcluded)} personne(s) écartée(s) du tableau
                  </strong>{" "}
                  : deux valeurs d&apos;<code>experiment_variant</code> sur la même
                  personne, donc on ignore quel bras elle a réellement subi. Retirées
                  de TOUTES les colonnes, revenu compris.{" "}
                  <strong>Ce retrait n&apos;est pas neutre</strong> : ces personnes ont
                  vu un paywall et certaines ont converti — on retire de vraies
                  conversions pour ne pas les attribuer au mauvais bras. Détection par
                  la double valeur, jamais par une liste figée (elle grossit) ni par
                  une fenêtre de date (elle jetterait aussi les cohortes saines).
                </p>
              ) : null}
              <p className="text-xs text-slate-500">
                <strong>Complétion</strong> = nouveaux clients ÷{" "}
                <strong>checkouts ouverts</strong> (pas les assignés, pas ceux qui ont vu
                le paywall) : la part des gens qui, une fois le paiement ouvert, sont
                allés au bout. <strong>Cibles / client</strong> = cibles ajoutées par les
                nouveaux clients APRÈS leur paiement, divisées par ces clients — ni les
                cibles du plan gratuit, ni celles ajoutées avant l&apos;abonnement, ni
                celles des personnes qui n&apos;ont jamais payé.
              </p>
              <p className="text-xs text-slate-500">
                <strong>Net par assigné</strong> = revenu net sécurisé des abonnements
                rattachés au bras, divisé par les <strong>assignés</strong> : c&apos;est
                le tirage au sort qui rend les deux bras comparables, diviser par les
                seuls visiteurs du paywall rendrait la comparaison biaisée. Rattachement
                par <code>metadata.abVariant</code> du membership Whop, repli par{" "}
                <code>distinctId</code> vers la personne PostHog. Un bras sans aucun
                abonnement rattaché reste au tiret : <strong>0,00 € et « aucun
                abonnement » ne veulent pas dire la même chose.</strong>
              </p>
              {abRev && abRev.divergences.length > 0 ? (
                <HubNotice className="border-red-200 bg-red-50/70 text-red-900">
                  <strong>
                    {formatNumber(abRev.divergences.length)} rattachement(s)
                    divergent(s)
                  </strong>{" "}
                  : la metadata Whop et PostHog ne disent pas le même bras (
                  {abRev.divergences
                    .slice(0, 3)
                    .map((d) => `${d.membershipId} : ${d.metadata} vs ${d.posthog}`)
                    .join(" · ")}
                  ). Le revenu de ces abonnements suit la metadata. Un rattachement
                  faux étant pire qu&apos;un rattachement absent, l&apos;écart est
                  signalé plutôt que tranché en silence.
                </HubNotice>
              ) : null}
              {abRev && abRev.unattached > 0 ? (
                <p className="text-xs text-slate-500">
                  {formatNumber(abRev.unattached)} abonnement(s) de la fenêtre du test
                  ne sont rattachés à aucun bras, ni par metadata ni par{" "}
                  <code>distinctId</code> : leur revenu n&apos;est compté dans aucune
                  ligne.
                </p>
              ) : null}
              <p className="text-xs text-slate-500">
                Sessions à bras forcé exclues du tableau. Assignations naturelles
                uniquement{abStart ? `, depuis le ${abStart}` : ""}.
              </p>
            </div>
          )}
          <div className="space-y-1 text-xs text-slate-500">
            <p className="font-medium text-slate-600">
              Offre attendue par bras (vérifiée chez Whop) :
            </p>
            {EXPECTED_ARM_PRICING.map((arm) => (
              <p key={arm.variant}>
                <strong>{arm.label}</strong> :{" "}
                {arm.freeTier ? "plan gratuit, puis " : "pas de plan gratuit, "}
                {formatMoney(arm.priceWeekly, currency)} par semaine et{" "}
                {formatMoney(arm.priceMonthly, currency)} par mois, pour{" "}
                {arm.maxTargets} {arm.maxTargets > 1 ? "cibles" : "cible"}.
              </p>
            ))}
            <p>
              Décision sur le <strong>revenu net par personne assignée</strong>, fenêtre
              de 14 jours.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Conversion par paywall (paywall_id) */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Conversion par paywall"
            subtitle={
              paywallStart === null
                ? "L'app a 7 emplacements de paywall, mais variant n'en distingue que 2 (gate/upsell)."
                : `Depuis le ${paywallStart}, première émission de paywall_id. L'historique antérieur est EXCLU : il n'a pas la propriété, l'inclure rangerait 80 % des personnes en « inconnu ».`
            }
            info={EXPLAIN.conversionParPaywall}
          />
          {!paywallReady ? (
            <div className="space-y-3">
              <HubNotice className="border-slate-200 bg-slate-50 text-slate-600">
                En attente de <code>paywall_id</code> : la propriété n&apos;est pas
                encore émise côté app (0 occurrence sur 90 j, demandée au dev). Les 7
                emplacements ci-dessous sont prêts et s&apos;alimenteront d&apos;eux-mêmes
                dès qu&apos;elle arrivera. Tiret plutôt qu&apos;une conversion inventée.
              </HubNotice>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">
                  Paywalls forcés (l&apos;app bloque tant qu&apos;on n&apos;a pas payé)
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paywall</TableHead>
                      <TableHead className="text-right">Exposés</TableHead>
                      <TableHead className="text-right">Payés</TableHead>
                      <TableHead className="text-right">Taux</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {EXPECTED_PAYWALL_IDS.filter((p) => p.forced).map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs font-medium text-slate-700">
                          {p.label}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-300">
                          {dash(null)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-300">
                          {dash(null)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-300">
                          {dash(null)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">
                  Paywall volontaire (jamais comparé aux forcés)
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paywall</TableHead>
                      <TableHead className="text-right">Vus</TableHead>
                      <TableHead className="text-right">Payés</TableHead>
                      <TableHead className="text-right">Taux</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {EXPECTED_PAYWALL_IDS.filter((p) => !p.forced).map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs font-medium text-slate-700">
                          {p.label}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-300">
                          {dash(null)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-300">
                          {dash(null)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-300">
                          {dash(null)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-[11px] text-slate-400">
                  <code>menu_upsell</code> est un clic choisi depuis le menu, pas un mur
                  subi. Son taux n&apos;a pas le même dénominateur, on ne le met jamais
                  dans le tableau des paywalls forcés.
                </p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paywall</TableHead>
                  <TableHead className="text-right">Exposés</TableHead>
                  <TableHead className="text-right">Payés</TableHead>
                  <TableHead className="text-right">Taux</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paywallConv.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="text-xs font-medium text-slate-700">
                      {r.label}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(r.n)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(r.converted)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-semibold">
                      {pct(r.rate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Économie par offre — nom + prix lisibles, actives vs historiques */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Économie par offre"
              subtitle="Par offre (plan_name), jamais par variant. Taux de frais réel (brut − net)."
              info={EXPLAIN.economieOffre}
            />
            <HubNotice className="border-sky-200 bg-sky-50/70 text-sky-900">
              Ces offres se sont <strong>succédé</strong>, ce ne sont pas des variantes
              testées en parallèle : bascule nette le 27/07 (dernier 7,99 € à 15h16,
              premier 4,99 € à 16h45, zéro recouvrement). Trois changements le même jour,
              voir le journal ci-dessous.
            </HubNotice>
            {!revenue?.configured || plans.length === 0 ? (
              <p className="text-xs text-slate-400">
                — Whop non configuré ou aucun paiement encaissé.
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Offre</TableHead>
                      <TableHead className="text-right">Abonnés</TableHead>
                      <TableHead className="text-right">Net/paiement</TableHead>
                      <TableHead className="text-right">Frais</TableHead>
                      <TableHead className="text-right">Net/mois/abonné</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.map((p) => (
                      <TableRow key={p.planId} className={p.active ? "" : "opacity-60"}>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
                              {p.name ??
                                (p.price === null
                                  ? "Offre"
                                  : formatMoney(p.price, p.currency ?? undefined))}
                              {p.active ? null : (
                                <Badge
                                  variant="outline"
                                  className="border-slate-200 text-[10px] text-slate-500"
                                >
                                  historique
                                </Badge>
                              )}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">
                              {p.name && p.price !== null
                                ? `${formatMoney(p.price, p.currency ?? undefined)}${
                                    p.interval ? ` / ${p.interval}` : ""
                                  } · ${p.planId}`
                                : p.planId}
                            </span>
                          </div>
                        </TableCell>
                        {p.netReason ? (
                          <TableCell
                            colSpan={4}
                            className="text-right text-xs text-slate-400"
                          >
                            {p.netReason}
                          </TableCell>
                        ) : (
                          <>
                            <TableCell className="text-right text-xs tabular-nums">
                              {formatNumber(p.members)}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {dash(p.netPerPayment, (n) =>
                                formatMoney(n, p.currency ?? undefined),
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {p.feeRate === null
                                ? "—"
                                : `${formatNumber(Math.round(p.feeRate * 1000) / 10)} %`}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums font-semibold">
                              {dash(p.netPerMemberMonth, (n) =>
                                formatMoney(n, p.currency ?? undefined),
                              )}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {/* Répartition hebdo vs mensuel — le mensuel ne se vend pas. */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs">
                  <span className="text-slate-600">
                    <strong>Hebdomadaire</strong>{" "}
                    <span className="tabular-nums">
                      {formatNumber(byInterval.semaine.clients)}
                    </span>{" "}
                    clients ·{" "}
                    <span className="tabular-nums">
                      {formatMoney(Math.round(byInterval.semaine.net * 100) / 100, currency)}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    <strong>Mensuel</strong>{" "}
                    <span className="tabular-nums">
                      {formatNumber(byInterval.mois.clients)}
                    </span>{" "}
                    client(s) ·{" "}
                    <span className="tabular-nums">
                      {formatMoney(Math.round(byInterval.mois.net * 100) / 100, currency)}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Le mensuel ne se vend quasiment pas ; le nouveau tarif mensuel est à
                  zéro vente. {hasHistorical ? "Offres actives d'abord ; les grisées sont des restes de changements d'offre successifs, sans paiement encaissé." : ""}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Plan gratuit */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Plan gratuit"
              subtitle="Inscriptions, usage réel, passage au payant."
              info={EXPLAIN.planGratuit}
            />
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">Inscriptions</TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-semibold">
                    {formatNumber(free.signups)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    En ont fait usage
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatNumber(free.used)}{" "}
                    <span className="text-slate-400">
                      ({pct(ratePct(free.used, free.signups))})
                    </span>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    Sont passés au payant
                  </TableCell>
                  <TableCell
                    className={
                      free.convertedPaid === 0
                        ? "text-right text-xs tabular-nums font-semibold text-red-600"
                        : "text-right text-xs tabular-nums font-semibold"
                    }
                  >
                    {formatNumber(free.convertedPaid)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    Avaient ouvert le checkout avant
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-red-600">
                    {formatNumber(free.checkoutBefore)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    Délai médian gratuit → checkout
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {free.medFreeToCheckoutMs === null
                      ? "—"
                      : free.medFreeToCheckoutMs < 0
                        ? `−${formatDuration(-free.medFreeToCheckoutMs)}`
                        : formatDuration(free.medFreeToCheckoutMs)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-xs text-slate-400">
              Un délai négatif signifie que le checkout était ouvert AVANT le gratuit :
              ces gens allaient payer.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Coût des cibles gratuites — léger vs complet, en dollars */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Coût des cibles gratuites"
            subtitle="Une cible gratuite ne déclenche que des scans légers : son coût suit le tarif léger, en dollars, pas celui du scan complet."
            info={EXPLAIN.coutCibles}
          />
          {!scanCost.anyRuns ? (
            <p className="text-xs text-slate-400">— en attente de scan_completed.</p>
          ) : !scanCost.anyCost ? (
            <HubNotice className="border-slate-200 bg-slate-50 text-slate-600">
              Les scans tournent mais ne portent pas encore de coût :{" "}
              <code>cost_usd</code> n&apos;est pas émis sur <code>scan_completed</code>{" "}
              (demandé au dev). Le tableau se chiffrera de lui-même dès qu&apos;il
              arrivera. Le léger (cible gratuite) et le complet sont déjà séparés.
            </HubNotice>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type de scan</TableHead>
                    <TableHead className="text-right">Scans</TableHead>
                    <TableHead className="text-right">Coût total (90 j)</TableHead>
                    <TableHead className="text-right">Par scan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scanCost.rows.map((r) => (
                    <TableRow
                      key={r.kind}
                      className={r.kind === "light" ? "bg-emerald-50/40" : undefined}
                    >
                      <TableCell className="text-xs font-medium text-slate-700">
                        {SCAN_KIND_LABELS[r.kind] ?? r.kind}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(r.runs)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {r.withCost > 0 ? usd(r.sumCostUsd, 2) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {usd(r.avgCostUsd, 4)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-slate-400">
                <code>cost_usd</code> est en dollars. Une cible gratuite ne subit que
                la ligne « léger » : son coût n&apos;est jamais celui d&apos;un scan
                complet, ni en euros. Le total est mesuré sur la fenêtre de 90 jours.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Journal des changements d'offre — horodaté (saisi par l'admin) */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Journal des changements d'offre"
            subtitle="Horodaté. Sans lui, aucune cohorte n'est comparable à une autre."
          />
          {offerChanges.length === 0 ? (
            <HubNotice className="border-slate-200 bg-slate-50 text-slate-600">
              Vide : aucun changement d&apos;offre saisi. Les changements ne sont pas
              des events, ils s&apos;ajoutent à la main (analyticsHub:addOfferChange).
            </HubNotice>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Changement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offerChanges.map((o) => (
                  <TableRow key={`${o.at}-${o.title}`}>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-slate-500">
                      {new Date(o.at).toLocaleString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <span className="font-medium">{o.title}</span>
                      {o.detail ? (
                        <span className="text-slate-500"> — {o.detail}</span>
                      ) : null}
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
