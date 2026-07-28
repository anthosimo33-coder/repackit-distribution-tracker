"use client";

import { useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { convexErrorMessage } from "@/lib/convex-error";
import {
  ActivityIcon,
  BarChart3Icon,
  FlaskConicalIcon,
  Loader2Icon,
  RefreshCwIcon,
  RouteIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TargetIcon,
} from "lucide-react";
import { OverviewTab } from "@/components/analytics/hub/OverviewTab";
import { ParcoursTab } from "@/components/analytics/hub/ParcoursTab";
import { AcquisitionTab } from "@/components/analytics/hub/AcquisitionTab";
import { SanteProduitTab } from "@/components/analytics/hub/SanteProduitTab";
import { OffresTab } from "@/components/analytics/hub/OffresTab";
import { FiabiliteTab } from "@/components/analytics/hub/FiabiliteTab";
import { HubEmptyState, HubNotice } from "@/components/analytics/hub/HubPrimitives";

/**
 * HUB ANALYTICS (ADMIN) — données PRODUIT, distinct des surfaces créateurs.
 * Structure en 6 onglets (maquette v3) : Vue d'ensemble, Parcours, Acquisition,
 * Santé produit, Offres & tests, Fiabilité. Chaque carte AFFICHE les agrégats de
 * la phase A ; elle ne calcule pas. Jamais un 0 trompeur — un tiret et la raison.
 */

const PERIODS = [
  { key: 7, label: "7 jours" },
  { key: 30, label: "30 jours" },
  { key: 90, label: "90 jours" },
] as const;

export default function AnalyticsPage() {
  const analytics = useProjectQuery(api.posthogSync.getProductAnalytics, {});
  const attribution = useProjectQuery(api.analyticsHub.getAttribution, {});
  const revenue = useProjectQuery(api.analyticsHub.getRevenueBreakdown, {});
  const reliability = useProjectQuery(api.analyticsHub.getReliability, {});
  const viewCounters = useProjectQuery(api.analyticsHub.getViewCounters, {});
  const requestSync = useProjectMutation(api.posthogSync.requestPosthogSync);
  const [syncing, setSyncing] = useState(false);
  const [periodDays, setPeriodDays] = useState<number>(90);
  const [now] = useState(() => Date.now());

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
      </header>

      {/* Sélecteur de période global (B4) — filtre les KPI de conversion. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            Période
          </span>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriodDays(p.key)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                periodDays === p.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400">
          Conversions ancrées sur l&apos;inscription · revenu sur le paiement · vues
          sur la publication.
        </p>
      </div>

      {analytics === undefined ? (
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
                periodDays={periodDays}
              />
            </TabsContent>

            <TabsContent value="parcours" className="mt-6">
              {analytics.configured ? (
                <ParcoursTab analytics={analytics} reliability={reliability} />
              ) : (
                <NotConfigured />
              )}
            </TabsContent>

            <TabsContent value="acquisition" className="mt-6">
              {attribution === undefined ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <AcquisitionTab attribution={attribution} viewCounters={viewCounters} />
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
              <OffresTab analytics={analytics} revenue={revenue} />
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
