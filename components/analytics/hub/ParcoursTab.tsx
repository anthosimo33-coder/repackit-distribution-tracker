"use client";

import { useMemo, useState } from "react";
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
import { buildFunnel, computeConversion } from "@/lib/analytics-hub";
import { FunnelChart } from "./HubCharts";
import {
  HubCardHeader,
  HubNotice,
  InfoDot,
  ColLabel,
  WebhookFixNotice,
  dash,
  pct,
  formatDuration,
} from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
import {
  buildSegmentRows,
  UNKNOWN_SEGMENT,
  type SegmentPayload,
} from "@/lib/segment-funnel";
import type { ProductAnalyticsData, ReliabilityData } from "./types";

/**
 * Onglet PARCOURS (B1) — le tunnel de CONVERSION corrigé (chemin de monétisation)
 * avec ses taux, l'atteinte brute par étape à côté, et la perte au checkout.
 *
 * Deux notions de « clients » cohabitent et sont désormais EXPLIQUÉES à l'écran :
 * le tunnel (20, séquentiel strict) et l'atteinte brute (25, ordre libre). L'écart
 * vient du double comptage de subscription_completed (navigateur + serveur). La
 * mention est posée à l'endroit exact de l'écart, pas seulement en Fiabilité.
 */

/** Libellés du chemin de monétisation (mockup). */
const FUNNEL_LABELS: Record<string, string> = {
  visit: "Ont ouvert le site",
  signup_completed: "Se sont inscrits",
  paywall_viewed: "Ont vu l'offre",
  checkout_started: "Ont ouvert le checkout",
  subscription_completed: "Ont payé",
};

/**
 * Libellés de l'ATTEINTE BRUTE : la dernière étape est renommée « Paiements
 * déclenchés » (elle compte des ÉVÉNEMENTS, double-émis client + serveur), pour ne
 * pas la confondre avec « Clients payants » (Whop, la vérité comptable). Un seul
 * chiffre du dashboard porte le nom « clients ».
 */
const REACH_LABELS: Record<string, string> = {
  ...FUNNEL_LABELS,
  subscription_completed: "Paiements déclenchés",
};

/** Seuil de timeout de confirmation de l'app (hypothèse produit, ancien réglage). */
const APP_TIMEOUT_MS = 60_000;

const DEVICE_LABELS: Record<string, string> = {
  natif: "Navigateur natif",
  webview: "Webview in-app",
  inconnu: "Inconnu (is_webview absent)",
};

/** Libellés + ordre des segments d'activation (l'anonyme 'hors_inscription' est écarté). */
const SEGMENT_LABELS: Record<string, string> = {
  payant: "Payant",
  gratuit: "Gratuit",
  sans_acces: "Inscrits sans accès",
  autre: "Inscrits sans accès", // cache antérieur à la restriction aux inscrits
};
const SEGMENT_ORDER = ["payant", "gratuit", "sans_acces", "autre"];

interface ActivationRow {
  segment: string;
  persons: number;
  targetAdded: number;
  firstAlert: number;
  usernameEntered: number;
}

export function ParcoursTab({
  analytics,
  reliability,
  now,
}: {
  analytics: ProductAnalyticsData;
  reliability: ReliabilityData | undefined;
  now: number;
}) {
  const [recentOnly, setRecentOnly] = useState(false);

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
  const seqByKey = useMemo(
    () => new Map(seqSteps.map((s) => [s.key, s.count])),
    [seqSteps],
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

  // « Où se perdent les checkouts » — ventilation MUTUELLEMENT EXCLUSIVE des NON
  // payeurs (total = non payeurs). L'échec de paiement est une sous-part des
  // disparus, pas une 4e ligne additionnelle (l'ancienne carte double-comptait :
  // 78 + 28 + 20 = 126 = tous les checkouts, alors que les non payeurs sont 106).
  const loss = useMemo(() => {
    const rows = analytics.checkoutReliability.rows;
    const disappeared = rows.reduce((s, r) => s + r.disappeared, 0);
    const divertedFree = rows.reduce((s, r) => s + r.divertedFree, 0);
    const failedPayment = rows.reduce((s, r) => s + (r.failedPayment ?? 0), 0);
    const total = disappeared + divertedFree + failedPayment;
    return { disappeared, divertedFree, failedPayment, total };
  }, [analytics.checkoutReliability.rows]);

  // Délai médian/p90 jusqu'au paiement, tous appareils (le plus grand échantillon).
  const delay = useMemo(() => {
    const rows = analytics.checkoutReliability.rows.filter(
      (r) => r.paid > 0 && r.medPayMs !== null,
    );
    if (rows.length === 0) return { medMs: null, p90Ms: null };
    const top = [...rows].sort((a, b) => b.paid - a.paid)[0];
    return { medMs: top.medPayMs, p90Ms: top.p90PayMs };
  }, [analytics.checkoutReliability.rows]);

  // « Paiements Whop sans abonnement applicatif » — en PERSONNES des deux côtés.
  // Cette carte affichait `whopMembers - dashboardClients`, soit des ABONNEMENTS
  // moins des PERSONNES : au relevé du 2026-08-29 elle annonçait 9 paiements
  // orphelins en rouge, qui étaient les 9 abonnements en double de clients
  // existants (8 personnes en ont 2, une en a 3). Aucun paiement orphelin.
  //
  // Côté applicatif on prend l'atteinte brute (personnes ayant émis
  // subscription_completed) et non le tunnel séquentiel : un client qui paie
  // sans checkout tracké a bien un abonnement applicatif.
  const whopGap = useMemo(() => {
    const c = reliability?.coherence;
    if (!c || c.whopClients === null) return null;
    const reach =
      c.reachSteps.find((s) => s.key === "subscription_completed")?.count ??
      c.dashboardClients;
    if (reach === null) return null;
    return { whop: c.whopClients, app: reach, gap: c.whopClients - reach };
  }, [reliability]);

  // Activation : agrégée par segment, « tous » ou « depuis le 28/07 » (recent=1).
  const activation = useMemo(() => {
    const agg = (recentFlag: boolean): ActivationRow[] => {
      const bySeg = new Map<string, ActivationRow>();
      for (const r of analytics.activation.rows) {
        if (r.segment === "hors_inscription") continue;
        if (recentFlag && r.recent !== 1) continue;
        const cur =
          bySeg.get(r.segment) ??
          { segment: r.segment, persons: 0, targetAdded: 0, firstAlert: 0, usernameEntered: 0 };
        cur.persons += r.persons;
        cur.targetAdded += r.targetAdded;
        cur.firstAlert += r.firstAlert;
        cur.usernameEntered += r.usernameEntered;
        bySeg.set(r.segment, cur);
      }
      return [...bySeg.values()].sort(
        (a, b) => SEGMENT_ORDER.indexOf(a.segment) - SEGMENT_ORDER.indexOf(b.segment),
      );
    };
    return { all: agg(false), recent: agg(true) };
  }, [analytics.activation.rows]);
  const activationRows = recentOnly ? activation.recent : activation.all;
  const hasRecent = activation.recent.length > 0;

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
              info={EXPLAIN.tunnelVsAtteinte}
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
              title="Atteinte brute (comptage large)"
              subtitle="Personnes distinctes par étape, quel que soit l'ordre. Peut dépasser le tunnel (visiteurs anonymes, doublons de mesure)."
              info={EXPLAIN.tunnelVsAtteinte}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Étape</TableHead>
                  <TableHead className="text-right">
                    <ColLabel
                      label="Atteint, tous chemins"
                      info={EXPLAIN.tunnelVsAtteinte}
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {seqSteps.map((s) => {
                  const reach = reachByKey.get(s.key) ?? null;
                  const seq = seqByKey.get(s.key) ?? null;
                  // À l'endroit EXACT de l'écart 20/25 : mention + « i » dédié.
                  const gap =
                    s.key === "subscription_completed" &&
                    reach !== null &&
                    seq !== null &&
                    reach !== seq;
                  return (
                    <TableRow key={s.key}>
                      <TableCell className="text-xs text-slate-600">
                        {REACH_LABELS[s.key] ?? s.key}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums font-medium">
                        <span className="inline-flex items-center justify-end gap-1">
                          {dash(reach)}
                          {gap ? (
                            <>
                              <span className="font-normal text-slate-400">
                                (vs {formatNumber(seq)} au tunnel)
                              </span>
                              <InfoDot label="Écart 20 / 25" side="left">
                                {EXPLAIN.ecartPaye}
                              </InfoDot>
                            </>
                          ) : null}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-slate-400">
              L&apos;écart avec le tunnel = les personnes qui atteignent une étape
              sans avoir franchi les précédentes (souvent anonymes), plus les
              doublons de mesure.
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
              subtitle="Ventilation des personnes qui ouvrent le checkout sans payer. Chaque personne dans une seule ligne."
              info={EXPLAIN.ouSePerdentCheckouts}
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
                    Détournés vers le gratuit
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-medium">
                    {formatNumber(loss.divertedFree)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    Échec de paiement resté sans suite
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-medium">
                    {formatNumber(loss.failedPayment)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    Disparition sans aucune tentative
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-medium">
                    {formatNumber(loss.disappeared)}
                  </TableCell>
                </TableRow>
                <TableRow className="border-t-2">
                  <TableCell className="text-xs font-semibold text-slate-700">
                    Total (n&apos;ont pas payé)
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-semibold">
                    {formatNumber(loss.total)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-xs text-slate-400">
              Le détail des échecs (timeout de confirmation contre refus de carte
              réel) n&apos;est pas mesurable : la propriété <code>cause</code>{" "}
              n&apos;est pas émise sur <code>payment_failed</code>. Motif non
              ventilé plutôt qu&apos;inventé.
            </p>
          </CardContent>
        </Card>

        {/* Par appareil + couverture */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Par appareil"
              subtitle="Le webview convertit-il moins que le navigateur natif ?"
              info={EXPLAIN.parAppareil}
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
              info={EXPLAIN.delaiPaiement}
            />
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    <ColLabel label="Médiane" info={EXPLAIN.medianeP90} />
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-semibold">
                    {formatDuration(delay.medMs)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    <ColLabel label="9 sur 10 sous" info={EXPLAIN.medianeP90} />
                  </TableCell>
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
              info={EXPLAIN.whopSansAcces}
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
                    client(s) Whop ({formatNumber(whopGap.whop)} personnes) sans
                    abonnement applicatif ({formatNumber(whopGap.app)} personnes)
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Un écart positif veut dire un paiement encaissé sans abonnement
                  applicatif correspondant sur la fenêtre. Ce n&apos;est pas forcément
                  la faute du webhook : les 12 derniers accès se sont ouverts en 3 à 4
                  secondes. Un petit écart vient plutôt d&apos;un décalage de synchro
                  ou d&apos;un paiement tout récent. C&apos;est un contrôle de
                  cohérence à garder, pas une alarme.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── D'où vient le trafic ──────────────────────────────────────────
          Le MÊME entonnoir, coupé par géographie puis par langue. Le pays vient
          d'une propriété d'EVENT (GeoIP, posée à l'ingestion) ; la langue d'une
          propriété de PERSONNE, posée par l'app à l'inscription — d'où sa part
          d'« inconnu » massive, affichée en tête de chaque tableau plutôt que
          noyée dans les lignes. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SegmentFunnelCard
          title="Trafic par pays"
          subtitle="Le tunnel complet, coupé par pays du VISITEUR. Le pays est lu sur l'event (GeoIP), pas sur la personne : il accompagne donc chaque étape."
          payload={analytics.funnels.country}
          colonne="Pays"
          note="Une personne qui visite depuis un pays et achète depuis un autre compte dans les deux : les lignes ne s'additionnent pas en un total."
        />
        <SegmentFunnelCard
          title="Trafic par langue"
          subtitle="Même tunnel, coupé par langue d'interface. Collectée depuis toujours, affichée seulement maintenant."
          payload={analytics.funnels.language}
          colonne="Langue"
          note="La langue est une propriété de PERSONNE, posée à l'inscription : les visiteurs qui n'ont pas fini de s'inscrire restent en « inconnu »."
        />
      </div>

      {/* Activation — hors tunnel de paiement, séparée par type d'inscrit */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Activation (hors tunnel de paiement)"
            subtitle="Recherche, cible, alerte ne sont PAS sur le chemin de paiement. Un gratuit et un payant ne s'activent pas pareil."
            info={EXPLAIN.activation}
            action={
              <div className="flex items-center gap-1">
                {[
                  { key: false, label: "Tous les inscrits" },
                  { key: true, label: "Depuis le 28/07" },
                ].map((opt) => (
                  <button
                    key={String(opt.key)}
                    type="button"
                    onClick={() => setRecentOnly(opt.key)}
                    disabled={opt.key && !hasRecent}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      recentOnly === opt.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            }
          />
          <HubNotice>
            Chiffres d&apos;activation à lire avec prudence. La recherche de compte
            n&apos;existe que depuis le 28/07 (vers 1 h) et le plan gratuit depuis le
            27/07 (vers 16 h) : la plupart des « inscrits sans accès » se sont
            inscrits AVANT, donc leurs 2 recherches sur des centaines de personnes ne
            reflètent pas leur comportement réel. La vue « depuis le 28/07 » ne garde
            que la période où les trois groupes sont comparables.
          </HubNotice>
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
              {activationRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-xs text-slate-400">
                    {recentOnly
                      ? "— aucun inscrit depuis le 28/07 sur la fenêtre."
                      : "— en attente de la synchro PostHog."}
                  </TableCell>
                </TableRow>
              ) : (
                activationRows.map((r) => {
                  const sansAcces = r.segment === "sans_acces" || r.segment === "autre";
                  return (
                    <TableRow key={r.segment}>
                      <TableCell className="text-xs font-medium text-slate-700">
                        <span className="inline-flex items-center gap-1">
                          {SEGMENT_LABELS[r.segment] ?? r.segment}
                          {sansAcces ? (
                            <InfoDot label="Inscrits sans accès">
                              {EXPLAIN.inscritsSansAcces}
                            </InfoDot>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums font-medium">
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
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Une carte « tunnel par segment » — pays, langue, et ce qui viendra.
 *
 * La part d'« inconnu » est affichée EN TÊTE, avant le tableau, parce qu'elle
 * qualifie tout ce qui suit : un classement qui ne l'annonce pas se lit comme
 * une répartition du trafic alors qu'il n'en décrit qu'une fraction. Mesuré en
 * prod sur la langue : 84 % des visiteurs y sont « inconnu ».
 *
 * Aucun TOTAL n'est affiché, volontairement. Le pays vient de l'event : une
 * personne qui visite depuis la France et achète depuis la Belgique compte dans
 * les deux lignes, donc leur somme dépasse le nombre réel de personnes.
 */
function SegmentFunnelCard({
  title,
  subtitle,
  payload,
  colonne,
  note,
}: {
  title: string;
  subtitle: string;
  payload: SegmentPayload;
  colonne: string;
  note: string;
}) {
  const { rows, unknownShare, unknownVisitors } = buildSegmentRows(payload);
  const nommes = rows.filter((r) => r.key !== UNKNOWN_SEGMENT);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <HubCardHeader title={title} subtitle={subtitle} />
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">
            — en attente de la synchro PostHog.
          </p>
        ) : (
          <>
            {unknownShare !== null && unknownShare > 0 ? (
              <p className="text-xs text-slate-500">
                <strong className="tabular-nums">{pct(unknownShare)}</strong> des
                visiteurs ne sont pas attribués (
                {formatNumber(unknownVisitors)} en « inconnu ») — ce
                classement ne décrit que le reste.
              </p>
            ) : null}
            {nommes.length === 0 ? (
              /* Tout est en « inconnu » — cas réel de `source`, à 100 %. Un
                 tableau vide sous ses en-têtes se lit comme une panne ; la
                 phrase dit ce qui se passe. */
              <p className="text-sm text-slate-400">
                Aucun segment identifié : la totalité du trafic est en
                « inconnu ».
              </p>
            ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{colonne}</TableHead>
                    <TableHead className="text-right">Visiteurs</TableHead>
                    <TableHead className="text-right">Inscrits</TableHead>
                    <TableHead className="text-right">Checkouts</TableHead>
                    <TableHead className="text-right">Clients</TableHead>
                    <TableHead className="text-right">Taux</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nommes.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="text-xs font-medium text-slate-700">
                        {r.key}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(r.visit)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(r.signup)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(r.checkout)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums font-medium">
                        {formatNumber(r.subs)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-slate-500">
                        {r.rate === null ? "—" : pct(r.rate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            )}
            <p className="text-xs text-slate-400">{note}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
