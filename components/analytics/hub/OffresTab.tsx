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
import { HubCardHeader, HubNotice, dash, pct, formatDuration } from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
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
}: {
  analytics: ProductAnalyticsData;
  revenue: RevenueData | undefined;
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

  const plans = revenue?.plans ?? [];
  const hasHistorical = plans.some((p) => !p.active);

  return (
    <div className="space-y-6">
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
            subtitle="L'app a 6 paywalls distincts, mais variant n'en distingue que 2 (gate/upsell)."
            info={EXPLAIN.conversionParPaywall}
          />
          {!paywallReady ? (
            <HubNotice className="border-slate-200 bg-slate-50 text-slate-600">
              En attente de <code>paywall_id</code> : la propriété n&apos;est pas
              encore émise côté app (0 occurrence sur 90 j — demandée au dev). Sans
              elle, 4 des 6 paywalls sont indistinguables. Tiret plutôt qu&apos;une
              conversion par paywall inventée.
            </HubNotice>
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
              subtitle="Taux de frais réel (brut − net), jamais une formule supposée."
              info={EXPLAIN.economieOffre}
            />
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
                {hasHistorical ? (
                  <p className="text-xs text-slate-400">
                    Offres actives d&apos;abord ; les offres grisées sont des restes de
                    changements d&apos;offre successifs, sans paiement encaissé.
                  </p>
                ) : null}
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

      {/* Journal des changements d'offre — non disponible */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Journal des changements d'offre"
            subtitle="Horodaté. Sans lui, aucune cohorte n'est comparable à une autre."
          />
          <HubNotice className="border-slate-200 bg-slate-50 text-slate-600">
            Pas encore disponible : ce journal exige une table dédiée alimentée à la
            main par l&apos;admin (les changements d&apos;offre ne sont pas des
            events). À livrer séparément — ce n&apos;est pas dérivable des données
            actuelles, donc rien n&apos;est affiché plutôt qu&apos;un contenu inventé.
          </HubNotice>
        </CardContent>
      </Card>
    </div>
  );
}
