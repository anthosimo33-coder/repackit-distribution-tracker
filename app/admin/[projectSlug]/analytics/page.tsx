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
import { convexErrorMessage } from "@/lib/convex-error";
import {
  BarChart3Icon,
  CreditCardIcon,
  LayersIcon,
  Link2Icon,
  Loader2Icon,
  RefreshCwIcon,
  SettingsIcon,
} from "lucide-react";
import { OverviewTab } from "@/components/analytics/hub/OverviewTab";
import { AttributionTab } from "@/components/analytics/hub/AttributionTab";
import { RevenueTab } from "@/components/analytics/hub/RevenueTab";
import { CohortsTab } from "@/components/analytics/hub/CohortsTab";
import { HubEmptyState, HubNotice } from "@/components/analytics/hub/HubPrimitives";

/**
 * HUB ANALYTICS (ADMIN) — données PRODUIT, distinct des surfaces créateurs.
 *
 * Croise trois sources aux disponibilités INDÉPENDANTES :
 *  - Jarvia (posts, vues, coûts) : toujours là → l'onglet Attribution reste
 *    exploitable même sans PostHog ni Whop ;
 *  - PostHog (comportement produit) : cache horaire, « non configuré » sinon ;
 *  - Whop (revenu net déjà ingéré) : alimente l'onglet Revenus.
 *
 * Chaque carte porte son propre état vide : jamais un 0 trompeur, jamais un
 * écran cassé si un événement n'est pas encore émis côté Snytch.
 */
export default function AnalyticsPage() {
  const analytics = useProjectQuery(api.posthogSync.getProductAnalytics, {});
  const attribution = useProjectQuery(api.analyticsHub.getAttribution, {});
  const revenue = useProjectQuery(api.analyticsHub.getRevenueBreakdown, {});
  const requestSync = useProjectMutation(api.posthogSync.requestPosthogSync);
  const [syncing, setSyncing] = useState(false);

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

  const lastSync =
    analytics?.computedAt != null
      ? new Date(analytics.computedAt).toLocaleString("fr-FR", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

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
              {lastSync ? ` Dernière synchro : ${lastSync}.` : ""}
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
              L&apos;onglet Attribution fonctionne malgré tout : ses vues et ses
              coûts viennent de Jarvia.
            </HubNotice>
          ) : null}
          {analytics.errors.length > 0 ? (
            <HubNotice className="border-red-200 bg-red-50/60 text-red-900">
              Dernière synchronisation partielle —{" "}
              {analytics.errors.map((e) => e.key).join(", ")}. Les valeurs
              affichées peuvent dater de la synchro précédente.
            </HubNotice>
          ) : null}

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">
                <BarChart3Icon className="size-4" />
                Vue d&apos;ensemble
              </TabsTrigger>
              <TabsTrigger value="attribution">
                <Link2Icon className="size-4" />
                Attribution
              </TabsTrigger>
              <TabsTrigger value="revenue">
                <CreditCardIcon className="size-4" />
                Revenus
              </TabsTrigger>
              <TabsTrigger value="cohorts">
                <LayersIcon className="size-4" />
                Cohortes
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
              {analytics.configured ? (
                <OverviewTab analytics={analytics} revenue={revenue} />
              ) : (
                <NotConfigured />
              )}
            </TabsContent>

            <TabsContent value="attribution" className="mt-6">
              {attribution === undefined ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <AttributionTab data={attribution} />
              )}
            </TabsContent>

            <TabsContent value="revenue" className="mt-6">
              {revenue === undefined ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <RevenueTab revenue={revenue} attribution={attribution} />
              )}
            </TabsContent>

            <TabsContent value="cohorts" className="mt-6">
              {analytics.configured ? (
                <CohortsTab analytics={analytics} />
              ) : (
                <NotConfigured />
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
