/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountPhase from "../accountPhase.js";
import type * as adminRecovery from "../adminRecovery.js";
import type * as analyticsContract from "../analyticsContract.js";
import type * as analyticsHub from "../analyticsHub.js";
import type * as angleFamily from "../angleFamily.js";
import type * as apifyApi from "../apifyApi.js";
import type * as apifyItem from "../apifyItem.js";
import type * as apifySync from "../apifySync.js";
import type * as assets from "../assets.js";
import type * as assetsMigration from "../assetsMigration.js";
import type * as assignments from "../assignments.js";
import type * as auth from "../auth.js";
import type * as calendarStatus from "../calendarStatus.js";
import type * as clipQuota from "../clipQuota.js";
import type * as clipperAssignmentFields from "../clipperAssignmentFields.js";
import type * as clipperReadiness from "../clipperReadiness.js";
import type * as cloudflareStream from "../cloudflareStream.js";
import type * as cloudflareStreamApi from "../cloudflareStreamApi.js";
import type * as comptes from "../comptes.js";
import type * as conversionAttribution from "../conversionAttribution.js";
import type * as conversionSync from "../conversionSync.js";
import type * as countries from "../countries.js";
import type * as creatorAssignmentFields from "../creatorAssignmentFields.js";
import type * as creatorVideos from "../creatorVideos.js";
import type * as creators from "../creators.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as dashboardDecisions from "../dashboardDecisions.js";
import type * as dateFr from "../dateFr.js";
import type * as decisionThresholds from "../decisionThresholds.js";
import type * as decisions from "../decisions.js";
import type * as demoMultiProject from "../demoMultiProject.js";
import type * as demoSeed from "../demoSeed.js";
import type * as emailApi from "../emailApi.js";
import type * as emails from "../emails.js";
import type * as fileDrop from "../fileDrop.js";
import type * as filterPresets from "../filterPresets.js";
import type * as folders from "../folders.js";
import type * as formats from "../formats.js";
import type * as functions from "../functions.js";
import type * as googleDriveApi from "../googleDriveApi.js";
import type * as graduation from "../graduation.js";
import type * as guide from "../guide.js";
import type * as guideModules from "../guideModules.js";
import type * as handleHygiene from "../handleHygiene.js";
import type * as hookAvailability from "../hookAvailability.js";
import type * as hooks from "../hooks.js";
import type * as http from "../http.js";
import type * as i18n from "../i18n.js";
import type * as icps from "../icps.js";
import type * as inspirationThumbnails from "../inspirationThumbnails.js";
import type * as inspirations from "../inspirations.js";
import type * as internalAccounts from "../internalAccounts.js";
import type * as maintenance from "../maintenance.js";
import type * as metricSnapshots from "../metricSnapshots.js";
import type * as metricsDisplay from "../metricsDisplay.js";
import type * as migrations from "../migrations.js";
import type * as modelVideoEmbeds from "../modelVideoEmbeds.js";
import type * as nightlyViewsSync from "../nightlyViewsSync.js";
import type * as notificationEvents from "../notificationEvents.js";
import type * as notificationMessage from "../notificationMessage.js";
import type * as notificationWindow from "../notificationWindow.js";
import type * as notifications from "../notifications.js";
import type * as notifyApi from "../notifyApi.js";
import type * as opsDigest from "../opsDigest.js";
import type * as passwordReset from "../passwordReset.js";
import type * as payCycle from "../payCycle.js";
import type * as payments from "../payments.js";
import type * as personnes from "../personnes.js";
import type * as postUrlDate from "../postUrlDate.js";
import type * as postUrlResolution from "../postUrlResolution.js";
import type * as postWindow from "../postWindow.js";
import type * as posthogApi from "../posthogApi.js";
import type * as posthogSync from "../posthogSync.js";
import type * as pricing from "../pricing.js";
import type * as pricingSnapshotMigration from "../pricingSnapshotMigration.js";
import type * as profitability from "../profitability.js";
import type * as progression from "../progression.js";
import type * as projects from "../projects.js";
import type * as provisionAdmin from "../provisionAdmin.js";
import type * as publicationLateness from "../publicationLateness.js";
import type * as publications from "../publications.js";
import type * as radar from "../radar.js";
import type * as radarApi from "../radarApi.js";
import type * as remunerate from "../remunerate.js";
import type * as roles from "../roles.js";
import type * as rushScriptEligibility from "../rushScriptEligibility.js";
import type * as rushStatus from "../rushStatus.js";
import type * as rushes from "../rushes.js";
import type * as scriptAnalytics from "../scriptAnalytics.js";
import type * as scriptDecision from "../scriptDecision.js";
import type * as scriptSeedData from "../scriptSeedData.js";
import type * as scriptTier from "../scriptTier.js";
import type * as scripts from "../scripts.js";
import type * as snapshotMatching from "../snapshotMatching.js";
import type * as snytchDrive from "../snytchDrive.js";
import type * as soloDays from "../soloDays.js";
import type * as storage from "../storage.js";
import type * as storageCleanup from "../storageCleanup.js";
import type * as syncScope from "../syncScope.js";
import type * as talentBriefFields from "../talentBriefFields.js";
import type * as talentRushFields from "../talentRushFields.js";
import type * as trackerData from "../trackerData.js";
import type * as viewCounters from "../viewCounters.js";
import type * as viewsDaily from "../viewsDaily.js";
import type * as warmup from "../warmup.js";
import type * as warmupMode from "../warmupMode.js";
import type * as whopApi from "../whopApi.js";
import type * as whopNotifyTriggers from "../whopNotifyTriggers.js";
import type * as whopPaymentsAccess from "../whopPaymentsAccess.js";
import type * as whopRevenue from "../whopRevenue.js";
import type * as whopSync from "../whopSync.js";
import type * as youtubeApi from "../youtubeApi.js";
import type * as youtubeChannel from "../youtubeChannel.js";
import type * as youtubeSync from "../youtubeSync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountPhase: typeof accountPhase;
  adminRecovery: typeof adminRecovery;
  analyticsContract: typeof analyticsContract;
  analyticsHub: typeof analyticsHub;
  angleFamily: typeof angleFamily;
  apifyApi: typeof apifyApi;
  apifyItem: typeof apifyItem;
  apifySync: typeof apifySync;
  assets: typeof assets;
  assetsMigration: typeof assetsMigration;
  assignments: typeof assignments;
  auth: typeof auth;
  calendarStatus: typeof calendarStatus;
  clipQuota: typeof clipQuota;
  clipperAssignmentFields: typeof clipperAssignmentFields;
  clipperReadiness: typeof clipperReadiness;
  cloudflareStream: typeof cloudflareStream;
  cloudflareStreamApi: typeof cloudflareStreamApi;
  comptes: typeof comptes;
  conversionAttribution: typeof conversionAttribution;
  conversionSync: typeof conversionSync;
  countries: typeof countries;
  creatorAssignmentFields: typeof creatorAssignmentFields;
  creatorVideos: typeof creatorVideos;
  creators: typeof creators;
  crons: typeof crons;
  dashboard: typeof dashboard;
  dashboardDecisions: typeof dashboardDecisions;
  dateFr: typeof dateFr;
  decisionThresholds: typeof decisionThresholds;
  decisions: typeof decisions;
  demoMultiProject: typeof demoMultiProject;
  demoSeed: typeof demoSeed;
  emailApi: typeof emailApi;
  emails: typeof emails;
  fileDrop: typeof fileDrop;
  filterPresets: typeof filterPresets;
  folders: typeof folders;
  formats: typeof formats;
  functions: typeof functions;
  googleDriveApi: typeof googleDriveApi;
  graduation: typeof graduation;
  guide: typeof guide;
  guideModules: typeof guideModules;
  handleHygiene: typeof handleHygiene;
  hookAvailability: typeof hookAvailability;
  hooks: typeof hooks;
  http: typeof http;
  i18n: typeof i18n;
  icps: typeof icps;
  inspirationThumbnails: typeof inspirationThumbnails;
  inspirations: typeof inspirations;
  internalAccounts: typeof internalAccounts;
  maintenance: typeof maintenance;
  metricSnapshots: typeof metricSnapshots;
  metricsDisplay: typeof metricsDisplay;
  migrations: typeof migrations;
  modelVideoEmbeds: typeof modelVideoEmbeds;
  nightlyViewsSync: typeof nightlyViewsSync;
  notificationEvents: typeof notificationEvents;
  notificationMessage: typeof notificationMessage;
  notificationWindow: typeof notificationWindow;
  notifications: typeof notifications;
  notifyApi: typeof notifyApi;
  opsDigest: typeof opsDigest;
  passwordReset: typeof passwordReset;
  payCycle: typeof payCycle;
  payments: typeof payments;
  personnes: typeof personnes;
  postUrlDate: typeof postUrlDate;
  postUrlResolution: typeof postUrlResolution;
  postWindow: typeof postWindow;
  posthogApi: typeof posthogApi;
  posthogSync: typeof posthogSync;
  pricing: typeof pricing;
  pricingSnapshotMigration: typeof pricingSnapshotMigration;
  profitability: typeof profitability;
  progression: typeof progression;
  projects: typeof projects;
  provisionAdmin: typeof provisionAdmin;
  publicationLateness: typeof publicationLateness;
  publications: typeof publications;
  radar: typeof radar;
  radarApi: typeof radarApi;
  remunerate: typeof remunerate;
  roles: typeof roles;
  rushScriptEligibility: typeof rushScriptEligibility;
  rushStatus: typeof rushStatus;
  rushes: typeof rushes;
  scriptAnalytics: typeof scriptAnalytics;
  scriptDecision: typeof scriptDecision;
  scriptSeedData: typeof scriptSeedData;
  scriptTier: typeof scriptTier;
  scripts: typeof scripts;
  snapshotMatching: typeof snapshotMatching;
  snytchDrive: typeof snytchDrive;
  soloDays: typeof soloDays;
  storage: typeof storage;
  storageCleanup: typeof storageCleanup;
  syncScope: typeof syncScope;
  talentBriefFields: typeof talentBriefFields;
  talentRushFields: typeof talentRushFields;
  trackerData: typeof trackerData;
  viewCounters: typeof viewCounters;
  viewsDaily: typeof viewsDaily;
  warmup: typeof warmup;
  warmupMode: typeof warmupMode;
  whopApi: typeof whopApi;
  whopNotifyTriggers: typeof whopNotifyTriggers;
  whopPaymentsAccess: typeof whopPaymentsAccess;
  whopRevenue: typeof whopRevenue;
  whopSync: typeof whopSync;
  youtubeApi: typeof youtubeApi;
  youtubeChannel: typeof youtubeChannel;
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
