"use client";

import { useMemo, useState } from "react";
import {
  useProjectQuerySafe,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import {
  ActivityIcon,
  BarChart3Icon,
  FlaskConicalIcon,
  GlobeIcon,
  Loader2Icon,
  RefreshCwIcon,
  RepeatIcon,
  RouteIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TargetIcon,
} from "lucide-react";
import { PaysTab } from "@/components/analytics/hub/PaysTab";
import { windowToMs } from "@/lib/market-window";
import { PeriodPicker } from "@/components/analytics/hub/PeriodPicker";
import {
  clampWindow,
  dataRangeOf,
  parisDayKey,
  type AnalyticsWindow,
} from "@/lib/analytics-window";
import { windowedAttribution } from "@/lib/attribution-window";
import { useWindowedAnalytics } from "@/components/analytics/hub/useWindowedAnalytics";
import { OverviewTab } from "@/components/analytics/hub/OverviewTab";
import { ParcoursTab } from "@/components/analytics/hub/ParcoursTab";
import { AcquisitionTab } from "@/components/analytics/hub/AcquisitionTab";
import { SanteProduitTab } from "@/components/analytics/hub/SanteProduitTab";
import { OffresTab } from "@/components/analytics/hub/OffresTab";
import { FiabiliteTab } from "@/components/analytics/hub/FiabiliteTab";
import { RetentionTab } from "@/components/analytics/hub/RetentionTab";
import {
  HubEmptyState,
  HubNotice,
  LastSyncIndicator,
} from "@/components/analytics/hub/HubPrimitives";
import { PermissionGate } from "@/components/project/PermissionGate";

/**
 * HUB ANALYTICS (ADMIN) — données PRODUIT, distinct des surfaces créateurs.
 * Structure en 6 onglets (maquette v3) : Vue d'ensemble, Parcours, Acquisition,
 * Santé produit, Offres & tests, Fiabilité. Chaque carte AFFICHE les agrégats de
 * la phase A ; elle ne calcule pas. Jamais un 0 trompeur — un tiret et la raison.
 */

function AnalyticsPageContenu() {
  // ── NEUF AGRÉGATS INDÉPENDANTS, NEUF SORTS INDÉPENDANTS ───────────────────
  // `useProjectQuery` LANCE quand une query échoue, et React démonte alors tout
  // l'arbre : le 2026-09-08, `getReliability` a échoué cinq fois d'affilée en
  // production et les SIX onglets disparaissaient avec — un écran noir pour un
  // agrégat manquant sur neuf. La variante `Safe` rend l'échec sous forme de
  // valeur (cf useProjectQuerySafe) : la page se rend, l'agrégat absent est
  // NOMMÉ, et le reste continue de servir.
  const analyticsQ = useProjectQuerySafe(api.posthogSync.getProductAnalytics, {});
  const attributionQ = useProjectQuerySafe(api.analyticsHub.getAttribution, {});
  const revenueQ = useProjectQuerySafe(api.analyticsHub.getRevenueBreakdown, {});
  const reliabilityQ = useProjectQuerySafe(api.analyticsHub.getReliability, {});
  const viewCountersQ = useProjectQuerySafe(api.analyticsHub.getViewCounters, {});
  const natureRewardsQ = useProjectQuerySafe(api.analyticsHub.getNatureRewards, {});
  const dayDetailQ = useProjectQuerySafe(api.analyticsHub.getDayDetail, {});
  const billingQ = useProjectQuerySafe(api.analyticsHub.getBillingCountries, {});
  /**
   * Les agrégats qui ont ÉCHOUÉ, nommés. Sans cette liste, la page se rendrait
   * avec des tirets partout et on croirait à une absence de données — alors que
   * la donnée existe et que c'est la lecture qui n'a pas abouti. Les deux se
   * corrigent très différemment.
   */
  const agregatsEnEchec = [
    ["Produit (PostHog)", analyticsQ] as const,
    ["Acquisition", attributionQ] as const,
    ["Revenu", revenueQ] as const,
    ["Fiabilité", reliabilityQ] as const,
    ["Compteurs de vues", viewCountersQ] as const,
    ["Récompenses en nature", natureRewardsQ] as const,
    ["Détail par jour", dayDetailQ] as const,
    ["Pays de facturation", billingQ] as const,
  ].filter(([, q]) => q.status === "error");
  const analytics = analyticsQ.data;
  const attribution = attributionQ.data;
  const revenue = revenueQ.data;
  const reliability = reliabilityQ.data;
  const viewCounters = viewCountersQ.data;
  const natureRewards = natureRewardsQ.data;
  const dayDetail = dayDetailQ.data;
  const billing = billingQ.data;
  const requestSync = useProjectMutation(api.posthogSync.requestPosthogSync);
  const [syncing, setSyncing] = useState(false);
  const [now] = useState(() => Date.now());
  // Fenêtre d'analyse : bornes de JOURS Europe/Paris, inclusives. `null` tant que
  // la série quotidienne n'est pas chargée — on n'invente pas une fenêtre sur des
  // données absentes, les cartes affichent un tiret.
  const [window, setWindow] = useState<AnalyticsWindow | null>(null);
  // Rétention : la période réduit les clients à leur COHORTE D'ACQUISITION,
  // côté serveur. C'est une requête Convex (notre base), pas PostHog : elle est
  // réactive et coûte une lecture, aucune latence à masquer.
  const churnQ = useProjectQuerySafe(
    api.analyticsHub.getChurn,
    window ? { from: window.from, to: window.to } : {},
  );
  const churn = churnQ.data;
  const dataRange = useMemo(
    () =>
      dataRangeOf(
        (analytics?.overview.daily ?? []).map((d) => parisDayKey(d.ts)),
      ),
    [analytics],
  );
  // Défaut = TOUT ce qui existe. L'ancien défaut « 90 jours » promettait une
  // profondeur que PostHog n'a pas (46 jours au 2026-09-06) : deux des trois
  // boutons rendaient le même écran.
  // L'attribution FENÊTRÉE, dérivée UNE fois pour tous les onglets qui la lisent
  // (Acquisition, Rétention). Sans ce point unique, chaque onglet referait le
  // filtrage à sa façon — et deux écrans finiraient par montrer deux coûts pour
  // la même période, ce que le hub et l'écran Paiements ont déjà fait pour le
  // revenu Whop.
  const windowedAttr = useMemo(() => {
    if (!attribution) return undefined;
    const w = clampWindow(
      window ?? { from: "0000-01-01", to: "9999-12-31" },
      dataRangeOf((analytics?.overview.daily ?? []).map((d) => parisDayKey(d.ts))),
    );
    const daily = (analytics?.overview.daily ?? []).map((d) => ({
      day: parisDayKey(d.ts),
      visitors: d.visitors,
      signups: d.signups,
      clients: d.subs,
    }));
    const win = windowedAttribution(
      attribution.rows,
      attribution.costs.promoBonusByDay,
      daily,
      w,
    );
    return {
      ...attribution,
      // La fenêtre VOYAGE avec les coûts qu'elle a filtrés. Sans elle, un écran
      // qui divise ces coûts par un dénominateur non fenêtré produit un chiffre
      // faux que rien ne peut détecter — c'est ce qui est arrivé au coût
      // d'acquisition de l'onglet Rétention (#167).
      costWindow: w,
      rows: win.rows,
      soloDays: win.soloDays,
      creators: win.creators,
      costs: {
        ...attribution.costs,
        promo: win.costs.promo,
        promoBonus:
          win.costs.bonus === null
            ? null
            : Math.round(win.costs.bonus * 100) / 100,
      },
    };
  }, [attribution, analytics, window]);

  const effectiveWindow = useMemo(
    () => clampWindow(window ?? { from: "0000-01-01", to: "9999-12-31" }, dataRange),
    [window, dataRange],
  );

  // Onglet PARCOURS : ses agrégats PostHog n'ont pas de jour, ils se
  // RECALCULENT côté serveur (cf useWindowedAnalytics). Appelé ICI, au niveau de
  // la page, pour deux raisons : la préchauffe démarre à l'ouverture du hub et
  // non au premier clic sur l'onglet, et la fenêtre passée est la fenêtre
  // BORNÉE aux données réelles — la même que les autres onglets, sinon deux
  // écrans afficheraient deux périodes sous le même libellé.
  const windowedAnalytics = useWindowedAnalytics(effectiveWindow, dataRange);
  // L'ARGENT suit le sélecteur SANS recalcul PostHog : ce sont des lignes
  // Convex filtrables sur n'importe quelle plage (paidAt, datePubli). Seuls les
  // agrégats PostHog ont besoin de la volée à la demande ci-dessus.
  // `Safe` comme ses voisines : un agrégat qui échoue ne doit pas emporter les
  // huit onglets (incident du 2026-09-08).
  const marketBounds = useMemo(
    () => (effectiveWindow ? windowToMs(effectiveWindow) : null),
    [effectiveWindow],
  );
  // Pas de `skip` quand la fenêtre est nulle : cet agrégat ne dépend PAS de
  // PostHog (lignes Whop + moteur de paie), et `dataRange` l'est. Sur un projet
  // sans données produit, sauter la requête laissait l'onglet sur « Chargement… »
  // pour toujours — vu à l'écran avant d'être vu dans un test. Sans bornes, la
  // query rend toute la profondeur.
  const marketPnlQ = useProjectQuerySafe(
    api.marketPnl.getMarketPnl,
    marketBounds ? { from: marketBounds.from, to: marketBounds.to } : {},
  );

  const onSync = async () => {
    setSyncing(true);
    try {
      const r = await requestSync({});
      toast[r.scheduled ? "success" : "info"](
        r.scheduled
          ? "Actualisation PostHog lancée — les cartes se mettront à jour d'elles-mêmes."
          : "PostHog n'est pas configuré sur ce projet.",
      );
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <BarChart3Icon className="size-5" />
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Analytics
            </h1>
            <p className="text-sm text-slate-500">
              Données produit — PostHog × Jarvia × Whop.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <Button
            variant="outline"
            size="sm"
            onClick={onSync}
            disabled={syncing || analytics?.configured !== true}
          >
            {syncing ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
            Actualiser
          </Button>
          <LastSyncIndicator computedAt={analytics?.computedAt ?? null} now={now} />
        </div>
      </header>

      {/* Sélecteur de période global (B4) — filtre les KPI de conversion. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <PeriodPicker
          window={effectiveWindow}
          range={dataRange}
          onChange={setWindow}
        />
        <p className="max-w-md text-xs text-slate-400">
          Conversions ancrées sur l&apos;inscription · revenu sur le paiement · vues
          sur la publication.
          <br />
          {/* Dire ce qui NE suit PAS est aussi important que de fenêtrer le
              reste : un sélecteur qui ne fait rien sur un onglet, sans le dire,
              se lit comme un chiffre à jour. Les onglets restants lisent des
              agrégats PostHog sans dates ; les fenêtrer veut dire les
              RECALCULER (cf convex/analyticsWindowed), pas les trancher —
              Parcours vient de passer, les autres suivront. */}
          <span className="text-slate-400/90">
            La période s&apos;applique à Vue d&apos;ensemble, Acquisition,
            Parcours, Offres &amp; tests et Rétention (par cohorte
            d&apos;acquisition). Santé produit et Fiabilité restent sur toute la
            profondeur disponible.
          </span>
        </p>
      </div>

      {/* L'agrégat PRODUIT porte la structure de la page (onglets, série
          quotidienne) : s'il manque, il n'y a pas de demi-page à montrer. On
          distingue tout de même « pas encore arrivé » de « n'a pas pu se
          lire » — un squelette éternel est le pire des deux écrans. */}
      {analyticsQ.status === "error" ? (
        <HubNotice className="border-amber-200 bg-amber-50/70 text-amber-900">
          <strong>Les données produit n&apos;ont pas pu être chargées.</strong>{" "}
          {analyticsQ.error} Les autres pages restent accessibles ; réessaie dans
          un instant.
        </HubNotice>
      ) : analytics === undefined ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          {!analytics.configured ? (
            <HubNotice>
              <strong>PostHog n&apos;est pas configuré sur ce projet.</strong>{" "}
              Aucun appel n&apos;est effectué et les cartes produit restent vides.
              L&apos;acquisition (vues, coûts, jours solo) fonctionne malgré tout :
              elle vient de Jarvia.
            </HubNotice>
          ) : null}
          {/* Un agrégat qui n'a pas pu se lire — la page ne meurt plus avec lui
              (cf useProjectQuerySafe), mais elle doit DIRE ce qui manque. */}
          {agregatsEnEchec.length > 0 ? (
            <HubNotice className="border-amber-200 bg-amber-50/70 text-amber-900">
              <strong>
                {agregatsEnEchec.length === 1
                  ? "Un agrégat n'a pas pu être chargé"
                  : `${agregatsEnEchec.length} agrégats n'ont pas pu être chargés`}
                {" : "}
                {agregatsEnEchec.map(([nom]) => nom).join(", ")}.
              </strong>{" "}
              Les cartes qui en dépendent affichent un tiret ; le reste de la
              page est à jour. Détail : {agregatsEnEchec[0][1].error}
            </HubNotice>
          ) : null}
          {analytics.errors.length > 0 ? (
            <HubNotice className="border-red-200 bg-red-50/60 text-red-900">
              Dernière synchronisation partielle —{" "}
              {analytics.errors.map((e) => e.key).join(", ")}. Les valeurs affichées
              peuvent dater de la synchro précédente.
            </HubNotice>
          ) : null}

          <Tabs defaultValue="overview">
            <TabsList className="flex-wrap">
              <TabsTrigger value="overview">
                <BarChart3Icon className="size-4" />
                Vue d&apos;ensemble
              </TabsTrigger>
              <TabsTrigger value="parcours">
                <RouteIcon className="size-4" />
                Parcours
              </TabsTrigger>
              <TabsTrigger value="acquisition">
                <TargetIcon className="size-4" />
                Acquisition
              </TabsTrigger>
              <TabsTrigger value="sante">
                <ActivityIcon className="size-4" />
                Santé produit
              </TabsTrigger>
              <TabsTrigger value="offres">
                <FlaskConicalIcon className="size-4" />
                Offres &amp; tests
              </TabsTrigger>
              <TabsTrigger value="retention">
                <RepeatIcon className="size-4" />
                Rétention
              </TabsTrigger>
              <TabsTrigger value="pays">
                <GlobeIcon className="size-4" />
                Pays
              </TabsTrigger>
              <TabsTrigger value="fiabilite">
                <ShieldCheckIcon className="size-4" />
                Fiabilité
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
              <OverviewTab
                analytics={analytics}
                revenue={revenue}
                reliability={reliability}
                attribution={attribution}
                viewCounters={viewCounters}
                dayDetail={dayDetail}
                window={effectiveWindow}
                dataRange={dataRange}
                now={now}
              />
            </TabsContent>

            <TabsContent value="parcours" className="mt-6">
              {analytics.configured ? (
                <ParcoursTab
                  analytics={analytics}
                  reliability={reliability}
                  billing={billing}
                  windowed={windowedAnalytics}
                  now={now}
                />
              ) : (
                <NotConfigured />
              )}
            </TabsContent>

            <TabsContent value="acquisition" className="mt-6">
              {attribution === undefined ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <AcquisitionTab
                  attribution={windowedAttr ?? attribution}
                  viewCounters={viewCounters}
                  natureRewards={natureRewards}
                  revenueCurrency={revenue?.currency}
                />
              )}
            </TabsContent>

            <TabsContent value="sante" className="mt-6">
              {analytics.configured ? (
                <SanteProduitTab analytics={analytics} />
              ) : (
                <NotConfigured />
              )}
            </TabsContent>

            <TabsContent value="offres" className="mt-6">
              <OffresTab
                analytics={analytics}
                revenue={revenue}
                attribution={attribution}
                windowed={windowedAnalytics}
                now={now}
              />
            </TabsContent>

            <TabsContent value="retention" className="mt-6">
              {churn === undefined ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <RetentionTab
                  // Fenêtrée À NOUVEAU, mais seulement parce que `churn` l'est
                  // aussi désormais, sur la MÊME période : les deux côtés du
                  // coût par client portent enfin sur la même population. La
                  // garde de lib/retention-cost vérifie que les deux fenêtres
                  // coïncident et rend un tiret sinon.
                  attribution={windowedAttr ?? attribution}
                  churn={churn}
                  clientWindow={window}
                  dataRange={dataRange}
                  now={now}
                />
              )}
            </TabsContent>

            <TabsContent value="pays" className="mt-6">
              <PaysTab
                pnl={marketPnlQ.data}
                traffic={
                  windowedAnalytics.data?.funnels.countryPersons ??
                  analytics?.funnels.countryPersons
                }
                error={marketPnlQ.error}
              />
            </TabsContent>

            <TabsContent value="fiabilite" className="mt-6">
              {reliability === undefined ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <FiabiliteTab reliability={reliability} now={now} />
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function NotConfigured() {
  return (
    <HubEmptyState
      icon={SettingsIcon}
      title="PostHog non configuré"
      description="Relie ce projet à son projet PostHog pour alimenter les métriques produit (posthogSync:setPosthogConfigBySlug). Tant que la configuration est absente, aucun appel n'est effectué."
    />
  );
}

/**
 * Garde d'écran : business.read. Le menu ne propose plus cette page à qui n'a pas le
 * bloc, mais son URL répond toujours — sans cette enveloppe, y arriver par un
 * favori déclenche les queries de la page, qui lèvent, et on lit une erreur
 * technique au lieu d'une phrase.
 *
 * ⚠️ Ce n'est PAS la barrière : le serveur refuse déjà chaque appel.
 */
export default function AnalyticsPage() {
  return (
    <PermissionGate bloc="business.read">
      <AnalyticsPageContenu />
    </PermissionGate>
  );
}
