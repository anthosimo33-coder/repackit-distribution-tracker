/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as assignments from "../assignments.js";
import type * as auth from "../auth.js";
import type * as comptes from "../comptes.js";
import type * as creators from "../creators.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as filterPresets from "../filterPresets.js";
import type * as folders from "../folders.js";
import type * as formats from "../formats.js";
import type * as functions from "../functions.js";
import type * as guide from "../guide.js";
import type * as hooks from "../hooks.js";
import type * as http from "../http.js";
import type * as icps from "../icps.js";
import type * as inspirations from "../inspirations.js";
import type * as maintenance from "../maintenance.js";
import type * as metricSnapshots from "../metricSnapshots.js";
import type * as metricsDisplay from "../metricsDisplay.js";
import type * as migrations from "../migrations.js";
import type * as payments from "../payments.js";
import type * as personnes from "../personnes.js";
import type * as projects from "../projects.js";
import type * as publications from "../publications.js";
import type * as scriptAnalytics from "../scriptAnalytics.js";
import type * as scriptDecision from "../scriptDecision.js";
import type * as scriptSeedData from "../scriptSeedData.js";
import type * as scripts from "../scripts.js";
import type * as snapshotMatching from "../snapshotMatching.js";
import type * as storage from "../storage.js";
import type * as warmup from "../warmup.js";
import type * as youtubeApi from "../youtubeApi.js";
import type * as youtubeSync from "../youtubeSync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  assignments: typeof assignments;
  auth: typeof auth;
  comptes: typeof comptes;
  creators: typeof creators;
  crons: typeof crons;
  dashboard: typeof dashboard;
  filterPresets: typeof filterPresets;
  folders: typeof folders;
  formats: typeof formats;
  functions: typeof functions;
  guide: typeof guide;
  hooks: typeof hooks;
  http: typeof http;
  icps: typeof icps;
  inspirations: typeof inspirations;
  maintenance: typeof maintenance;
  metricSnapshots: typeof metricSnapshots;
  metricsDisplay: typeof metricsDisplay;
  migrations: typeof migrations;
  payments: typeof payments;
  personnes: typeof personnes;
  projects: typeof projects;
  publications: typeof publications;
  scriptAnalytics: typeof scriptAnalytics;
  scriptDecision: typeof scriptDecision;
  scriptSeedData: typeof scriptSeedData;
  scripts: typeof scripts;
  snapshotMatching: typeof snapshotMatching;
  storage: typeof storage;
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
