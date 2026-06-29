/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminRecovery from "../adminRecovery.js";
import type * as apifyApi from "../apifyApi.js";
import type * as apifySync from "../apifySync.js";
import type * as assets from "../assets.js";
import type * as assignments from "../assignments.js";
import type * as auth from "../auth.js";
import type * as cloudflareStream from "../cloudflareStream.js";
import type * as cloudflareStreamApi from "../cloudflareStreamApi.js";
import type * as comptes from "../comptes.js";
import type * as creators from "../creators.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as demoMultiProject from "../demoMultiProject.js";
import type * as demoSeed from "../demoSeed.js";
import type * as filterPresets from "../filterPresets.js";
import type * as folders from "../folders.js";
import type * as formats from "../formats.js";
import type * as functions from "../functions.js";
import type * as guide from "../guide.js";
import type * as guideModules from "../guideModules.js";
import type * as hooks from "../hooks.js";
import type * as http from "../http.js";
import type * as icps from "../icps.js";
import type * as inspirationThumbnails from "../inspirationThumbnails.js";
import type * as inspirations from "../inspirations.js";
import type * as maintenance from "../maintenance.js";
import type * as metricSnapshots from "../metricSnapshots.js";
import type * as metricsDisplay from "../metricsDisplay.js";
import type * as migrations from "../migrations.js";
import type * as modelVideoEmbeds from "../modelVideoEmbeds.js";
import type * as passwordReset from "../passwordReset.js";
import type * as payments from "../payments.js";
import type * as personnes from "../personnes.js";
import type * as postUrlResolution from "../postUrlResolution.js";
import type * as pricing from "../pricing.js";
import type * as projects from "../projects.js";
import type * as provisionAdmin from "../provisionAdmin.js";
import type * as publications from "../publications.js";
import type * as radar from "../radar.js";
import type * as radarApi from "../radarApi.js";
import type * as scriptAnalytics from "../scriptAnalytics.js";
import type * as scriptDecision from "../scriptDecision.js";
import type * as scriptSeedData from "../scriptSeedData.js";
import type * as scriptTier from "../scriptTier.js";
import type * as scripts from "../scripts.js";
import type * as snapshotMatching from "../snapshotMatching.js";
import type * as storage from "../storage.js";
import type * as trackerData from "../trackerData.js";
import type * as warmup from "../warmup.js";
import type * as youtubeApi from "../youtubeApi.js";
import type * as youtubeSync from "../youtubeSync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminRecovery: typeof adminRecovery;
  apifyApi: typeof apifyApi;
  apifySync: typeof apifySync;
  assets: typeof assets;
  assignments: typeof assignments;
  auth: typeof auth;
  cloudflareStream: typeof cloudflareStream;
  cloudflareStreamApi: typeof cloudflareStreamApi;
  comptes: typeof comptes;
  creators: typeof creators;
  crons: typeof crons;
  dashboard: typeof dashboard;
  demoMultiProject: typeof demoMultiProject;
  demoSeed: typeof demoSeed;
  filterPresets: typeof filterPresets;
  folders: typeof folders;
  formats: typeof formats;
  functions: typeof functions;
  guide: typeof guide;
  guideModules: typeof guideModules;
  hooks: typeof hooks;
  http: typeof http;
  icps: typeof icps;
  inspirationThumbnails: typeof inspirationThumbnails;
  inspirations: typeof inspirations;
  maintenance: typeof maintenance;
  metricSnapshots: typeof metricSnapshots;
  metricsDisplay: typeof metricsDisplay;
  migrations: typeof migrations;
  modelVideoEmbeds: typeof modelVideoEmbeds;
  passwordReset: typeof passwordReset;
  payments: typeof payments;
  personnes: typeof personnes;
  postUrlResolution: typeof postUrlResolution;
  pricing: typeof pricing;
  projects: typeof projects;
  provisionAdmin: typeof provisionAdmin;
  publications: typeof publications;
  radar: typeof radar;
  radarApi: typeof radarApi;
  scriptAnalytics: typeof scriptAnalytics;
  scriptDecision: typeof scriptDecision;
  scriptSeedData: typeof scriptSeedData;
  scriptTier: typeof scriptTier;
  scripts: typeof scripts;
  snapshotMatching: typeof snapshotMatching;
  storage: typeof storage;
  trackerData: typeof trackerData;
  warmup: typeof warmup;
  youtubeApi: typeof youtubeApi;
  youtubeSync: typeof youtubeSync;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
