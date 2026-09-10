import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

/**
 * Types de données du hub, DÉRIVÉS des queries Convex (jamais redéclarés à la
 * main) : le handler serveur annote son retour, `FunctionReturnType` le propage
 * jusqu'aux composants. Une évolution de forme côté convex casse le build ici
 * plutôt qu'en production.
 */
export type ProductAnalyticsData = FunctionReturnType<
  typeof api.posthogSync.getProductAnalytics
>;
export type AttributionData = FunctionReturnType<
  typeof api.analyticsHub.getAttribution
>;
export type RevenueData = FunctionReturnType<
  typeof api.analyticsHub.getRevenueBreakdown
>;
export type ReliabilityData = FunctionReturnType<
  typeof api.analyticsHub.getReliability
>;
export type ViewCountersData = FunctionReturnType<
  typeof api.analyticsHub.getViewCounters
>;
export type NatureRewardsData = FunctionReturnType<
  typeof api.analyticsHub.getNatureRewards
>;
export type ChurnData = FunctionReturnType<typeof api.analyticsHub.getChurn>;

/** Détail dépliable d'une journée — pays, refs, décomposition du revenu. */
export type DayDetailData = FunctionReturnType<
  typeof api.analyticsHub.getDayDetail
>;

/** Ventes agrégées par pays de FACTURATION (Whop) — jamais de connexion. */
export type BillingCountriesData = FunctionReturnType<
  typeof api.analyticsHub.getBillingCountries
>;
