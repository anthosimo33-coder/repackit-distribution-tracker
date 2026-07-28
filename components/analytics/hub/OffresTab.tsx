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
import { isConclusive, MIN_SAMPLE_SIZE } from "@/lib/analytics-hub";
import { HubCardHeader, HubNotice, dash, pct, formatDuration } from "./HubPrimitives";
import type { ProductAnalyticsData, RevenueData } from "./types";

/**
 * Onglet OFFRES & TESTS (B3) — suivi d'A/B test, économie par offre (taux de
 * frais réel = brut − net), plan gratuit, et journal des changements d'offre.
 * Sous le seuil de significativité, la carte affiche « non concluant » et le
 * volume restant, jamais un gagnant.
 */

/** Ratio en % tolérant au 0. */
function ratePct(num: number, den: number): number | null {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : null;
}

export function OffresTab({
  analytics,
  revenue,
}: {
  analytics: ProductAnalyticsData;
  revenue: RevenueData | undefined;
}) {
  const ab = useMemo(
    () =>
      analytics.abVariants.rows.map((v) => ({
        ...v,
        completion: ratePct(v.paid, v.checkouts),
        targetsPerClient: v.paid > 0 ? Math.round((v.clientTargets / v.paid) * 10) / 10 : null,
        conclusive: isConclusive(v.exposed),
      })),
    [analytics.abVariants.rows],
  );
  const totalExposed = ab.reduce((s, v) => s + v.exposed, 0);
  const anyInconclusive = ab.some((v) => !v.conclusive);
  const free = analytics.freePlan;

  return (
    <div className="space-y-6">
      {/* A/B test */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Test en cours — variantes de paywall"
            subtitle="Une variante par personne (sa dernière vue). Le nombre de cibles par client est le cœur du test : le modèle par cible ne tient que si les gens en prennent plusieurs."
          />
          {ab.length === 0 ? (
            <p className="text-xs text-slate-400">— aucune variante émise.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variante</TableHead>
                    <TableHead className="text-right">Exposés</TableHead>
                    <TableHead className="text-right">Checkouts</TableHead>
                    <TableHead className="text-right">Payés</TableHead>
                    <TableHead className="text-right">Complétion</TableHead>
                    <TableHead className="text-right">Cibles/client</TableHead>
                    <TableHead className="text-right">Net/exposé</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ab.map((v) => (
                    <TableRow key={v.variant}>
                      <TableCell className="text-xs font-medium text-slate-700">
                        {v.variant}
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
                      <TableCell className="text-right text-xs text-slate-400">
                        —
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {anyInconclusive ? (
                <HubNotice>
                  <strong>Résultat non concluant.</strong> {formatNumber(totalExposed)}{" "}
                  exposés — sous {MIN_SAMPLE_SIZE} par variante, la différence
                  n&apos;est pas distinguable du bruit. Ne pas trancher.
                </HubNotice>
              ) : null}
              <p className="text-xs text-slate-400">
                « Net par exposé » n&apos;est pas mesurable : la variante n&apos;est
                pas portée par le paiement Whop, aucun rapprochement variante↔revenu
                n&apos;est possible. Tiret plutôt qu&apos;un chiffre inventé.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Économie par offre */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Économie par offre"
              subtitle="Taux de frais réel (brut − net), jamais une formule supposée."
            />
            {!revenue?.configured || revenue.plans.length === 0 ? (
              <p className="text-xs text-slate-400">
                — Whop non configuré ou aucun paiement encaissé.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Offre</TableHead>
                    <TableHead className="text-right">Clients</TableHead>
                    <TableHead className="text-right">Net/paiement</TableHead>
                    <TableHead className="text-right">Frais</TableHead>
                    <TableHead className="text-right">Net/mois/client</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revenue.plans.map((p) => (
                    <TableRow key={p.planId}>
                      <TableCell className="text-xs font-medium text-slate-700">
                        {p.planId}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(p.members)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {dash(p.netPerPayment, formatMoney)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {p.feeRate === null ? "—" : `${formatNumber(Math.round(p.feeRate * 1000) / 10)} %`}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums font-semibold">
                        {dash(p.netPerMemberMonth, formatMoney)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Plan gratuit */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Plan gratuit"
              subtitle="Inscriptions, usage réel, passage au payant."
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
