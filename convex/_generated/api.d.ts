/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as comptes from "../comptes.js";
import type * as dashboard from "../dashboard.js";
import type * as filterPresets from "../filterPresets.js";
import type * as folders from "../folders.js";
import type * as functions from "../functions.js";
import type * as hooks from "../hooks.js";
import type * as http from "../http.js";
import type * as icps from "../icps.js";
import type * as inspirations from "../inspirations.js";
import type * as maintenance from "../maintenance.js";
import type * as metricSnapshots from "../metricSnapshots.js";
import type * as metricsDisplay from "../metricsDisplay.js";
import type * as personnes from "../personnes.js";
import type * as publications from "../publications.js";
import type * as snapshotMatching from "../snapshotMatching.js";
import type * as storage from "../storage.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  comptes: typeof comptes;
  dashboard: typeof dashboard;
  filterPresets: typeof filterPresets;
  folders: typeof folders;
  functions: typeof functions;
  hooks: typeof hooks;
  http: typeof http;
  icps: typeof icps;
  inspirations: typeof inspirations;
  maintenance: typeof maintenance;
  metricSnapshots: typeof metricSnapshots;
  metricsDisplay: typeof metricsDisplay;
  personnes: typeof personnes;
  publications: typeof publications;
  snapshotMatching: typeof snapshotMatching;
  storage: typeof storage;
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
