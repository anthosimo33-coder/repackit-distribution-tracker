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
import { buildFunnel, computeConversion } from "@/lib/analytics-hub";
import { FunnelChart } from "./HubCharts";
import {
  HubCardHeader,
  HubNotice,
  WebhookFixNotice,
  dash,
  pct,
  formatDuration,
} from "./HubPrimitives";
import type { ProductAnalyticsData, ReliabilityData } from "./types";

/**
 * Onglet PARCOURS (B1) — le tunnel de CONVERSION corrigé (chemin de monétisation)
 * avec ses taux, l'atteinte brute par étape à côté, et la perte au checkout.
 *
 * Le tunnel a été RÉORDONNÉ le 29/07 (diagnostic A6) : target_added et
 * first_alert n'étaient PAS sur le chemin de paiement — les séries d'avant ne sont
 * pas comparables à celles d'après. L'activation a sa propre carte, séparée.
 */

/** Libellés du chemin de monétisation (mockup). */
const FUNNEL_LABELS: Record<string, string> = {
  visit: "Ont ouvert le site",
  signup_completed: "Se sont inscrits",
  paywall_viewed: "Ont vu l'offre",
  checkout_started: "Ont ouvert le checkout",
  subscription_completed: "Ont payé",
};

/** Seuil de timeout de confirmation de l'app (hypothèse produit, ancien réglage). */
const APP_TIMEOUT_MS = 60_000;

const DEVICE_LABELS: Record<string, string> = {
  natif: "Navigateur natif",
  webview: "Webview in-app",
  inconnu: "Inconnu (is_webview absent)",
};

export function ParcoursTab({
  analytics,
  reliability,
  now,
}: {
  analytics: ProductAnalyticsData;
  reliability: ReliabilityData | undefined;
  now: number;
}) {
  const seqSteps = useMemo(
    () => analytics.funnels.sequential.segments[0]?.steps ?? [],
    [analytics.funnels.sequential.segments],
  );
  const reachSteps = useMemo(
    () => analytics.funnels.global.segments[0]?.steps ?? [],
    [analytics.funnels.global.segments],
  );

  const funnel = useMemo(
    () =>
      buildFunnel(
        seqSteps.map((s) => ({
          key: s.key,
          label: FUNNEL_LABELS[s.key] ?? s.key,
          count: s.count,
        })),
      ),
    [seqSteps],
  );
  const reachByKey = useMemo(
    () => new Map(reachSteps.map((s) => [s.key, s.count])),
    [reachSteps],
  );

  const devices = useMemo(
    () =>
      computeConversion(
        analytics.checkoutReliability.rows.map((r) => ({
          key: r.device,
          label: DEVICE_LABELS[r.device] ?? r.device,
          n: r.checkouts,
          converted: r.paid,
        })),
      ),
    [analytics.checkoutReliability.rows],
  );
  const coverage = useMemo(() => {
    const rows = analytics.checkoutReliability.rows;
    const total = rows.reduce((s, r) => s + r.checkouts, 0);
    const known = rows
      .filter((r) => r.device !== "inconnu")
      .reduce((s, r) => s + r.checkouts, 0);
    return total > 0 ? Math.round((known / total) * 1000) / 10 : null;
  }, [analytics.checkoutReliability.rows]);

  // « Où se perdent les checkouts » — motifs assemblés depuis la phase A.
  const loss = useMemo(() => {
    const rows = analytics.checkoutReliability.rows;
    const disappeared = rows.reduce((s, r) => s + r.disappeared, 0);
    const divertedFree = rows.reduce((s, r) => s + r.divertedFree, 0);
    const paymentFailed =
      analytics.instrumentation.events.find((e) => e.name === "payment_failed")
        ?.persons ?? null;
    return { disappeared, divertedFree, paymentFailed };
  }, [analytics.checkoutReliability.rows, analytics.instrumentation.events]);

  // Délai médian/p90 jusqu'au paiement, tous appareils (le plus grand échantillon).
  const delay = useMemo(() => {
    const rows = analytics.checkoutReliability.rows.filter(
      (r) => r.paid > 0 && r.medPayMs !== null,
    );
    if (rows.length === 0) return { medMs: null, p90Ms: null };
    // On prend la ligne au plus gros volume de payés (représentative).
    const top = [...rows].sort((a, b) => b.paid - a.paid)[0];
    return { medMs: top.medPayMs, p90Ms: top.p90PayMs };
  }, [analytics.checkoutReliability.rows]);

  const whopGap = useMemo(() => {
    const c = reliability?.coherence;
    if (!c || c.whopMembers === null || c.dashboardClients === null) return null;
    return { whop: c.whopMembers, app: c.dashboardClients, gap: c.whopMembers - c.dashboardClients };
  }, [reliability]);

  return (
    <div className="space-y-6">
      <WebhookFixNotice now={now} />
      <HubNotice className="border-sky-200 bg-sky-50/70 text-sky-900">
        <strong>Tunnel corrigé le 29/07.</strong> L&apos;ordre des étapes était faux
        (les cibles et la 1re alerte étaient placées avant l&apos;offre) : les taux
        séquentiels d&apos;avant cette date ne sont pas comparables à ceux
        d&apos;après. L&apos;activation a désormais sa propre carte, hors du tunnel
        de paiement.
      </HubNotice>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Tunnel séquentiel (taux) */}
        <Card className="lg:col-span-2">
          <CardContent className="space-y-4 p-4">
            <HubCardHeader
              title="Tunnel de conversion"
              subtitle="Chemin de paiement, sous-ensemble strict : chaque taux porte sur l'étape juste au-dessus. Monotone par construction."
            />
            {funnel.length > 0 ? (
              <FunnelChart steps={funnel} labels={FUNNEL_LABELS} />
            ) : (
              <p className="text-sm text-slate-400">
                — en attente de la synchro PostHog.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Atteinte brute à côté */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Atteinte brute"
              subtitle="Personnes distinctes par étape, indépendamment de l'ordre. Peut dépasser l'étape amont (visiteurs anonymes)."
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Étape</TableHead>
                  <TableHead className="text-right">Personnes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {seqSteps.map((s) => (
                  <TableRow key={s.key}>
                    <TableCell className="text-xs text-slate-600">
                      {FUNNEL_LABELS[s.key] ?? s.key}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-medium">
                      {dash(reachByKey.get(s.key) ?? null)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-slate-400">
              L&apos;écart avec le tunnel = les personnes qui atteignent une étape
              sans avoir franchi les précédentes (souvent anonymes).
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Où se perdent les checkouts */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Où se perdent les checkouts"
              subtitle="Ventilation des personnes qui ouvrent le checkout sans payer."
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Motif</TableHead>
                  <TableHead className="text-right">Personnes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    Disparition sans tentative
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-medium">
                    {formatNumber(loss.disappeared)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    Détournés vers le gratuit
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-medium">
                    {formatNumber(loss.divertedFree)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    Échec de paiement
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-medium">
                    {dash(loss.paymentFailed)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-xs text-slate-400">
              Le détail des échecs (timeout de confirmation vs refus de carte réel)
              n&apos;est pas mesurable : la propriété <code>cause</code> n&apos;est
              pas émise sur <code>payment_failed</code>. Chiffre non ventilé plutôt
              qu&apos;inventé.
            </p>
          </CardContent>
        </Card>

        {/* Par appareil + couverture */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Par appareil"
              subtitle="Le webview convertit-il moins que le navigateur natif ?"
            />
            {coverage !== null && coverage < 100 ? (
              <HubNotice>
                Cette comparaison porte sur <strong>{formatNumber(coverage)} %</strong>{" "}
                des checkouts : <code>is_webview</code> est absent sur le reste, rangé
                en « inconnu » (jamais « natif » par défaut).
              </HubNotice>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contexte</TableHead>
                  <TableHead className="text-right">Checkouts</TableHead>
                  <TableHead className="text-right">Payés</TableHead>
                  <TableHead className="text-right">Taux</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => (
                  <TableRow key={d.key}>
                    <TableCell className="text-xs text-slate-600">{d.label}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(d.n)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(d.converted)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-semibold">
                      {pct(d.rate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Délai jusqu'au paiement */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Délai jusqu'au paiement"
              subtitle="Chez ceux qui aboutissent, comparé à l'ancien seuil de timeout de l'app."
            />
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">Médiane</TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-semibold">
                    {formatDuration(delay.medMs)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">9 sur 10 sous</TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-semibold">
                    {formatDuration(delay.p90Ms)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    Ancien seuil de timeout
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-red-600">
                    {formatDuration(APP_TIMEOUT_MS)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-xs text-slate-400">
              Un seuil réglé sous la médiane de succès annonce un échec à la majorité
              des paiements encore en cours.
            </p>
          </CardContent>
        </Card>

        {/* Whop sans accès app — contrôle permanent */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Paiements Whop sans accès applicatif"
              subtitle="Contrôle permanent : tout paiement encaissé doit avoir sa contrepartie dans l'app."
            />
            {whopGap === null ? (
              <p className="text-sm text-slate-400">
                — en attente de PostHog et/ou Whop.
              </p>
            ) : (
              <>
                <div className="flex items-baseline gap-3">
                  <span
                    className={
                      whopGap.gap > 0
                        ? "text-3xl font-bold tabular-nums text-red-600"
                        : "text-3xl font-bold tabular-nums text-emerald-600"
                    }
                  >
                    {formatNumber(Math.max(0, whopGap.gap))}
                  </span>
                  <span className="text-xs text-slate-500">
                    paiement(s) Whop ({formatNumber(whopGap.whop)}) sans abonnement
                    applicatif ({formatNumber(whopGap.app)})
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Un écart positif signale un webhook cassé (paiement encaissé,
                  accès non provisionné). À surveiller en continu.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activation — hors tunnel de paiement, séparée gratuit/payant */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Activation (hors tunnel de paiement)"
            subtitle="Recherche, cible, alerte ne sont PAS sur le chemin de paiement. Un gratuit et un payant ne s'activent pas pareil."
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Personnes</TableHead>
                <TableHead className="text-right">A cherché</TableHead>
                <TableHead className="text-right">A ajouté une cible</TableHead>
                <TableHead className="text-right">1re alerte reçue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analytics.activation.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-xs text-slate-400">
                    — en attente de la synchro PostHog.
                  </TableCell>
                </TableRow>
              ) : (
                analytics.activation.rows.map((r) => (
                  <TableRow key={r.segment}>
                    <TableCell className="text-xs font-medium text-slate-700">
                      {r.segment === "payant"
                        ? "Payant"
                        : r.segment === "gratuit"
                          ? "Gratuit"
                          : "Autre"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(r.persons)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(r.usernameEntered)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(r.targetAdded)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(r.firstAlert)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
