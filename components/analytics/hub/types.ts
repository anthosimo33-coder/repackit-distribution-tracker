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
