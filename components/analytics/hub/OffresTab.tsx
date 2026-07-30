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
import { computeConversion } from "@/lib/analytics-hub";
import { EXPECTED_PAYWALL_IDS } from "@/convex/analyticsContract";
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

/** Montant en dollars, décimales adaptées aux petits coûts unitaires. */
function usd(n: number | null, decimals = 2): string {
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

  // Un vrai test A/B n'existe que si experiment_id est émis (sinon « aucun test »).
  const abTestActive =
    (analytics.instrumentation.props.find((p) => p.key === "experiment_id")
      ?.present ?? 0) > 0;

  const plans = useMemo(() => revenue?.plans ?? [], [revenue]);
  const hasHistorical = plans.some((p) => !p.active);
  const currency = revenue?.currency ?? undefined;
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
    return acc;
  }, [plans]);

  // Litiges (chargebacks) EN COURS + remboursements — argent À RISQUE / rendu, déjà
  // DÉDUIT du revenu net. Les litiges sont triés serveur (le plus urgent d'abord).
  const disputes = revenue?.disputes ?? [];
  const disputedTotal = revenue?.disputedTotal ?? 0;
  const refunded = revenue?.refunded ?? 0;
  const refundCount = revenue?.refundCount ?? 0;
  const hasRiskOrRefunds = disputes.length > 0 || refundCount > 0;

  return (
    <div className="space-y-6">
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
          {abTestActive ? (
            <HubNotice className="border-emerald-200 bg-emerald-50/70 text-emerald-900">
              Un identifiant de test (<code>experiment_id</code>) est présent dans les
              données. Le rapprochement variante ↔ revenu reste nécessaire pour la
              métrique de décision (net par personne exposée) : à câbler avec le dev.
            </HubNotice>
          ) : (
            <HubNotice className="border-slate-200 bg-slate-50 text-slate-600">
              Aucun test en cours : aucun <code>experiment_id</code> n&apos;est présent
              dans les données. Cette carte s&apos;allumera d&apos;elle-même au
              démarrage d&apos;un test.
            </HubNotice>
          )}
          <div className="space-y-1 text-xs text-slate-500">
            <p className="font-medium text-slate-600">
              Définitions figées du prochain test :
            </p>
            <p>
              <strong>A, paywall souple</strong> : plan gratuit avec 1 cible, puis
              4,99 € par semaine et 16,99 € par mois, par cible.
            </p>
            <p>
              <strong>B, paywall bloquant</strong> : pas de plan gratuit, 7,99 € par
              semaine et 24,99 € par mois, pour 3 cibles.
            </p>
            <p>
              Décision sur le <strong>revenu net par personne exposée</strong>, fenêtre
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
            subtitle="L'app a 7 emplacements de paywall, mais variant n'en distingue que 2 (gate/upsell)."
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
