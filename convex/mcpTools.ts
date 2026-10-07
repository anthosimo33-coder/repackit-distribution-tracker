/**
 * OUTILS du serveur MCP Jarvia — lecture seule.
 *
 * Chaque outil lit par le CŒUR de la query de l'écran correspondant
 * (`listComptesCore`, `listCreatorsCore`…), derrière le MÊME bloc de droits
 * (`mcpPermissionQuery`). Claude voit donc exactement ce que la personne verrait
 * dans l'app — ni un champ de plus, ni un calcul différent. Ce module ne fait que
 * RÉDUIRE ces lectures à ce qu'un modèle doit lire : pas d'e-mail, pas de
 * téléphone, pas d'identifiant interne, des dates en jours de Paris.
 *
 * Ajouter un outil : une query interne `mcpPermissionQuery(<bloc de l'écran>)`
 * qui appelle le cœur de l'écran, puis sa déclaration dans `OUTILS` et son cas
 * dans `callTool`.
 */

import { v, ConvexError } from "convex/values";
import { internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mcpPermissionQuery } from "./functions";
import { effectiveStatus, listComptesCore, listComptesSuiviCore } from "./comptes";
import { getDueTotalCore } from "./payments";
import { decisionDashboardCore } from "./dashboardDecisions";
import { dashboardActions } from "./dashboardActions";
import { groupRecentPosts, rateOf, verdictOf } from "./decisions";
import {
  ACCOUNT_ALARM_RUN_LENGTH,
  DEAD_HOOK_MAX_VIEWS,
  DEAD_HOOK_MIN_RUNS,
  OPEN_DOOR_MIN_LIKE_RATE,
  OPEN_DOOR_MIN_VIEWS,
  savesAvailability,
} from "./decisionThresholds";
import { listCreatorActivityCore, listCreatorsCore } from "./creators";
import { creatorPublicationStats } from "./publicationLateness";
import { getProjectProfitabilityCore } from "./profitability";
import { computeRpm, profitabilityReport } from "./profitabilityMath";
import {
  computeDailyBilledViews,
  parisDayKey,
  parisMidnightUtc,
} from "./viewsDaily";
import {
  listTrackerPostsCore,
  minuitParisDe,
  VUES_PERIODE_MAX_JOURS,
  vuesGagneesCore,
} from "./trackerData";
import {
  aggregateByBrick,
  aggregateByCombo,
  gatherCampaignViews,
} from "./scriptAnalytics";
import { buildDecisions, DECISION_THRESHOLD } from "./scriptDecision";
import {
  getAbRevenueForPeriodCore,
  getAttributionCore,
  getBillingCountriesCore,
  getNatureRewardsCore,
  getViewCountersCore,
  getChurnCore,
  getReliabilityCore,
  getRevenueBreakdownCore,
} from "./analyticsHub";
import {
  agregatsFenetre,
  computeDelta,
  DASHBOARD_WHOP_TOLERANCE_ABS,
  DASHBOARD_WHOP_TOLERANCE_PCT,
  ecartDashboardWhop,
  equationUnitaire,
  type AgregatsFenetre,
} from "./unitEconomics";
import { toDisplayAmount, type DisplayAmount } from "./currencyRate";
import {
  ANALYSIS_WINDOW_DAYS,
  COHORT_MIN_CLIENTS,
  computeChurn,
  HORIZON_DAYS,
  MIN_RESOLVED_DUE,
  ratioRevenuCout,
  SAMPLE_THRESHOLD,
  WHOP_WEBHOOK_FIX_MS,
} from "./churn";
import { acquisitionCostPerClient } from "./retentionCost";
import { attributionDaily, windowCosts, windowedAttribution } from "./attributionWindow";
import { readConversionAllTimeCore } from "./conversionSync";
import { getMarketPnlCore } from "./marketPnl";
import { comptaMonthCore, comptaOverviewCore, comptaTreasuryCore } from "./compta";
import { DOMAINES_ECRITURE } from "./mcpWriteDomains";
import { appelerDefaire, NOMS_DEFAIRE, OUTILS_DEFAIRE } from "./mcpDefaire";
import { appelerPropositions, NOMS_PROPOSITIONS, OUTILS_PROPOSITIONS } from "./mcpPropositions";
import { appelerExperiences, NOMS_EXPERIENCES_LECTURE, OUTIL_EXPERIENCES } from "./mcpExperiences";
import { appelerBilan, NOMS_BILAN, OUTIL_BILAN } from "./mcpCoach";
import { appelerConversationsLecture, NOMS_CONVERSATIONS_LECTURE, OUTILS_CONVERSATIONS_LECTURE } from "./mcpConversations";
import { designationDepuis, designationValidator, trouverMission } from "./mcpWritesMissions";
import { ditEntre, instantsDeLaVideo, instantTexte, langueTranscription, lireVignettes, transcription } from "./mcpVideo";
import {
  cloudflareStreamConfig,
  fetchStreamCaptionsVtt,
  fetchStreamDuration,
  generateStreamCaptions,
  listStreamCaptions,
} from "./cloudflareStreamApi";
import { formatPostWindow } from "./postWindow";
import { promptsJarvia } from "./mcpPrompts";
import { collectProjectPaymentRows } from "./payments";
import { regrouperPaiements } from "./paymentsView";
import {
  listAssignmentsCore,
  listPublishedCore,
  listVideoSubmittedCore,
} from "./assignments";
import { countTomorrow, reviewSlot } from "./reviewQueue";
import {
  getChallengeCore,
  listChallengesCore,
  previewChallengeWinnersCore,
} from "./challenges";
import {
  listRadarAccountsCore,
  listRadarVideosCore,
  listTrendHashtagsCore,
  listTrendVideosCore,
} from "./radar";
import { TREND_COUNTRIES } from "./countries";
import {
  firstSearchVerdict,
  frictionStepEmitted,
  isScanFailure,
  MIN_SAMPLE_SIZE,
  SCAN_REASON_LABELS,
  SCAN_RESULT_LABELS,
  scansByReason,
  SEARCH_RESULT_LABELS,
  searchOutcome,
  AB_ARM_LABELS,
  AB_BREAK_LABEL,
  AB_THRESHOLD,
  abArmChecks,
  abArmRows,
  abArmSummary,
  computeConversion,
  natureClosestPct,
  netPerAssigned,
  PAYWALL_TYPE_LABELS,
  paywallTypeRows,
  ratePct,
  SCAN_KIND_LABELS,
  scanCostRows,
  ACTIVATION_SEGMENT_LABELS,
  aggregateActivation,
  APP_TIMEOUT_MS,
  buildCoherenceChecks,
  buildFunnel,
  checkoutByDevice,
  checkoutLoss,
  deviceCoveragePct,
  PARCOURS_FUNNEL_LABELS,
  PARCOURS_REACH_LABELS,
  payDelay,
  posthogOutageDays,
  whopWithoutAppAccess,
  FRESHNESS_SOURCE_LABELS,
  freshnessStaleHours,
  isFreshnessStale,
  NOT_MEASURABLE,
  SERIES_BREAKS,
} from "./analyticsHubMath";
import { coherenceInputsFrom } from "./coherenceInputs";
import {
  calendarStatus,
  isOnPublicationCalendar,
  isSameLocalDay,
  onTimeTally,
  plannedDayKey,
  type CalendarStatus,
} from "./calendarStatus";
import { listMarketGroupsCore } from "./marketGroups";
import { getProductAnalyticsCore, type ProductAnalytics } from "./posthogSync";
import {
  computeWindowedAnalytics,
  type WindowedParcours,
} from "./analyticsWindowed";
import { hogWindowClause } from "./hogWindow";
import { armComparability, attributedOffers, excludedViewers } from "./abOffers";
import { armPurchases, purchaseCoherenceIssues } from "./abPurchases";
import { EXPECTED_PAYWALL_IDS } from "./analyticsContract";
import {
  buildSegmentRows,
  clientCoverage,
  UNKNOWN_SEGMENT,
  type SegmentPayload,
  type SplitRow,
} from "./segmentFunnel";
import { windowToMs } from "./marketWindow";
import { DECISION } from "./marketDecision";
import {
  contexteDevises,
  deriverMarches,
  lignesEtTotaux,
  serieMensuelle,
} from "./marketDerive";
import {
  clampWindow,
  coversEverything,
  dataRangeOf,
  daysUntil,
  previousWindow,
  rowsInWindow,
  shiftDay,
  sumInWindow,
  windowLengthDays,
  type AnalyticsWindow,
} from "./analyticsDates";
import { teamRoleOf } from "./roles";
import {
  ToolError,
  textResult,
  type McpServer,
  type McpTool,
} from "./mcpProtocol";
import { PLATEFORMES, plateformeValidator, type Plateforme } from "./platforms";
import { marcheInactif, offresVendues, postsEssentiels } from "./mcpFormat";
import { texteDeMission } from "./assignmentScriptText";

const jour = (ts: number | null | undefined): string | null =>
  typeof ts === "number" && ts > 0 ? parisDayKey(ts) : null;

/** Un instant en heure de Paris, « AAAA-MM-JJ HH:MM » (fraîcheur d'une synchro). */
const instantParis = (ts: number | null | undefined): string | null =>
  typeof ts === "number" && ts > 0
    ? new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(ts)
    : null;

// ─── Lectures (queries internes, gardées comme l'écran) ─────────────────────

/** Projets où la personne a un rôle d'ÉQUIPE (ou tous, pour un superadmin). */
export const projetsAccessibles = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return [];
    if (user.role === "superadmin") {
      return (await ctx.db.query("projects").collect())
        .map((p) => ({ _id: p._id, slug: p.slug, name: p.name, role: "superadmin" }))
        .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    }
    const acces = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const out = [];
    for (const m of acces) {
      const role = teamRoleOf(m);
      if (role === null) continue; // rôle de portail seul : pas l'app interne
      const p = await ctx.db.get(m.projectId);
      if (p) out.push({ _id: p._id, slug: p.slug, name: p.name, role: role as string });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  },
});

/** Écran Comptes — même lecture (`listComptesCore`), même bloc. */
export const lireComptes = mcpPermissionQuery("accounts.manage")({
  args: {},
  handler: async (ctx) =>
    (await listComptesCore(ctx, {})).map((c) => ({
      handle: c.handle,
      plateforme: c.plateforme,
      pays: c.targetCountry ?? null,
      statut: effectiveStatus(c),
      createatrice: c.creator?.name ?? null,
      gestionnaire: c.personne ? `${c.personne.prenom} ${c.personne.nom}` : null,
      vues: c.perf.vuesCumulees,
      posts: c.perf.nbPublies,
      dernierPost: jour(c.perf.dernierPost),
      url: c.url ?? null,
    })),
});

/** Écran Créateurs — fiche (`listCreatorsCore`) + activité (`listCreatorActivityCore`). */
export const lireCreatrices = mcpPermissionQuery("creators.read")({
  args: {},
  handler: async (ctx) => {
    const fiches = await listCreatorsCore(ctx);
    const activite = new Map(
      (await listCreatorActivityCore(ctx)).map((a) => [a.creatorId, a]),
    );
    return fiches.map((c) => {
      const a = activite.get(c._id);
      return {
        nom: c.name,
        statut: c.status,
        type: c.kind ?? "partner",
        langue: c.locale,
        fuseau: a?.zone ?? c.timezone ?? null,
        comptesActifs: a?.comptes ?? 0,
        publications: a?.publications ?? 0,
        dernierPost: jour(a?.lastPostAt),
        premierPostPaye: jour(c.firstPostAt),
        refLien: c.refSlug ?? null,
      };
    });
  },
});

/** Taux à l'heure par créatrice — même source que l'écran et les notifications. */
export const lirePonctualite = mcpPermissionQuery("content.analytics")({
  args: { du: v.optional(v.string()), au: v.optional(v.string()) },
  handler: async (ctx, args) =>
    (
      await creatorPublicationStats(
        ctx,
        ctx.projectId,
        Date.now(),
        args.du !== undefined && args.au !== undefined ? { du: args.du, au: args.au } : undefined,
      )
    ).map((s) => ({
      createatrice: s.creatorName,
      tauxALHeurePct: s.tally.rate === null ? null : Math.round(s.tally.rate * 100),
      aLHeure: s.tally.onTime,
      enRetard: s.tally.late,
      manques: s.tally.missed,
      aVenir: s.tally.scheduled,
      postsPasses: s.tally.past,
    })),
});

/**
 * Carte Rentabilité (écran Paiements) — même lecture, même bloc. `periode` :
 * revenu de ces jours + plafond et posts rémunérés de chaque vidéo facturée.
 */
export const lireRentabilite = mcpPermissionQuery("business.read")({
  args: { periode: v.optional(v.object({ du: v.string(), au: v.string() })) },
  handler: async (ctx, { periode }) =>
    getProjectProfitabilityCore(ctx, periode ? { periode } : undefined),
});

/**
 * Relevés de vues de posts RÉMUNÉRÉS, antérieurs à leur coupure (J+30 / spark
 * ad) — la matière des vues facturées datées (`rentabilite` sur une période).
 * Même bloc que la carte. Lu par lots depuis l'outil : sur toute la vie du
 * projet, une seule query dépasserait le budget de lectures.
 */
export const lireRelevesFacturables = mcpPermissionQuery("business.read")({
  args: {
    posts: v.array(v.object({ publicationId: v.id("publications"), coupure: v.number() })),
  },
  handler: async (ctx, { posts }) => {
    const out: { publicationId: string; capturedAt: number; vues: number }[] = [];
    for (const { publicationId, coupure } of posts) {
      const snaps = await ctx.db
        .query("metricSnapshots")
        .withIndex("by_publication_and_capturedAt", (q) =>
          q.eq("publicationId", publicationId).lt("capturedAt", coupure),
        )
        .collect();
      for (const s of snaps) {
        // Le lot vient de l'outil, mais un relevé ne sort que de SON projet.
        if (s.projectId !== ctx.projectId) continue;
        out.push({ publicationId: s.publicationId as string, capturedAt: s.capturedAt, vues: s.vues });
      }
    }
    return out;
  },
});

/** Revenu Whop de l'onglet Analytics (Vue d'ensemble, Offres & tests) — même calcul, même bloc. */
export const lireRevenus = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => getRevenueBreakdownCore(ctx),
});

/** Coûts d'attribution de l'onglet Analytics — même calcul, même bloc. */
export const lireAttribution = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => getAttributionCore(ctx),
});

/** Onglet Fiabilité (et garde-fou clients de l'éco unitaire) — même lecture, même bloc. */
export const lireFiabilite = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => getReliabilityCore(ctx),
});

/** Onglet Rétention (cohorte d'acquisition optionnelle) — même calcul, même bloc. */
export const lireRetention = mcpPermissionQuery("business.read")({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, args) => getChurnCore(ctx, args),
});

/** Onglet Pays : rentabilité par marché sur une période — même calcul, même bloc. */
export const lireMarches = mcpPermissionQuery("business.read")({
  args: { from: v.optional(v.number()), to: v.optional(v.number()) },
  handler: async (ctx, args) => getMarketPnlCore(ctx, args),
});

/** Marchés composés (« Balkans » = RS + HR…) — même lecture que l'onglet. */
export const lireGroupesMarches = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => listMarketGroupsCore(ctx),
});

/** Onglet Offres & tests : revenu par bras des abonnements acquis dans une période — même calcul. */
export const lireRevenuBrasPeriode = mcpPermissionQuery("business.read")({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => getAbRevenueForPeriodCore(ctx, args),
});

/** Onglet Parcours : ventes par pays de FACTURATION (Whop) — même calcul, même bloc. */
export const lirePaysFacturation = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => getBillingCountriesCore(ctx),
});

/** Onglet Acquisition : les quatre compteurs de vues — même calcul, même bloc. */
export const lireCompteursVues = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => getViewCountersCore(ctx),
});

/** Onglet Acquisition : récompenses en nature (dû / engagé) — même calcul, même bloc. */
export const lireRecompensesNature = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => getNatureRewardsCore(ctx),
});

/** Onglet Compta : l'exercice (mois par mois, seuils, solde, à récupérer) — même calcul, même bloc. */
export const lireCompta = mcpPermissionQuery("business.read")({
  args: { year: v.number() },
  handler: async (ctx, args) => comptaOverviewCore(ctx, args),
});

/** Onglet Compta : la trésorerie d'aujourd'hui (Whop + comptes relevés − mis de côté) — même calcul. */
export const lireComptaTresorerie = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => comptaTreasuryCore(ctx),
});

/** Onglet Compta : le détail d'un mois (grand livre, virements ventilés, charges) — même calcul. */
export const lireComptaMois = mcpPermissionQuery("business.read")({
  args: { month: v.string() },
  handler: async (ctx, args) => comptaMonthCore(ctx, args),
});

/** Dashboard « Ce que ça a rapporté » : conversion par créatrice (ref) — même lecture, même bloc. */
export const lireConversionCreatrices = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => readConversionAllTimeCore(ctx),
});

/** Dashboard : les comptes suivis (warmups) — même lecture, même bloc. */
export const lireComptesSuivi = mcpPermissionQuery("accounts.manage")({
  args: {},
  handler: async (ctx) => listComptesSuiviCore(ctx),
});

/** Dashboard : les fiches créatrices (type, pour écarter les clippeurs des warmups) — même bloc. */
export const lireFichesCreatrices = mcpPermissionQuery("creators.read")({
  args: {},
  handler: async (ctx) =>
    (await listCreatorsCore(ctx)).map((c) => ({ _id: c._id as string, kind: c.kind ?? null })),
});

/** Dashboard : le total dû (cycles non payés), dans la devise de paie — même calcul, même bloc. */
export const lireTotalDu = mcpPermissionQuery("payments.manage")({
  args: {},
  handler: async (ctx) => ({
    ...(await getDueTotalCore(ctx)),
    payCurrency: (await ctx.db.get(ctx.projectId))?.payCurrency ?? null,
  }),
});

/** Dashboard : « À décider » et les posts des 48 h — même lecture (cache 30 min), même bloc. */
export const lireDecisions = mcpPermissionQuery("content.analytics")({
  args: {},
  handler: async (ctx) => decisionDashboardCore(ctx),
});

/** Agrégats PostHog en cache (trafic par pays) — même lecture que l'onglet. */
export const lireAnalyticsProduit = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => getProductAnalyticsCore(ctx),
});

/** Écran Paiements : les cycles de chaque créatrice — même lecture, même bloc. */
export const lirePaiements = mcpPermissionQuery("payments.manage")({
  args: {},
  handler: async (ctx) => {
    const project = await ctx.db.get(ctx.projectId);
    return {
      payCurrency: project?.payCurrency ?? null,
      rows: await collectProjectPaymentRows(ctx, ctx.projectId),
    };
  },
});

/** Écran Assignments (calendrier) : les livrables planifiés — même lecture, même bloc. */
export const lirePlanning = mcpPermissionQuery("assignments.manage")({
  args: {},
  handler: async (ctx) => listAssignmentsCore(ctx),
});

/** Écran Validation : la file des vidéos à relire et les publications récentes — même bloc. */
export const lireValidation = mcpPermissionQuery("review.manage")({
  args: {},
  handler: async (ctx) => ({
    aRelire: await listVideoSubmittedCore(ctx),
    publiees: await listPublishedCore(ctx),
  }),
});

/**
 * La vidéo SOUMISE d'une mission, et ce qu'elle devait montrer — pour
 * `regarder_video`. Même désignation que les outils d'écriture (créatrice + jour
 * prévu), même bloc que l'écran Validation.
 */
export const lireVideoSoumise = mcpPermissionQuery("review.manage")({
  args: designationValidator,
  handler: async (ctx, d) => {
    const m = await trouverMission(ctx, d, (a) =>
      a.submittedVideoStreamUid || a.submittedVideoStorageId ? null : "aucune vidéo soumise",
    );
    const a = m.a;
    // Hook et CTA ATTENDUS : ceux du script FIGÉ de la mission. La brique sert
    // si le script commence (finit) bien par elle ; sinon — brique modifiée
    // depuis — le premier (dernier) paragraphe du texte figé.
    const script = (await texteDeMission(ctx, a)) ?? null;
    const paragraphes = (script ?? "").split(/\n\s*\n/).map((x) => x.trim()).filter((x) => x !== "");
    const brique = async (id: Id<"scriptBricks"> | undefined) => (id ? ((await ctx.db.get(id))?.content.trim() ?? null) : null);
    const hook = await brique(a.scriptCombo?.hookBrickId);
    const cta = await brique(a.scriptCombo?.ctaBrickId);
    const creatrice = await ctx.db.get(a.creatorId);
    return {
      locale: creatrice?.locale ?? null,
      hookAttendu: hook && script?.trim().startsWith(hook) ? hook : (paragraphes[0] ?? null),
      ctaAttendu: cta && script?.trim().endsWith(cta) ? cta : paragraphes.length > 1 ? paragraphes[paragraphes.length - 1] : null,
      libelle: m.libelle,
      statut: a.status,
      uid: a.submittedVideoStreamUid ?? null,
      streamStatus: a.submittedVideoStreamStatus ?? null,
      script,
      consigne: a.instructions ?? null,
      texteAIncruster: a.overlayText ?? null,
      plage: formatPostWindow(a.postWindow),
      retourPrecedent: a.videoReviewFeedback ?? null,
    };
  },
});

/** Écran Défis : la liste — même lecture, même bloc. */
export const lireDefis = mcpPermissionQuery("challenges.run")({
  args: {},
  handler: async (ctx) => listChallengesCore(ctx),
});

/** Écran Défis : un défi (classement, victoires, vidéos) et qui gagnerait maintenant. */
export const lireDefi = mcpPermissionQuery("challenges.run")({
  args: { id: v.id("challenges") },
  handler: async (ctx, { id }) => ({
    detail: await getChallengeCore(ctx, { id }),
    apercu: await previewChallengeWinnersCore(ctx, { id }),
  }),
});

/** Écran Veille : les comptes suivis — même lecture, même bloc. */
export const lireComptesVeille = mcpPermissionQuery("radar.use")({
  args: {},
  handler: async (ctx) => listRadarAccountsCore(ctx),
});

/** Écran Veille : le mur de vidéos (un compte ou tous). */
export const lireMurVeille = mcpPermissionQuery("radar.use")({
  args: { accountId: v.optional(v.id("radarAccounts")) },
  handler: async (ctx, args) => listRadarVideosCore(ctx, args),
});

/** Écran Veille : les hashtags tendance d'un pays. */
export const lireTendances = mcpPermissionQuery("radar.use")({
  args: { countryCode: v.string() },
  handler: async (ctx, args) => listTrendHashtagsCore(ctx, args),
});

/** Écran Veille : les vidéos d'un hashtag tendance. */
export const lireVideosTendance = mcpPermissionQuery("radar.use")({
  args: { countryCode: v.string(), hashtag: v.string() },
  handler: async (ctx, args) => listTrendVideosCore(ctx, args),
});

/** Courbe « Vues gagnées par jour » du Tracker, sur une période — même bloc. */
export const lireVues = mcpPermissionQuery("content.analytics")({
  args: {
    du: v.string(),
    au: v.string(),
    createatrice: v.optional(v.string()),
    compte: v.optional(v.string()),
    pays: v.optional(v.string()),
    plateforme: v.optional(
      plateformeValidator,
    ),
    warmup: v.optional(
      v.union(v.literal("exclude"), v.literal("all"), v.literal("only")),
    ),
  },
  handler: async (ctx, args) => vuesGagneesCore(ctx, args),
});

/**
 * Liste des posts du Tracker — même lecture (`listTrackerPostsCore`), même
 * bloc. Les filtres par NOM (créatrice, compte, campagne) et par pays sont
 * appliqués ici : l'écran filtre par identifiants, Claude par ce qu'il a lu.
 */
export const lirePosts = mcpPermissionQuery("content.analytics")({
  args: {
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
    plateforme: v.optional(
      plateformeValidator,
    ),
    warmup: v.optional(
      v.union(v.literal("exclude"), v.literal("all"), v.literal("only")),
    ),
    createatrice: v.optional(v.string()),
    compte: v.optional(v.string()),
    campagne: v.optional(v.string()),
    pays: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const plier = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const contient = (valeur: string | null, filtre?: string) =>
      filtre === undefined || plier(valeur ?? "").includes(plier(filtre));
    const paysDuCompte = new Map(
      (
        await ctx.db
          .query("comptes")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect()
      ).map((c) => [`${c.plateforme}|${c.handle}`, c.targetCountry ?? null]),
    );
    const posts = await listTrackerPostsCore(ctx, {
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      warmup: args.warmup,
      ...(args.plateforme ? { plateformes: [args.plateforme] } : {}),
    });
    // Projection EXPLICITE, puis filtres sur ce qu'elle expose : aucun champ
    // du post ne sort sans avoir été nommé ici (cf scripts/check-db-spread).
    return posts
      .map((p) => ({
        titre: p.label,
        compte: p.compte,
        plateforme: p.plateforme,
        pays: paysDuCompte.get(`${p.plateforme}|${p.compte}`) ?? null,
        createatrice: p.creatorName,
        campagne: p.campaignName,
        publieLe: jour(p.datePubli),
        vues: p.vues,
        likes: p.likes,
        commentaires: p.comments,
        saves: p.saves,
        warmup: p.isWarmup,
        url: p.postUrl,
      }))
      .filter(
        (p) =>
          contient(p.createatrice, args.createatrice) &&
          contient(p.compte, args.compte) &&
          contient(p.campagne, args.campagne) &&
          (args.pays === undefined || p.pays === args.pays.trim().toUpperCase()),
      );
  },
});

/**
 * Écran Analytics d'une campagne de scripts — même passe
 * (`gatherCampaignViews`), mêmes verdicts (`buildDecisions`), mêmes
 * agrégats par brique et par combo. Sans campagne : la liste des campagnes.
 */
export const lireScripts = mcpPermissionQuery("content.analytics")({
  args: {
    campagne: v.optional(v.string()),
    fenetre: v.union(v.literal("j3"), v.literal("j7"), v.literal("j14"), v.literal("j30")),
    warmup: v.union(v.literal("exclude"), v.literal("all"), v.literal("only")),
  },
  handler: async (ctx, args) => {
    const plier = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const campagnes = await ctx.db
      .query("scriptCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const assignations = new Map<string, number>();
    for (const a of await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect()) {
      const id = a.scriptCombo?.campaignId as string | undefined;
      if (id) assignations.set(id, (assignations.get(id) ?? 0) + 1);
    }
    const liste = campagnes
      .map((c) => ({
        nom: c.name,
        statut: c.status,
        assignations: assignations.get(c._id as string) ?? 0,
      }))
      .sort((a, b) => b.assignations - a.assignations);
    if (args.campagne === undefined) return { kind: "liste" as const, campagnes: liste };

    const q = plier(args.campagne);
    const exacte = campagnes.filter((c) => plier(c.name) === q);
    const proches = exacte.length > 0 ? exacte : campagnes.filter((c) => plier(c.name).includes(q));
    if (proches.length !== 1) {
      return {
        kind: "ambigu" as const,
        candidates: (proches.length > 0 ? proches : campagnes).map((c) => c.name),
      };
    }
    const campagne = proches[0];
    const vues = await gatherCampaignViews(
      ctx,
      ctx.projectId,
      campagne._id,
      args.fenetre,
      args.warmup,
    );
    return {
      kind: "campagne" as const,
      nom: campagne.name,
      statut: campagne.status,
      decisions: buildDecisions(vues),
      briques: aggregateByBrick(vues),
      combos: aggregateByCombo(vues),
    };
  },
});

// ─── Déclaration des outils ──────────────────────────────────────────────────

const ARG_PROJET = {
  type: "string",
  description:
    "Slug ou nom du projet (ex. « snytch »). Facultatif si la clé n'ouvre qu'un seul projet ; sinon, appelle d'abord `projets`.",
} as const;

const ARG_CREATRICE = {
  type: "string",
  description: "Filtre sur le nom de la créatrice (sous-chaîne, accents ignorés).",
} as const;

export const OUTILS: readonly McpTool[] = [
  {
    name: "projets",
    title: "Projets accessibles",
    description:
      "Liste les projets que cette clé peut lire (slug, nom, rôle). À appeler en premier quand on ne sait pas quel projet viser.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "comptes",
    title: "Comptes du projet",
    description:
      "Comptes TikTok/Instagram/YouTube du projet, comme l'écran Comptes : plateforme, pays ciblé (code ISO), statut (actif, warmup, shadowban, archived), créatrice, vues cumulées, nombre de posts, date du dernier post. Triés par vues décroissantes.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrice: ARG_CREATRICE,
        pays: { type: "string", description: "Code pays ISO à 2 lettres (ex. FR, US, RS)." },
        plateforme: {
          type: "string",
          description: "Plateforme du compte.",
          enum: [...PLATEFORMES],
        },
        statut: {
          type: "string",
          description: "Statut du compte.",
          enum: ["actif", "warmup", "shadowban", "archived"],
        },
        limite: {
          type: "integer",
          description: "Nombre maximum de comptes renvoyés (défaut 100).",
          minimum: 1,
          maximum: 500,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "createatrices",
    title: "Créatrices du projet",
    description:
      "Créatrices du projet, comme l'écran Créateurs : statut (invited, onboarding, active, paused, churned), type (partner, talent, clipper), langue, fuseau, comptes actifs, publications, dernier post. Par défaut, seules les créatrices en activité (ni en pause ni parties).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrice: ARG_CREATRICE,
        inclure_inactives: {
          type: "boolean",
          description: "Inclure les créatrices en pause ou parties (défaut : non).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ponctualite",
    title: "Ponctualité des publications",
    description:
      "Taux de publication à l'heure par créatrice (même calcul que le calendrier et les notifications, dans le fuseau de chaque créatrice) : à l'heure, en retard, manqués, à venir. Par défaut sur tout l'historique du projet, comme l'écran ; avec `du`/`au`, seulement les posts PRÉVUS ces jours-là (« qui était en retard cette semaine »). Une créatrice supprimée garde le nom figé sur ses assignations, suffixé « (supprimée) ». Trié du taux le plus bas au plus haut — pour répondre à « qui est en retard ».",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrice: ARG_CREATRICE,
        du: { type: "string", description: "Posts prévus à partir de ce jour, AAAA-MM-JJ (Paris). Avec « au »." },
        au: { type: "string", description: "Posts prévus jusqu'à ce jour inclus, AAAA-MM-JJ (Paris). Avec « du »." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "rentabilite",
    title: "Rentabilité du projet",
    description:
      "Rentabilité du projet, exactement comme la carte Rentabilité de l'écran Paiements (même calcul) : revenu Whop NET (après frais, devise du revenu), coût créatrices (fixe + CPM + bonus, devise de la paie), MARGE (revenu − coût converti, devise du revenu) et RPM (revenu net pour 1 000 vues). Cumul + détail mois par mois (mois de Paris), du plus récent au plus ancien. Par défaut le RPM « business » divise par les vues FACTURÉES seules ; inclure_non_facturees donne le RPM dilué (toutes les vues suivies). Avec `du`/`au` : le RPM sur N'IMPORTE QUELLE période — revenu encaissé ces jours-là ÷ vues FACTURÉES GAGNÉES ces jours-là (posts rémunérés, dans leur fenêtre J+30, sous le plafond de 150 $ par vidéo), avec le détail par jour (par mois au-delà de 92 jours). Lire les avertissements avant de conclure.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        mois: {
          type: "string",
          description: "Ne garder qu'un mois, au format AAAA-MM (ex. 2026-09).",
        },
        du: {
          type: "string",
          description:
            "Premier jour inclus d'une période libre, AAAA-MM-JJ (défaut si seul `au` est donné : 29 jours avant `au`). Remplace le détail mensuel.",
        },
        au: {
          type: "string",
          description:
            "Dernier jour inclus d'une période libre, AAAA-MM-JJ (défaut si seul `du` est donné : hier, dernier jour complet).",
        },
        inclure_non_facturees: {
          type: "boolean",
          description:
            "Diviser le RPM par toutes les vues suivies (RPM dilué) au lieu des seules vues facturées (défaut : non). Détail mensuel seulement.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "vues",
    title: "Vues gagnées sur une période",
    description:
      "Vues GAGNÉES pendant une période (jours de Paris), par tous les posts du projet quelle que soit leur date de publication — la courbe « Vues gagnées par jour » du Tracker, lue sur ces jours. Répond à « combien de vues Kelly a faites cette semaine ». Une vidéo part de 0 à sa publication : ses premières heures comptent. Total, détail par jour avec la part ESTIMÉE (vues réparties au prorata d'un écart de plus de 30 h entre deux relevés, pas mesurées) et répartition par créatrice, compte, pays ou plateforme. `comparer` ajoute la période précédente de même durée. Par défaut : les 7 derniers jours complets, posts de chauffe exclus (comme le Tracker).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        du: { type: "string", description: "Premier jour inclus, AAAA-MM-JJ (défaut : 6 jours avant `au`)." },
        au: { type: "string", description: "Dernier jour inclus, AAAA-MM-JJ (défaut : hier, dernier jour complet)." },
        createatrice: ARG_CREATRICE,
        compte: { type: "string", description: "Filtre sur le handle du compte (sous-chaîne)." },
        pays: { type: "string", description: "Code pays ISO du compte visé (ex. FR, US, RS)." },
        plateforme: {
          type: "string",
          description: "Plateforme.",
          enum: [...PLATEFORMES],
        },
        warmup: {
          type: "string",
          description: "Posts de chauffe : exclus (défaut, comme le Tracker), inclus, ou seuls.",
          enum: ["exclure", "inclure", "seulement"],
        },
        par: {
          type: "string",
          description: "Répartition renvoyée (défaut : createatrice).",
          enum: ["createatrice", "compte", "pays", "plateforme"],
        },
        comparer: {
          type: "boolean",
          description: "Ajouter la période précédente de même durée, et l'évolution en %.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "meilleurs_posts",
    title: "Meilleurs posts",
    description:
      "Posts du projet classés, comme la liste du Tracker : titre, compte, plateforme, pays du compte, créatrice, campagne de script, date de publication, vues, likes, commentaires, saves, lien. Période = date de PUBLICATION (défaut : les 30 derniers jours). Vues = vues CUMULÉES à ce jour (pas celles d'une période : pour ça, l'outil `vues`). Posts de chauffe exclus par défaut, comme le Tracker.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        du: { type: "string", description: "Publiés à partir de ce jour, AAAA-MM-JJ (défaut : il y a 30 jours)." },
        au: { type: "string", description: "Publiés jusqu'à ce jour inclus, AAAA-MM-JJ (défaut : aujourd'hui)." },
        createatrice: ARG_CREATRICE,
        compte: { type: "string", description: "Filtre sur le handle du compte (sous-chaîne)." },
        campagne: { type: "string", description: "Filtre sur le nom de la campagne de script (sous-chaîne)." },
        pays: { type: "string", description: "Code pays ISO du compte visé (ex. FR, US)." },
        plateforme: { type: "string", description: "Plateforme.", enum: [...PLATEFORMES] },
        warmup: { type: "string", description: "Posts de chauffe : exclus (défaut), inclus, ou seuls.", enum: ["exclure", "inclure", "seulement"] },
        tri: { type: "string", description: "Critère de classement (défaut : vues).", enum: ["vues", "likes", "commentaires", "saves"] },
        ordre: { type: "string", description: "meilleurs (défaut) ou pires d'abord.", enum: ["meilleurs", "pires"] },
        limite: { type: "integer", description: "Nombre de posts renvoyés (défaut 20).", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "scripts",
    title: "Performance des scripts",
    description:
      "Performance des scripts, comme l'écran Analytics d'une campagne. Sans `campagne` : la liste des campagnes (statut, nombre d'assignations). Avec : les VERDICTS par brique (hook, flux, cta) — à pousser, à couper, neutre, ou en test tant qu'elle a moins de 50 posts —, les signaux forts à valider à la main, et les meilleurs combos (hook + flux + cta) par vues médianes. Vues mesurées à J+X après publication (fenêtre, défaut J+7, comme l'écran), posts de chauffe exclus par défaut.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        campagne: { type: "string", description: "Nom de la campagne (sous-chaîne ; appelle sans pour la liste)." },
        fenetre: { type: "string", description: "Vues mesurées à J+3, J+7 (défaut), J+14 ou J+30 après publication.", enum: ["j3", "j7", "j14", "j30"] },
        warmup: { type: "string", description: "Posts de chauffe : exclus (défaut), inclus, ou seuls.", enum: ["exclure", "inclure", "seulement"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "revenus",
    title: "Revenus Whop (Analytics)",
    description:
      "Revenus du projet tels que l'onglet Analytics les montre (Vue d'ensemble, Offres & tests), par le MÊME calcul. Revenu NET Whop (après frais, remboursements déduits, litiges en cours exclus) sur une période en jours de Paris, avec le détail par jour et, au choix, la période précédente de même durée. Sur tout l'historique : le net mois par mois séparé en premier paiement / renouvellement, l'économie par offre (clients, net, LTV réalisée, net par paiement, frais Whop, net par mois-client), les remboursements, les litiges EN COURS avec leur échéance de réponse, le revenu par bras du test A/B et le journal des changements d'offre. Par défaut : les 30 derniers jours complets (jusqu'à hier).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        du: { type: "string", description: "Premier jour de la période, AAAA-MM-JJ (Paris)." },
        au: { type: "string", description: "Dernier jour de la période, AAAA-MM-JJ (Paris). Défaut : hier." },
        comparer: {
          type: "boolean",
          description: "Ajouter la période précédente de même durée (si les données la couvrent entièrement).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "economie_unitaire",
    title: "Économie unitaire (Analytics)",
    description:
      "Rentabilité d'acquisition telle que la Vue d'ensemble de l'onglet Analytics la montre, par le MÊME calcul : marge nette (revenu net Whop − coût créateurs converti), revenu net et coût créateurs sur une période en jours de Paris ; puis par client acquis : revenu par client − coût d'acquisition = marge par client, retour sur acquisition (×), coût complet du moteur (warmup inclus) et vues promo par client. Les chiffres par client sont SUSPENDUS quand l'écart clients PostHog/Whop dépasse le garde-fou, comme à l'écran. `comparer` ajoute la période précédente de même durée avec les évolutions. Par défaut : les 30 derniers jours complets (jusqu'à hier).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        du: { type: "string", description: "Premier jour de la période, AAAA-MM-JJ (Paris)." },
        au: { type: "string", description: "Dernier jour de la période, AAAA-MM-JJ (Paris). Défaut : hier." },
        comparer: {
          type: "boolean",
          description: "Ajouter la période précédente de même durée (si les données la couvrent entièrement).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "retention",
    title: "Rétention (Analytics)",
    description:
      "Rétention des clients, comme l'onglet Rétention de l'Analytics (même calcul) : résiliations (annulé, accès encore valide) et expirations (accès perdu, le vrai churn) sur 90 jours, taux de résiliation, délai paiement → résiliation, clients qui perdront l'accès dans 7 jours ; échéances et taux de renouvellement (résolu / borne basse, concluant ou non), revenu nouveau vs renouvellement, revenu par client à ce jour et projeté, contre le coût d'acquisition ; cohortes par semaine, renouvellement par offre, causes d'échec. Cohorte d'acquisition au choix (du/au) ; sans, toute la profondeur.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        du: { type: "string", description: "Cohorte : clients acquis à partir de ce jour, AAAA-MM-JJ (Paris). Avec « au »." },
        au: { type: "string", description: "Cohorte : clients acquis jusqu'à ce jour inclus, AAAA-MM-JJ (Paris). Avec « du »." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "marches",
    title: "Marchés (Analytics › Pays)",
    description:
      "Rentabilité par marché, comme l'onglet Pays de l'Analytics (même calcul, même verdict) : pour chaque marché (ou pays), le verdict (accélérer, réparer le paiement, surveiller, couper, trop tôt, sans dépense), créatrices et vidéos, coût promo et total, clients, revenu net, coût par client, panier, retour sur acquisition, jour où la valeur rembourse le coût, coût et valeur pour 1 000 vues promo, évolution vs la période précédente, trafic PostHog (visiteurs, checkouts, conversion) et offres vendues ; plus le total et la série par mois. Période en jours de Paris (défaut : 30 derniers jours complets) ; « maille » par marché composé (défaut) ou par pays ; « pays » filtre (code ISO ou nom de marché).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        du: { type: "string", description: "Premier jour, AAAA-MM-JJ (Paris)." },
        au: { type: "string", description: "Dernier jour, AAAA-MM-JJ (Paris). Défaut : hier." },
        maille: { type: "string", description: "Regrouper par marché composé (défaut) ou détailler par pays.", enum: ["marche", "pays"] },
        pays: { type: "string", description: "Ne garder qu'un pays (code ISO, ex. FR) ou un marché (nom, ex. Balkans)." },
        tous_les_marches: {
          type: "boolean",
          description:
            "Lister aussi, un par un, les marchés SANS AUCUNE activité sur la période (ni dépense, ni vidéo, ni vue promo, ni paiement : seul le trafic les fait apparaître). Défaut : non, ils sont résumés dans « marchesSansActivite ».",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "paiements",
    title: "Paiements des créatrices",
    description:
      "Ce qui est dû aux créatrices, comme l'écran Paiements (même regroupement) : le total à verser, le nombre de créatrices et de cycles dus, l'ancienneté du plus vieux cycle dû ; par créatrice, le reste à verser et chaque cycle (dates, valeur, acomptes, reste, détail fixe / CPM / paliers / primes de défi, posts pas encore mesurés) ; celles à zéro ; les derniers cycles réglés. Montants dans la devise de paie. Le moyen de paiement est donné par son type seulement, jamais ses coordonnées.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrice: { type: "string", description: "Filtre sur le nom de la créatrice (sous-chaîne, accents ignorés)." },
        reglees: { type: "integer", description: "Nombre de derniers cycles réglés à inclure (défaut 10, 0 pour aucun).", minimum: 0, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "planning",
    title: "Planning des publications",
    description:
      "Le calendrier des publications, comme l'écran Assignments (même statut, même taux) : ce qui doit sortir AUJOURD'HUI et n'est pas encore publié, les posts MANQUÉS (jour passé, rien de publié), ceux publiés hors date, ce qui est prévu dans les prochains jours, et la ponctualité (à l'heure ÷ posts passés). Chaque post : créatrice, compte, plateforme, pays, jour prévu, campagne ou format. Statut jugé dans le fuseau de la créatrice. Filtre par créatrice.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrice: { type: "string", description: "Filtre sur le nom de la créatrice (sous-chaîne, accents ignorés)." },
        jours: { type: "integer", description: "Horizon du « à venir », en jours après aujourd'hui (défaut 7).", minimum: 1, maximum: 60 },
        limite: { type: "integer", description: "Posts listés au plus par rubrique (défaut 30).", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "validation",
    title: "Vidéos à relire (Validation)",
    description:
      "La file de l'écran Validation : les vidéos soumises par les créatrices, en attente de validation avant publication, dans l'ordre de la file (date de publication prévue), avec leur créneau (en retard, aujourd'hui, DEMAIN, plus tard, sans date) — même règle que l'écran, lue à l'heure de Paris ; puis les publications récentes avec leurs liens. Filtre par créatrice.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrice: { type: "string", description: "Filtre sur le nom de la créatrice (sous-chaîne, accents ignorés)." },
        limite: { type: "integer", description: "Vidéos listées au plus par rubrique (défaut 30).", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "regarder_video",
    title: "Regarder une vidéo soumise",
    description:
      "Les IMAGES CLÉS d'une vidéo soumise par une créatrice (file `validation`) — trois dans les premières secondes (le hook), puis le milieu, les trois quarts et la fin — et ce qui y est DIT (transcription automatique Cloudflare, dans la langue de la créatrice), avec le script attendu, le hook et le CTA attendus, la consigne et le texte à incruster de sa mission, pour comparer. La première fois, la transcription est LANCÉE (gratuite, environ une minute) : rappelle l'outil pour l'avoir. La mission se désigne comme dans `validation` : créatrice + jour prévu (et compte, campagne ou morceau de script si besoin).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        createatrice: { type: "string", description: "Nom de la créatrice, comme dans `validation`." },
        jour: { type: "string", description: "Jour PRÉVU de la mission, AAAA-MM-JJ (Paris), ou « sans date »." },
        compte: { type: "string", description: "Handle du compte visé, pour départager." },
        campagne: { type: "string", description: "Nom de la campagne, pour départager." },
        script: { type: "string", description: "Un morceau du texte du script, pour départager." },
      },
      required: ["createatrice", "jour"],
      additionalProperties: false,
    },
  },
  {
    name: "defis",
    title: "Défis",
    description:
      "Les défis du projet, comme l'écran Défis. Sans « defi » : la liste (statut, objectif de vues, mode cumulé ou meilleure vidéo, échéance, récompense par gagnante, règle de gagnantes, participantes, victoires, terminé ou non). Avec « defi » (nom ou morceau de nom) : son classement (rang, score, vidéos comptées, objectif franchi), ses victoires, qui gagnerait si c'était acté maintenant, et ses vidéos (vues, comptée ou retirée, liens).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        defi: { type: "string", description: "Nom du défi (exact ou morceau) — appelle sans pour la liste." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "veille",
    title: "Veille TikTok",
    description:
      "La veille TikTok du projet, comme l'écran Veille (mêmes lectures, rien n'est relancé). « comptes » (défaut) : les comptes suivis (abonnés, vidéos relevées, dernier relevé). « videos » : le mur — vidéos populaires et récentes d'un compte (« compte ») ou de tous, avec vues, likes, commentaires, partages, engagement, légende, hashtags, lien. « tendances » : les hashtags tendance d'un pays (« pays »), puis les vidéos d'un hashtag (« hashtag »).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        vue: { type: "string", description: "Ce qu'on regarde (défaut : comptes).", enum: ["comptes", "videos", "tendances"] },
        compte: { type: "string", description: "Vue « videos » : le compte suivi (@handle)." },
        pays: { type: "string", description: "Vue « tendances » : code pays ISO (ex. FR, US)." },
        hashtag: { type: "string", description: "Vue « tendances » : un hashtag de la liste, pour ses vidéos." },
        limite: { type: "integer", description: "Éléments listés au plus par rubrique (défaut 20).", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "fiabilite",
    title: "Fiabilité des données (Analytics)",
    description:
      "L'onglet Fiabilité de l'Analytics, par les mêmes contrôles : les contrôles de cohérence (tunnel monotone, clients PostHog vs Whop, recoupement par jour, montant dû…) avec leur état (ok, info, écart) et leur détail ; l'état de chaque événement du contrat d'instrumentation (personnes, première émission, sain / à surveiller / absent) et des propriétés sondées ; les comptes internes exclus ; les abonnements par personne ; ce qui n'est pas mesurable (dont les assignations sans date de post) ; les ruptures de série datées ; la fraîcheur de chaque source (périmée au-delà de son seuil : 12 h pour PostHog et Whop, 30 h pour les vues relevées une fois par nuit). À lire avant de se fier à un chiffre du hub.",
    inputSchema: {
      type: "object",
      properties: { projet: ARG_PROJET },
      additionalProperties: false,
    },
  },
  {
    name: "parcours",
    title: "Parcours de conversion (Analytics)",
    description:
      "L'onglet Parcours de l'Analytics, par les mêmes calculs : le tunnel de conversion séquentiel (ont ouvert le site → se sont inscrits → ont vu l'offre → ont ouvert le checkout → ont payé) avec la perte à chaque étape et l'atteinte brute à côté ; où se perdent les checkouts (détournés vers le gratuit, échec de paiement, disparus) ; la conversion par appareil (navigateur natif / webview) ; le délai jusqu'au paiement ; les paiements Whop sans accès applicatif ; le trafic par pays de connexion et par langue ; les ventes par pays de facturation ; l'activation par type d'inscrit. Recalculé sur la période comme à l'écran (défaut : 30 derniers jours complets, jusqu'à hier).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        du: { type: "string", description: "Premier jour, AAAA-MM-JJ (Paris)." },
        au: { type: "string", description: "Dernier jour, AAAA-MM-JJ (Paris). Défaut : hier." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "offres",
    title: "Offres & tests (Analytics)",
    description:
      "L'onglet Offres & tests de l'Analytics, au-delà du revenu (voir « revenus » pour l'économie par offre, les litiges et le journal), par les mêmes calculs : les types de paywall (bloquant / appoint : exposés, checkouts, payés, complétion, cibles par client) ; le test A/B par bras (assignés, ont vu le paywall, checkouts, nouveaux clients, complétion, cibles par client, net par assigné), son verdict (seuil par bras, recrues manquantes), ses contrôles et les personnes écartées ; les offres servies par bras (plan présélectionné, période, conversion, revenu du 1er cycle pour 1 000 vues) et ce que les clients ont réellement acheté ; la conversion par emplacement de paywall ; le plan gratuit ; le coût des scans. Recalculé sur la période comme à l'écran (défaut : 30 derniers jours complets, jusqu'à hier).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        du: { type: "string", description: "Premier jour, AAAA-MM-JJ (Paris)." },
        au: { type: "string", description: "Dernier jour, AAAA-MM-JJ (Paris). Défaut : hier." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "acquisition",
    title: "Acquisition (Analytics)",
    description:
      "L'onglet Acquisition de l'Analytics, par les mêmes calculs, plus la conversion par créatrice du dashboard : l'efficacité promo par créatrice (vidéos, vues médianes, vidéos au-dessus de 50 000 vues, vues promo) et les jours solo (une seule créatrice a publié : visiteurs, inscrits, clients lui reviennent) sur la période ; les quatre compteurs de vues (totales, payables, promo, paliers — jamais additionnés) ; les récompenses en nature (déjà dû, engagé, coût réel, créatrice la plus proche de chaque palier) ; la conversion par lien de parrainage (visiteurs, inscrits, ventes, revenu net par créatrice ou influenceuse, sans source, total). Période en jours de Paris (défaut : 30 derniers jours complets, jusqu'à hier).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        du: { type: "string", description: "Premier jour, AAAA-MM-JJ (Paris)." },
        au: { type: "string", description: "Dernier jour, AAAA-MM-JJ (Paris). Défaut : hier." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "dashboard",
    title: "Dashboard (accueil)",
    description:
      "Le Dashboard de l'app, par les mêmes calculs : les quatre cartes d'action (vidéos à valider, warmups en retard, warmups terminés à valider, total dû), « À décider » (portes ouvertes à exploiter, hooks à graduer, hooks morts à désactiver, alarmes de compte) et les posts des 48 dernières heures regroupés par créatrice (état du compte, vues, abonnés gagnés, et pour chaque post : vues gagnées sur 24 h, like rate, enregistrements, verdict). Une section dont le rôle n'a pas le bloc est signalée « nonAccessible ».",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        tous_les_posts: {
          type: "boolean",
          description:
            "Posts des 48 h : lister CHAQUE post de chaque créatrice. Défaut : non — les 5 posts déjà relevés les plus vus par créatrice, les autres comptés (« sansReleve », « autresPosts »).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "sante_produit",
    title: "Santé produit (Analytics)",
    description:
      "L'onglet Santé produit de l'Analytics, par les mêmes calculs : la réussite de la première recherche après paiement (payants mesurables, ont cherché, part exploitable, délai, résultats), la fiabilité des scans par déclenchement (taux d'échec, détail par résultat ; le planifié complet détecte les désabonnements), les résultats de recherche (dont les bloqués par le paywall, mesurés ou déduits), la latence des scans par taille de compte, les points de friction (rageclicks par page, par étape d'onboarding si émise). Recalculé sur la période comme à l'écran (défaut : 30 derniers jours complets, jusqu'à hier).",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        du: { type: "string", description: "Premier jour, AAAA-MM-JJ (Paris)." },
        au: { type: "string", description: "Dernier jour, AAAA-MM-JJ (Paris). Défaut : hier." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "compta",
    title: "Compta (exercice et mois)",
    description:
      "L'onglet Compta, par les mêmes calculs. L'exercice : par mois de Paris, le grand livre Whop (CA brut encaissé, remboursements, litiges, frais Whop, net Whop), les charges — créatrices au jour du VERSEMENT (converties), scans (paiements RÉELS au fournisseur s'il y en a ce mois, sinon l'estimation cost_usd), autres charges (saisies, ou comptées depuis la ventilation d'un virement) —, le RÉSULTAT (net Whop − créatrices − scans − autres charges) et les virements Whop → banque reçus ; le CA brut cumulé face aux seuils de 37 500 € et 41 250 € avec la projection ; le solde restant sur Whop ; la TRÉSORERIE d'aujourd'hui (disponible pour dépenser = Whop + comptes bancaires relevés − argent mis de côté pour les impôts, avec l'âge de chaque relevé) ; l'argent À RÉCUPÉRER (sorti de Whop, jamais arrivé) ; les contrôles (scans réels très sous l'estimation, écart entre la paie marquée versée et l'argent sorti de Whop pour les créatrices) ; les types de lignes non classés. Avec `mois` : le détail de ce mois — lignes du grand livre par type, chaque virement et sa VENTILATION (parts, usage, motif, charge comptée), les charges, les versements aux créatrices, les scans et le rapprochement du solde Whop.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        annee: {
          type: "integer",
          description: "Exercice (année civile). Défaut : l'année en cours (Paris).",
          minimum: 2020,
          maximum: 2100,
        },
        mois: {
          type: "string",
          description: "Détail d'un mois, AAAA-MM (ex. 2026-09). Remplace la vue de l'exercice.",
        },
      },
      additionalProperties: false,
    },
  },
];

// ─── Exécution ───────────────────────────────────────────────────────────────

type Projet = { _id: Id<"projects">; slug: string; name: string; role: string };

const plier = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** La période demandée, en jours de Paris ; défaut : les 30 derniers jours complets (jusqu'à hier). */
function periodeDemandee(args: Record<string, unknown>): { du: string; au: string } {
  const au =
    typeof args.au === "string" && args.au.trim() !== ""
      ? args.au.trim()
      : parisDayKey(Date.now() - 86_400_000);
  const du =
    typeof args.du === "string" && args.du.trim() !== ""
      ? args.du.trim()
      : shiftDay(au, -29);
  if (minuitParisDe(du) === null || minuitParisDe(au) === null) {
    throw new ToolError("« du » et « au » doivent être des jours AAAA-MM-JJ.");
  }
  if (du > au) throw new ToolError("« du » doit précéder « au ».");
  return { du, au };
}

/** Sur quels jours portent les chiffres PostHog d'un outil, et d'où ils viennent. */
function decrirePeriode(p: {
  recalcul: WindowedParcours | null;
  fenetre: AnalyticsWindow | null;
  erreur: string | null;
}) {
  const f = p.fenetre;
  if (f === null) return "aucune donnée PostHog sur la période";
  if (p.recalcul !== null) {
    return { du: f.from, au: f.to, source: "recalculé sur la période (bornée aux jours de données)" };
  }
  return {
    du: f.from,
    au: f.to,
    source:
      "cache des 90 derniers jours" +
      (p.erreur === null ? " (la période couvre toutes les données)" : " (recalcul impossible)"),
  };
}

/** Le message d'un refus serveur (droit manquant…), tel que l'app le formule. */
function messageDe(e: unknown): string | null {
  if (!(e instanceof ConvexError)) return null;
  const d: unknown = e.data;
  if (typeof d === "string") return d;
  if (typeof d === "object" && d !== null && "message" in d) {
    return String((d as { message: unknown }).message);
  }
  return null;
}

/** Un montant de paie tel que l'écran l'affiche : valeur, devise, et d'où il vient. */
const montantAffiche = (d: DisplayAmount | null) =>
  d === null
    ? null
    : {
        valeur: d.value,
        devise: d.currency,
        ...(d.converted
          ? { convertiDepuis: `${d.sourceValue} ${d.sourceCurrency} × ${d.rate}` }
          : d.rate === null
            ? { nonConverti: "aucun taux de change réglé sur le projet : montant en devise de paie" }
            : {}),
      };

const json = (valeur: unknown) => textResult(JSON.stringify(valeur, null, 1));

/**
 * Le serveur MCP d'UNE personne authentifiée, par UNE connexion (clé ou
 * application). Les outils d'ÉCRITURE n'apparaissent que si la personne a
 * autorisé cette connexion à modifier le domaine, dans l'app.
 */
export function jarviaServer(
  ctx: ActionCtx,
  userId: Id<"users">,
  acces: { kind: "token" | "oauth"; id: string; name: string; writeScopes: readonly string[] },
): McpServer {
  // Les domaines que CETTE connexion peut modifier (interrupteurs de l'app).
  const domaines = DOMAINES_ECRITURE.filter((d) => acces.writeScopes.includes(d.scope));
  const LIBELLE_DOMAINE: Record<string, string> = {
    compta: "la Compta",
    missions: "les missions (assigner, replanifier, changer de compte, relancer, abandonner — l'assignation et la relance envoient un email à la créatrice)",
    scripts: "les scripts (créer une campagne, ajouter et activer des briques, graduer un hook)",
    publications: "les publications (valider ou refuser une vidéo soumise — email à la créatrice —, lien collé en secours, chauffe)",
    veille: "la veille et la bibliothèque (comptes suivis — suivre lance un relevé Apify payant —, inspirations)",
    messages: "les messages aux créatrices (le coach : chaque message part par EMAIL, un tous les 3 jours au plus)",
    conversations: "les conversations Instagram (créer, modifier, supprimer un brouillon de capture ; l'image s'exporte depuis l'écran de l'app)",
  };
  // Un libellé par INTERRUPTEUR : deux domaines peuvent partager le même
  // (expériences et missions) — sans ce dédoublonnage, « les missions » sortait
  // deux fois dans les instructions.
  const libellesOuverts = [...new Set(domaines.map((d) => d.scope))].map((s) => LIBELLE_DOMAINE[s]);
  let projetsP: Promise<Projet[]> | null = null;
  const projets = () =>
    (projetsP ??= ctx.runQuery(internal.mcpTools.projetsAccessibles, { userId }));

  async function projetDe(arg: unknown): Promise<Projet> {
    const liste = await projets();
    if (liste.length === 0) {
      throw new ToolError("Cette clé n'ouvre aucun projet.");
    }
    const possibles = liste.map((p) => p.slug).join(", ");
    if (typeof arg !== "string" || arg.trim() === "") {
      if (liste.length === 1) return liste[0];
      throw new ToolError(`Précise le projet (argument « projet ») parmi : ${possibles}.`);
    }
    const q = plier(arg);
    const p = liste.find((x) => plier(x.slug) === q || plier(x.name) === q);
    if (!p) {
      throw new ToolError(`Projet inconnu ou inaccessible : « ${arg} ». Projets possibles : ${possibles}.`);
    }
    return p;
  }

  /**
   * Les agrégats PostHog d'une période, obtenus comme l'écran les obtient (cf
   * components/analytics/hub/useWindowedAnalytics) : la période est bornée aux
   * jours de données ; si elle les couvre tous, le cache du cron (90 jours)
   * suffit ; sinon ils sont RECALCULÉS sur la période — même cœur
   * (`computeWindowedAnalytics`), même cache partagé que l'écran. Un échec du
   * recalcul n'est jamais tu : l'appelant retombe sur les 90 jours ET le dit.
   */
  async function agregatsSurPeriode(
    projectId: Id<"projects">,
    produit: ProductAnalytics,
    du: string,
    au: string,
  ): Promise<{
    recalcul: WindowedParcours | null;
    fenetre: AnalyticsWindow | null;
    erreur: string | null;
  }> {
    const plage = dataRangeOf(produit.overview.daily.map((d) => parisDayKey(d.ts)));
    const fenetre = clampWindow({ from: du, to: au }, plage);
    if (!produit.configured || fenetre === null || coversEverything(fenetre, plage)) {
      return { recalcul: null, fenetre, erreur: null };
    }
    const clause = hogWindowClause(fenetre.from, fenetre.to);
    const surPremierAbo = hogWindowClause(fenetre.from, fenetre.to, "t_first_sub");
    if (clause === null || surPremierAbo === null) {
      return { recalcul: null, fenetre, erreur: "période illisible" };
    }
    // Le contrôle de l'action de l'écran, à l'identique.
    await lire(() => ctx.runQuery(internal.analyticsWindowed.assertBusinessRead, { userId, projectId }));
    try {
      const recalcul = await computeWindowedAnalytics(ctx, {
        projectId,
        window: clause,
        windowOnFirstSub: surPremierAbo,
        from: fenetre.from,
        to: fenetre.to,
      });
      return { recalcul, fenetre, erreur: null };
    } catch (e) {
      return {
        recalcul: null,
        fenetre,
        erreur: messageDe(e) ?? (e instanceof Error ? e.message : "recalcul PostHog impossible"),
      };
    }
  }

  /**
   * Une lecture qui peut être REFUSÉE sans faire tomber l'outil : le refus revient
   * comme valeur (le message de l'app), comme l'écran masque une section.
   */
  async function peutLire<T>(f: () => Promise<T>): Promise<T | { refus: string }> {
    try {
      return await f();
    } catch (e) {
      const m = messageDe(e);
      if (m !== null) return { refus: m };
      throw e;
    }
  }

  /** Une lecture gardée : un refus de droit devient un message pour le modèle. */
  async function lire<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e) {
      const m = messageDe(e);
      if (m !== null) throw new ToolError(`Refusé : ${m}`);
      throw e;
    }
  }

  /**
   * `rentabilite` sur une période LIBRE : revenu encaissé ces jours-là ÷ vues
   * FACTURÉES gagnées ces jours-là.
   *
   * Le revenu et le plafond de chaque vidéo viennent du cœur de la carte (même
   * moteur de paie, même plafond 150 $, même fenêtre J+30, même assiette réglée)
   * ; les relevés sont lus ensuite, par lots, pour dater ces vues au jour (cf
   * convex/viewsDaily `computeDailyBilledViews`).
   */
  async function rentabiliteSurPeriode(
    projet: Projet,
    ids: { userId: Id<"users">; projectId: Id<"projects"> },
    duArg: string | null,
    auArg: string | null,
  ) {
    const aujourdhui = parisDayKey(Date.now());
    const au = auArg ?? parisDayKey(Date.now() - 86_400_000);
    const du = duArg ?? shiftDay(au, -29);
    const debut = minuitParisDe(du);
    if (debut === null || minuitParisDe(au) === null) {
      throw new ToolError("« du » et « au » doivent être des jours AAAA-MM-JJ.");
    }
    if (du > au) throw new ToolError("« du » doit précéder « au ».");
    if (au > aujourdhui) {
      throw new ToolError(`« au » ne peut pas dépasser aujourd'hui (${aujourdhui}).`);
    }
    const [ya, ma, da] = au.split("-").map(Number);
    const fin = parisMidnightUtc(ya, ma, da + 1); // exclu

    const data = await lire(() =>
      ctx.runQuery(internal.mcpTools.lireRentabilite, { ...ids, periode: { du, au } }),
    );
    if (!data.configured || !("periode" in data) || data.periode === undefined) {
      return json({
        projet: projet.slug,
        configure: false,
        message:
          "Rentabilité indisponible : aucun revenu Whop n'est relié à ce projet. Sans revenu, pas de RPM.",
      });
    }
    const p = data.periode;

    // Les vidéos qui ont pu facturer des vues pendant la période : fenêtre de
    // paie pas encore close au premier jour, publiées avant la fin — à 7 jours
    // près, une date de publication saisie après le premier relevé (TD-020)
    // pouvant la faire paraître plus tard qu'elle n'est.
    const MARGE_PUBLICATION_MS = 7 * 86_400_000;
    const videos = p.videos.filter((v) =>
      v.posts.some((x) => x.coupure > debut && x.publishedAt < fin + MARGE_PUBLICATION_MS),
    );
    const posts = new Map<string, number>();
    for (const v of videos) for (const x of v.posts) posts.set(x.publicationId, x.coupure);
    // Par lots : toute la vie de chaque post est relue (le plafond se coupe dans
    // l'ordre chronologique), ce qui ne tient pas en une query sur un an.
    const LOT = 100;
    const liste = [...posts.entries()];
    const snaps: { publicationId: string; capturedAt: number; vues: number }[] = [];
    for (let i = 0; i < liste.length; i += LOT) {
      const lot = liste.slice(i, i + LOT).map(([publicationId, coupure]) => ({
        publicationId: publicationId as Id<"publications">,
        coupure,
      }));
      snaps.push(
        ...(await lire(() =>
          ctx.runQuery(internal.mcpTools.lireRelevesFacturables, { ...ids, posts: lot }),
        )),
      );
    }
    const facturees = computeDailyBilledViews(videos, snaps);
    const joursFactures = facturees.jours.filter((j) => j.date >= du && j.date <= au);
    const vuesFacturees = joursFactures.reduce((s, j) => s + j.value, 0);

    const vuesDuJour = new Map(joursFactures.map((j) => [j.date, j.value]));
    const revenuDuJour = new Map(p.revenueByDay.map((r) => [r.jour, r.revenueNet]));
    const parJour: { jour: string; revenuNet: number; vuesFacturees: number }[] = [];
    for (let j = du; j <= au; j = shiftDay(j, 1)) {
      parJour.push({
        jour: j,
        revenuNet: revenuDuJour.get(j) ?? 0,
        vuesFacturees: vuesDuJour.get(j) ?? 0,
      });
    }
    // Au-delà d'un trimestre, le détail se lit par mois (de Paris) : des
    // centaines de lignes noieraient la réponse sans rien dire de plus. Les mois
    // de bord ne couvrent que leurs jours dans la période, et le disent.
    const PAR_JOUR_MAX = 92;
    const parMois = new Map<
      string,
      { mois: string; du: string; au: string; revenuNet: number; vuesFacturees: number }
    >();
    if (parJour.length > PAR_JOUR_MAX) {
      for (const j of parJour) {
        const m = j.jour.slice(0, 7);
        const ligne = parMois.get(m) ?? { mois: m, du: j.jour, au: j.jour, revenuNet: 0, vuesFacturees: 0 };
        ligne.au = j.jour;
        ligne.revenuNet = Math.round((ligne.revenuNet + j.revenuNet) * 100) / 100;
        ligne.vuesFacturees += j.vuesFacturees;
        parMois.set(m, ligne);
      }
    }
    const detail =
      parMois.size > 0
        ? {
            parMois: [...parMois.values()].map((l) => ({
              ...l,
              rpm: data.mixedCurrency ? null : computeRpm(l.revenuNet, l.vuesFacturees),
            })),
          }
        : { parJour };

    const avertissements: string[] = [];
    if (data.mixedCurrency) {
      avertissements.push(
        "Revenus encaissés dans plusieurs devises NON convertibles : le revenu vaut 0 par abstention (ce n'est pas un montant), le RPM n'est donc pas calculé (null).",
      );
    }
    if (data.conversions.length > 0) {
      avertissements.push(
        `Une partie du revenu a été convertie au taux du projet (${data.conversions
          .map((c) => `${c.from} × ${c.rate}`)
          .join(", ")}) : un taux posé à la main n'est pas une comptabilité.`,
      );
    }
    const estimes = joursFactures.filter((j) => j.estimated).map((j) => j.date);
    if (estimes.length > 0) {
      avertissements.push(
        `${estimes.length} jour(s) dont une part des vues vient d'un écart de plus de 30 h entre deux relevés : réparti au prorata, pas mesuré (${estimes.join(", ")}).`,
      );
    }
    if (facturees.nonDatees > 0) {
      avertissements.push(
        `${facturees.nonDatees} vues facturées des vidéos actives sur la période ne se datent pas (post payé sans relevé dans sa fenêtre, ou date de publication postérieure au premier relevé) : elles ne sont dans aucun jour, donc hors du dénominateur.`,
      );
    }
    if (au === aujourdhui) {
      avertissements.push(
        "La période finit aujourd'hui : le revenu du jour est en cours et ses vues n'arrivent qu'au relevé de 23 h 30.",
      );
    }

    return json({
      projet: projet.slug,
      periode: { du, au, jours: parJour.length },
      devises: { revenu: data.currency },
      unites: "revenuNet et rpm dans la devise du REVENU.",
      revenuNet: p.revenueNet,
      vuesFacturees,
      // Revenu à zéro PAR ABSTENTION (devises non convertibles) : pas de RPM.
      rpm: data.mixedCurrency ? null : computeRpm(p.revenueNet, vuesFacturees),
      ...(data.mixedCurrency ? { revenuInexploitable: true } : {}),
      ...detail,
      lecture: [
        "vuesFacturees = vues GAGNÉES ces jours-là par les posts rémunérés, tant qu'ils sont dans leur fenêtre de paie (J+30, ou avant une spark ad), et jusqu'au plafond de 150 $ de leur vidéo : au-delà, une vue est gratuite et n'y entre pas. Toutes vidéos confondues, quelle que soit leur date de publication.",
        "revenuNet = net Whop encaissé ces jours-là (après frais, remboursements déduits, litiges exclus), jours de Paris.",
        "Ce n'est PAS le RPM de la ligne mensuelle, même sur un mois entier : le mensuel range les vues d'une vidéo dans le mois de sa PUBLICATION, ici elles tombent le jour où elles sont faites, comme le revenu. D'où un RPM comparable d'une période à l'autre sans attendre M+30.",
        "Coût et marge ne sont pas servis sur une période libre (la paie se compte par vidéo publiée et par palier, pas par jour) : ils restent au détail mensuel, sans du/au.",
        "Un jour n'est complet qu'après le relevé de 23 h 30 ; une vue répartie entre deux relevés est estimée au prorata des heures.",
      ],
      ...(avertissements.length > 0 ? { avertissements } : {}),
    });
  }

  const filtreNom = (nom: string | null, filtre: unknown) =>
    typeof filtre !== "string" || plier(nom ?? "").includes(plier(filtre));

  return {
    info: { name: "jarvia", version: "1.0.0" },
    instructions:
      (domaines.length === 0
        ? "Données de Jarvia Creator Studio (distribution de vidéos par des créatrices), en LECTURE SEULE, avec les droits de la personne qui a créé la clé."
        : `Données de Jarvia Creator Studio (distribution de vidéos par des créatrices), avec les droits de la personne qui a créé la clé. Cette connexion peut aussi MODIFIER : ${libellesOuverts.join(", ")} — par les outils annotés écriture, jamais autrement. Avant chacun, dis en clair ce qui va changer et pour qui, et attends l'accord ; ensuite, rapporte ce que la réponse dit avoir fait et où le défaire (\`modifications\` puis \`defaire\`, quand c'est possible). Désigne les choses par les noms que les outils de lecture t'ont montrés.`) +
      " Les chiffres sont ceux de l'app au moment de l'appel. Si plusieurs projets sont accessibles, précise `projet` (appelle `projets` pour la liste). Les dates sont des jours de Paris (AAAA-MM-JJ). « clients » ne compte PAS la même population partout : economie_unitaire (clientsAcquis) et les ventes par pays de facturation de parcours comptent des PERSONNES Whop ; retention, marches et revenus comptent des ABONNEMENTS Whop (une personne peut en avoir plusieurs) ; trafic, tunnel et test A/B (parcours, offres, acquisition, clientsPostHog de marches) comptent des personnes PostHog. Ne compare jamais deux « clients » de deux outils sans le dire.",
    // `modifications` / `defaire` : dès qu'un domaine s'écrit — le domaine de
    // CHAQUE modification est revérifié au moment de la défaire.
    tools: [
      ...OUTILS,
      // `proposer` / `propositions` : TOUJOURS là — proposer n'écrit rien, c'est
      // la voie d'une connexion en lecture seule ou d'une routine sans personne.
      ...OUTILS_PROPOSITIONS,
      OUTIL_EXPERIENCES,
      OUTIL_BILAN,
      ...OUTILS_CONVERSATIONS_LECTURE,
      ...domaines.flatMap((d) => d.outils),
      ...(domaines.length > 0 ? OUTILS_DEFAIRE : []),
    ],
    prompts: promptsJarvia(
      domaines.map((d) => d.scope),
      parisDayKey(Date.now()),
    ),
    async callTool(name, args) {
      if (name === "projets") {
        return json(
          (await projets()).map((p) => ({ slug: p.slug, nom: p.name, role: p.role })),
        );
      }
      const projet = await projetDe(args.projet);
      const ids = { userId, projectId: projet._id };

      if (NOMS_EXPERIENCES_LECTURE.has(name)) {
        return appelerExperiences(ctx, args, ids, projet.slug, lire);
      }
      if (NOMS_BILAN.has(name)) {
        return appelerBilan(ctx, args, ids, projet.slug, lire);
      }
      if (NOMS_CONVERSATIONS_LECTURE.has(name)) {
        return appelerConversationsLecture(ctx, name, args, ids, projet.slug, lire);
      }
      if (NOMS_PROPOSITIONS.has(name)) {
        return appelerPropositions(ctx, name, args, { ...ids, via: { kind: acces.kind, name: acces.name } }, projet.slug);
      }
      if (NOMS_DEFAIRE.has(name)) {
        if (domaines.length === 0) {
          throw new ToolError("Cette connexion est en lecture seule : autorise un domaine pour elle dans Jarvia › Connecter Claude.");
        }
        return appelerDefaire(ctx, name, args, { ...ids, acces: { kind: acces.kind, id: acces.id } }, projet.slug);
      }
      const domaine = DOMAINES_ECRITURE.find((d) => d.outils.some((t) => t.name === name));
      if (domaine) {
        if (!domaines.includes(domaine)) {
          throw new ToolError("Cette connexion est en lecture seule pour ce domaine : autorise les modifications pour elle dans Jarvia › Connecter Claude.");
        }
        return domaine.appeler(ctx, name, args, { ...ids, acces: { kind: acces.kind, id: acces.id } }, projet.slug);
      }

      if (name === "comptes") {
        const tous = await lire(() => ctx.runQuery(internal.mcpTools.lireComptes, ids));
        const pays = typeof args.pays === "string" ? args.pays.trim().toUpperCase() : null;
        const retenus = tous
          .filter((c) => filtreNom(c.createatrice, args.createatrice))
          .filter((c) => pays === null || c.pays === pays)
          .filter((c) => args.plateforme === undefined || c.plateforme === args.plateforme)
          .filter((c) => args.statut === undefined || c.statut === args.statut)
          .sort((a, b) => b.vues - a.vues);
        const limite = typeof args.limite === "number" ? args.limite : 100;
        return json({
          projet: projet.slug,
          total: retenus.length,
          vuesCumulees: retenus.reduce((s, c) => s + c.vues, 0),
          ...(retenus.length > limite ? { tronque: `${limite} premiers sur ${retenus.length}` } : {}),
          comptes: retenus.slice(0, limite),
        });
      }

      if (name === "createatrices") {
        const toutes = await lire(() => ctx.runQuery(internal.mcpTools.lireCreatrices, ids));
        const inactives = args.inclure_inactives === true;
        const retenues = toutes
          .filter((c) => filtreNom(c.nom, args.createatrice))
          .filter((c) => inactives || (c.statut !== "paused" && c.statut !== "churned"))
          .sort((a, b) => b.publications - a.publications);
        return json({ projet: projet.slug, total: retenues.length, createatrices: retenues });
      }

      if (name === "ponctualite") {
        const du = typeof args.du === "string" && args.du.trim() !== "" ? args.du.trim() : null;
        const au = typeof args.au === "string" && args.au.trim() !== "" ? args.au.trim() : null;
        if ((du === null) !== (au === null)) {
          throw new ToolError("Donne « du » ET « au » (les jours prévus), ou aucun des deux (tout l'historique).");
        }
        if (du !== null && au !== null) {
          if (minuitParisDe(du) === null || minuitParisDe(au) === null) {
            throw new ToolError("« du » et « au » doivent être des jours AAAA-MM-JJ.");
          }
          if (du > au) throw new ToolError("« du » doit précéder « au ».");
        }
        const lignes = await lire(() =>
          ctx.runQuery(internal.mcpTools.lirePonctualite, {
            ...ids,
            ...(du !== null && au !== null ? { du, au } : {}),
          }),
        );
        const retenues = lignes
          .filter((l) => filtreNom(l.createatrice, args.createatrice))
          // Le taux le plus bas d'abord ; « aucun post passé » en dernier.
          .sort(
            (a, b) =>
              (a.tauxALHeurePct ?? Number.POSITIVE_INFINITY) -
              (b.tauxALHeurePct ?? Number.POSITIVE_INFINITY),
          );
        return json({
          projet: projet.slug,
          periode:
            du !== null && au !== null
              ? { du, au, perimetre: "posts PRÉVUS ces jours-là (sans date prévue : exclus)" }
              : "tout l'historique",
          note: "tauxALHeurePct = à l'heure ÷ posts passés ; null = aucun post passé encore.",
          createatrices: retenues,
        });
      }

      if (name === "rentabilite") {
        const mois = typeof args.mois === "string" ? args.mois.trim() : null;
        const duArg = typeof args.du === "string" && args.du.trim() !== "" ? args.du.trim() : null;
        const auArg = typeof args.au === "string" && args.au.trim() !== "" ? args.au.trim() : null;
        if (duArg !== null || auArg !== null) {
          if (mois !== null) {
            throw new ToolError(
              "« mois » et « du »/« au » s'excluent. Un mois peut se demander en du/au (ex. 2026-09-01 → 2026-09-30), mais ce n'est pas la même mesure que la ligne mensuelle — cf « lecture » dans la réponse.",
            );
          }
          if (args.inclure_non_facturees === true) {
            throw new ToolError(
              "inclure_non_facturees ne vaut que pour le détail mensuel. Sur une période, les vues de tous les posts suivis sont dans l'outil `vues` (warmup : inclure).",
            );
          }
          return rentabiliteSurPeriode(projet, ids, duArg, auArg);
        }
        if (mois !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) {
          throw new ToolError("« mois » doit être au format AAAA-MM (ex. 2026-09).");
        }
        const data = await lire(() => ctx.runQuery(internal.mcpTools.lireRentabilite, ids));
        if (!data.configured) {
          return json({
            projet: projet.slug,
            configure: false,
            message:
              "Rentabilité indisponible : aucun revenu Whop n'est relié à ce projet. Sans revenu, ni marge ni RPM.",
          });
        }
        const inclure = args.inclure_non_facturees === true;
        // LE calcul de la carte Rentabilité — la même fonction, pas une copie.
        const rapport = profitabilityReport(data, inclure);
        const lignes = rapport.months.filter((m) => mois === null || m.period === mois);
        if (mois !== null && lignes.length === 0) {
          throw new ToolError(
            `Aucune donnée pour ${mois}. Mois disponibles : ${
              rapport.months.map((m) => m.period).join(", ") || "aucun"
            }.`,
          );
        }
        const chiffres = (x: (typeof rapport)["total"]) => ({
          revenuNet: x.revenueNet,
          coutCreatrices: x.creatorCost,
          marge: x.margin,
          vues: x.views,
          rpm: x.rpm,
        });
        const avertissements: string[] = [];
        if (rapport.fxRate === null) {
          avertissements.push(
            `Marge non calculable : revenu en ${data.currency ?? "?"} et paie en ${data.payCurrency ?? "?"}, sans taux de change réglé sur le projet. « marge » vaut null — elle n'est jamais inventée.`,
          );
        }
        if (data.mixedCurrency) {
          avertissements.push(
            "Revenus encaissés dans plusieurs devises NON convertibles : sur les mois marqués revenuInexploitable, le revenu vaut 0 par abstention (ce n'est pas un montant), donc marge et RPM de ces mois ne veulent rien dire.",
          );
        }
        if (data.conversions.length > 0) {
          avertissements.push(
            `Une partie du revenu a été convertie au taux du projet (${data.conversions
              .map((c) => `${c.from} × ${c.rate}`)
              .join(", ")}) : un taux posé à la main n'est pas une comptabilité.`,
          );
        }
        return json({
          projet: projet.slug,
          devises: {
            revenu: data.currency,
            paie: data.payCurrency,
            tauxPaieVersRevenu: rapport.fxRate,
          },
          unites:
            "revenuNet, marge et rpm dans la devise du REVENU ; coutCreatrices dans la devise de la PAIE.",
          vuesRetenues: inclure
            ? "toutes les vues suivies (RPM dilué)"
            : "vues facturées seulement (RPM business : ce que rapporte une vue achetée)",
          ...(mois === null ? { cumul: chiffres(rapport.total) } : {}),
          mois: lignes.map((m) => ({
            mois: m.period,
            ...chiffres(m.metrics),
            // Mois en cours : coût ENGAGÉ (ce qu'on paiera), revenu arrêté à aujourd'hui.
            enCours: m.period === data.currentPeriod,
            // Figé : cycles réglés ou fenêtres de paie closes — coût et vues définitifs.
            fige: m.settled,
            ...(m.mixedCurrency ? { revenuInexploitable: true } : {}),
          })),
          lecture: [
            "Un mois non figé peut encore bouger : une vidéo est rémunérée jusqu'à J+30 après publication, donc un mois tout juste clos gagne encore des vues facturées alors que son revenu est arrêté au 31. Ne comparer deux mois qu'une fois figés tous les deux.",
            "Le mois en cours compte le coût ENGAGÉ (ce qu'on paiera si les seuils tombent), pas le dû du jour.",
          ],
          ...(avertissements.length > 0 ? { avertissements } : {}),
        });
      }

      if (name === "revenus") {
        const au =
          typeof args.au === "string" && args.au.trim() !== ""
            ? args.au.trim()
            : parisDayKey(Date.now() - 86_400_000);
        const du =
          typeof args.du === "string" && args.du.trim() !== ""
            ? args.du.trim()
            : shiftDay(au, -29);
        if (minuitParisDe(du) === null || minuitParisDe(au) === null) {
          throw new ToolError("« du » et « au » doivent être des jours AAAA-MM-JJ.");
        }
        if (du > au) throw new ToolError("« du » doit précéder « au ».");
        const r = await lire(() => ctx.runQuery(internal.mcpTools.lireRevenus, ids));
        if (!r.configured) {
          return json({
            projet: projet.slug,
            configure: false,
            message: "Revenus indisponibles : aucun compte Whop n'est relié à ce projet.",
            ...(r.offerChanges.length > 0
              ? {
                  changementsOffre: r.offerChanges.map((o) => ({
                    le: jour(o.at),
                    titre: o.title,
                    detail: o.detail,
                  })),
                }
              : {}),
          });
        }
        const arrondi = (n: number) => Math.round(n * 100) / 100;
        // La fenêtre et ses sommes : les MÊMES fonctions que la Vue d'ensemble
        // (convex/analyticsDates). Multi-devise non convertible : pas de somme.
        const w: AnalyticsWindow = { from: du, to: au };
        const netSur = (fenetre: AnalyticsWindow) => {
          const t = r.mixedCurrency
            ? null
            : sumInWindow(r.dailyNet, fenetre, (d) => d.day, (d) => d.net);
          return t === null ? null : arrondi(t);
        };
        const revenuNet = netSur(w);
        const donnees = dataRangeOf(r.dailyNet.map((d) => d.day));
        let periodePrecedente: Record<string, unknown> | undefined;
        if (args.comparer === true) {
          const avant = previousWindow(w, donnees);
          if (avant === null) {
            periodePrecedente = {
              indisponible: `Les données de revenu ne couvrent pas entièrement les ${windowLengthDays(w)} jours précédents${
                donnees ? ` (premier jour de revenu : ${donnees.first})` : ""
              } : une comparaison tronquée n'en est pas une.`,
            };
          } else {
            const net = netSur(avant);
            periodePrecedente = {
              du: avant.from,
              au: avant.to,
              revenuNet: net,
              evolutionPct:
                net !== null && revenuNet !== null && net > 0
                  ? Math.round(((revenuNet - net) / net) * 1000) / 10
                  : null,
            };
          }
        }
        const maintenant = Date.now();
        const avertissements: string[] = [];
        if (r.mixedCurrency) {
          avertissements.push(
            `Revenus encaissés dans plusieurs devises (${r.currenciesPresent.join(", ")}) sans taux de change réglé sur le projet : les totaux ne sont pas additionnés (null), jamais inventés.`,
          );
        }
        if (r.conversions.length > 0) {
          avertissements.push(
            `Une partie du revenu a été convertie au taux du projet (${r.conversions
              .map((c) => `${c.from} × ${c.rate}`)
              .join(", ")}) : un taux posé à la main n'est pas une comptabilité.`,
          );
        }
        if (r.disputes.length > 0) {
          avertissements.push(
            `${r.disputes.length} litige(s) EN COURS : l'argent est à risque et déjà exclu du net. Répondre avant l'échéance (côté Whop).`,
          );
        }
        const ab = r.abRevenue;
        return json({
          projet: projet.slug,
          devise: r.currency,
          ...(r.feeRate !== null ? { fraisWhopPct: Math.round(r.feeRate * 1000) / 10 } : {}),
          periode: { du, au, jours: windowLengthDays(w) },
          revenuNet,
          ...(periodePrecedente ? { periodePrecedente } : {}),
          parJour: rowsInWindow(r.dailyNet, w, (d) => d.day).map((d) => ({ jour: d.day, net: d.net })),
          historique: {
            premierJourDeRevenu: donnees?.first ?? null,
            ltvRealiseeParClient: r.ltv,
            revenuMensuelParClient: r.monthlyArpu,
            parMois: r.periods.map((p) => ({
              mois: p.period,
              net: p.net,
              premierPaiement: p.newNet,
              renouvellement: p.returningNet,
              nonRattache: p.unattributedNet,
              clients: p.members,
            })),
          },
          offres: r.plans.map((o) => ({
            offre: o.name,
            cadence: o.interval,
            prix: o.price,
            devise: o.currency,
            active: o.active,
            clients: o.members,
            netTotal: o.netTotal,
            ltvRealisee: o.ltv,
            netParPaiement: o.netPerPayment,
            ...(o.feeRate !== null ? { fraisWhopPct: Math.round(o.feeRate * 1000) / 10 } : {}),
            netParMoisClient: o.netPerMemberMonth,
            ...(o.netReason ? { raison: o.netReason } : {}),
          })),
          remboursements: { montant: r.refunded, nombre: r.refundCount },
          litigesEnCours: {
            montantARisque: r.disputedTotal,
            litiges: r.disputes.map((d) => ({
              montant: d.amount,
              devise: d.currency,
              payeLe: jour(d.paidAt),
              echeanceReponse: jour(d.dueAt),
              joursPourRepondre: daysUntil(d.dueAt, maintenant),
              motif: d.reason,
              client: d.memberName,
            })),
          },
          ...(ab.startMs !== null
            ? {
                testAB: {
                  depuis: jour(ab.startMs),
                  bras: ab.rows.map((b) => ({
                    bras: b.variant,
                    net: b.net,
                    abonnements: b.memberships,
                    rattachesParRepli: b.viaFallback,
                    abonnementsEnLitige: b.atRiskMemberships,
                    montantEnLitige: b.atRiskAmount,
                  })),
                  sansBras: ab.unattached,
                  divergencesWhopPosthog: ab.divergences.length,
                  exclusCarChangementDeBras: {
                    abonnements: ab.excludedFlippers,
                    net: ab.excludedFlippersNet,
                  },
                },
              }
            : {}),
          changementsOffre: r.offerChanges.map((o) => ({
            le: jour(o.at),
            titre: o.title,
            detail: o.detail,
          })),
          ...(r.internalExcludedMembers > 0
            ? { abonnementsInternesExclus: r.internalExcludedMembers }
            : {}),
          lecture: [
            "Net = ce que Whop verse après ses frais, remboursements déduits ; les litiges en cours en sont EXCLUS (argent à risque).",
            "« premierPaiement » / « renouvellement » : le 1er paiement encaissé d'un abonnement contre les suivants — approximation bornée à l'historique importé.",
            "LTV RÉALISÉE = net cumulé ÷ clients, sans projection (pas de churn inventé). Les offres, remboursements, litiges et le test A/B portent sur TOUT l'historique ; seuls revenuNet, parJour et periodePrecedente suivent la période.",
            "Avant de comparer deux périodes, regarder changementsOffre : un changement d'offre rend deux cohortes incomparables.",
            "« clients » compte ici des ABONNEMENTS Whop (une personne peut en avoir plusieurs) — pas les personnes d'economie_unitaire. Ne jamais comparer les deux sans le dire.",
          ],
          ...(avertissements.length > 0 ? { avertissements } : {}),
        });
      }

      if (name === "economie_unitaire") {
        const au =
          typeof args.au === "string" && args.au.trim() !== ""
            ? args.au.trim()
            : parisDayKey(Date.now() - 86_400_000);
        const du =
          typeof args.du === "string" && args.du.trim() !== ""
            ? args.du.trim()
            : shiftDay(au, -29);
        if (minuitParisDe(du) === null || minuitParisDe(au) === null) {
          throw new ToolError("« du » et « au » doivent être des jours AAAA-MM-JJ.");
        }
        if (du > au) throw new ToolError("« du » doit précéder « au ».");
        // Les TROIS agrégats de la Vue d'ensemble, lus séparément comme l'écran
        // les lit (chacun dans ses propres limites de lecture).
        const revenu = await lire(() => ctx.runQuery(internal.mcpTools.lireRevenus, ids));
        const attribution = await lire(() => ctx.runQuery(internal.mcpTools.lireAttribution, ids));
        const fiabilite = await lire(() => ctx.runQuery(internal.mcpTools.lireFiabilite, ids));
        const coh = fiabilite.coherence;
        const fx = {
          payCurrency: attribution.payCurrency,
          revenueCurrency: revenu.currency,
          fxRateToRevenue: attribution.fxRateToRevenue,
        };
        // Le garde-fou de l'écran : même décision (convex/unitEconomics).
        // (null → absent, comme coherenceInputsFrom le fait pour l'écran.)
        const ecart = ecartDashboardWhop({
          ...coh,
          windowReconciliation: coh.windowReconciliation ?? undefined,
        });
        const entrees = {
          dailyPaidClients: coh.dailyPaidClients,
          revenu,
          attributionRows: attribution.rows,
          promoBonusByDay: attribution.costs.promoBonusByDay,
          fx,
          suspendu: ecart?.masks === true,
        };
        const w: AnalyticsWindow = { from: du, to: au };
        const cur = agregatsFenetre(entrees, w);
        const { margePerClient, roas } = equationUnitaire(cur);
        const rang1 = (a: AgregatsFenetre) => ({
          margeNette: a.marge,
          revenuNet: a.net === null ? null : Math.round(a.net * 100) / 100,
          coutCreateurs: montantAffiche(a.costAll),
        });
        // L'étendue des données WHOP (revenu, clients) : la comparaison n'est
        // offerte que si elle couvre toute la période précédente.
        const donnees = dataRangeOf([
          ...revenu.dailyNet.map((d) => d.day),
          ...coh.dailyPaidClients.map((d) => d.day),
        ]);
        let periodePrecedente: Record<string, unknown> | undefined;
        if (args.comparer === true) {
          const wAvant = previousWindow(w, donnees);
          if (wAvant === null) {
            periodePrecedente = {
              indisponible: `Les données ne couvrent pas entièrement les ${windowLengthDays(w)} jours précédents${
                donnees ? ` (premier jour : ${donnees.first})` : ""
              } : une comparaison tronquée n'en est pas une.`,
            };
          } else {
            const avant = agregatsFenetre(entrees, wAvant);
            const delta = (a: number | null, b: number | null) =>
              a !== null && b !== null && b !== 0 ? computeDelta(a, b) : null;
            periodePrecedente = {
              du: wAvant.from,
              au: wAvant.to,
              ...rang1(avant),
              evolution: {
                margeNette: delta(cur.marge, avant.marge),
                revenuNet: delta(cur.net, avant.net),
                coutCreateurs: delta(cur.costAll?.value ?? null, avant.costAll?.value ?? null),
              },
            };
          }
        }
        const c = attribution.costs;
        const bonus = toDisplayAmount(c.promoBonus, fx);
        const natureDue = toDisplayAmount(c.natureDue, fx);
        const securises = coh.whopSecuredClients ?? null;
        const clientsEnLitige =
          coh.whopClientsTotal !== null && securises !== null ? coh.whopClientsTotal - securises : 0;
        const avertissements: string[] = [];
        if (!revenu.configured) {
          avertissements.push("Aucun compte Whop relié au projet : ni revenu, ni marge, ni chiffres par client.");
        }
        if (revenu.mixedCurrency) {
          avertissements.push(
            "Revenus encaissés dans plusieurs devises sans taux réglé : le revenu n'est pas additionné (null), donc ni marge ni revenu par client.",
          );
        }
        if (cur.costAll !== null && !cur.costAll.converted && cur.costAll.rate === null) {
          avertissements.push(
            `Coûts en ${fx.payCurrency ?? "devise de paie"} et revenu en ${fx.revenueCurrency ?? "?"} sans taux de change réglé : la marge n'est pas calculée (null), jamais inventée.`,
          );
        }
        return json({
          projet: projet.slug,
          devises: { revenu: fx.revenueCurrency, paie: fx.payCurrency, tauxPaieVersRevenu: fx.fxRateToRevenue },
          periode: { du, au, jours: windowLengthDays(w) },
          ...rang1(cur),
          parClient: cur.canDivide
            ? {
                clientsAcquis: cur.clients,
                revenuParClient: cur.revenuePer,
                coutAcquisition: montantAffiche(cur.acquisition),
                margeParClient: margePerClient,
                retourSurAcquisition: roas,
                coutCompletMoteur: montantAffiche(cur.fullEngine),
                vuesPromoParClient: cur.viewsPer,
              }
            : {
                clientsAcquis: cur.clients,
                suspendu:
                  ecart?.masks === true
                    ? `Chiffres par client SUSPENDUS, comme à l'écran : l'écart clients PostHog/Whop dépasse à la fois ${DASHBOARD_WHOP_TOLERANCE_PCT} % et ${DASHBOARD_WHOP_TOLERANCE_ABS} clients (PostHog ${ecart.posthogClients} personnes, Whop ${ecart.whopClients}, écart inexpliqué ${ecart.diff}, soit ${ecart.pct} %${
                        ecart.regression ? ", régression d'instrumentation" : ""
                      }). Un chiffre faux est pire qu'un chiffre absent.`
                    : "Aucun client acquis sur la période : rien à diviser.",
              },
          ...(periodePrecedente ? { periodePrecedente } : {}),
          detail: {
            bonusEtPrimesCumules: montantAffiche(bonus),
            ...(c.challengeTotal > 0 ? { dontPrimesDeDefi: montantAffiche(toDisplayAmount(c.challengeTotal, fx)) } : {}),
            ...(c.natureDue > 0 ? { recompensesNatureDues: montantAffiche(natureDue) } : {}),
            ...(c.natureDueMissingCost > 0
              ? { recompensesNatureSansCoutReel: c.natureDueMissingCost }
              : {}),
            ...(clientsEnLitige > 0 ? { clientsEnLitige } : {}),
          },
          lecture: [
            "Marge nette = revenu net Whop encaissé − coût créateurs (fixe + CPM + bonus + défis) converti dans la devise du revenu.",
            "Par client : tout est divisé par les clients ACQUIS sur la période (PERSONNES, Whop fait foi — pas les abonnements que comptent retention, marches et revenus). Coût d'acquisition = vidéos promo (fixe + CPM) + bonus et primes ; le coût complet du moteur compte aussi le warmup.",
            "Retour sur acquisition = revenu par client ÷ coût d'acquisition (× fois).",
            "Les clients en litige comptent au dénominateur mais leur revenu est exclu du net : le revenu par client en est tiré vers le bas.",
          ],
          ...(avertissements.length > 0 ? { avertissements } : {}),
        });
      }

      if (name === "retention") {
        const du = typeof args.du === "string" && args.du.trim() !== "" ? args.du.trim() : null;
        const au = typeof args.au === "string" && args.au.trim() !== "" ? args.au.trim() : null;
        if ((du === null) !== (au === null)) {
          throw new ToolError("Donne « du » ET « au » (la cohorte d'acquisition), ou aucun des deux (toute la profondeur).");
        }
        if (du !== null && au !== null) {
          if (minuitParisDe(du) === null || minuitParisDe(au) === null) {
            throw new ToolError("« du » et « au » doivent être des jours AAAA-MM-JJ.");
          }
          if (du > au) throw new ToolError("« du » doit précéder « au ».");
        }
        const cohorte = du !== null && au !== null ? { from: du, to: au } : null;
        const churn = await lire(() =>
          ctx.runQuery(internal.mcpTools.lireRetention, { ...ids, ...(cohorte ?? {}) }),
        );
        if (!churn.configured) {
          return json({
            projet: projet.slug,
            configure: false,
            message: "Rétention indisponible : aucun compte Whop n'est relié à ce projet (l'état des abonnements vient de Whop).",
          });
        }
        const attribution = await lire(() => ctx.runQuery(internal.mcpTools.lireAttribution, ids));
        const maintenant = Date.now();
        // LE calcul de l'onglet (convex/churn), mêmes paramètres.
        const r = computeChurn(churn.memberships, {
          now: maintenant,
          periodStartMs: maintenant - ANALYSIS_WINDOW_DAYS * 86_400_000,
          webhookFixMs: WHOP_WEBHOOK_FIX_MS,
          horizonMs: HORIZON_DAYS * 86_400_000,
          sampleThreshold: SAMPLE_THRESHOLD,
          libelleSansOffre: "(sans offre)",
        });
        const libelles = new Map(churn.planLabels.map((p) => [p.planId, p.name]));
        const offre = (planId: string) => libelles.get(planId) ?? planId;
        const heures = (ms: number | null) => (ms === null ? null : Math.round((ms / 3_600_000) * 10) / 10);
        const pctFraction = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);
        const rn = churn.renewals;
        // Coût d'acquisition par client : même garde de POPULATION que l'écran —
        // coût et clients sur la même période, sinon rien.
        const couts = cohorte
          ? (() => {
              const w = windowCosts(attribution.rows, attribution.costs.promoBonusByDay, cohorte);
              return {
                promo: w.promo,
                promoBonus: w.bonus === null ? null : Math.round(w.bonus * 100) / 100,
                window: cohorte,
              };
            })()
          : { promo: attribution.costs.promo, promoBonus: attribution.costs.promoBonus, window: null };
        const coutPaie = rn
          ? acquisitionCostPerClient(couts, rn.payingMembers, null, cohorte)
          : null;
        const cout = toDisplayAmount(coutPaie, {
          payCurrency: attribution.payCurrency,
          revenueCurrency: churn.currency,
          fxRateToRevenue: attribution.fxRateToRevenue,
        });
        const concluant = rn !== null && rn.resolvedDueCount >= MIN_RESOLVED_DUE;
        const avertissements: string[] = [];
        if (!r.sampleSufficient) {
          avertissements.push(
            `${r.reachedTerm} abonnement(s) arrivé(s) à échéance, sous le seuil de ${SAMPLE_THRESHOLD} : les taux d'échéance ne sont pas interprétables.`,
          );
        }
        if (rn !== null && !concluant) {
          avertissements.push(
            `${rn.resolvedDueCount} échéance(s) tranchée(s), sous le seuil de ${MIN_RESOLVED_DUE} : ni taux de renouvellement ni projection n'est concluant.`,
          );
        }
        if (cout !== null && cout.rate === null) {
          avertissements.push(
            "Coût d'acquisition en devise de paie sans taux de change réglé : aucun ratio revenu/coût (null), jamais deux monnaies divisées l'une par l'autre.",
          );
        }
        // A5 — une devise SANS taux : le calcul rend 0 par abstention. Un 0 servi
        // tel quel se lit « aucun revenu » ; on sert null et on dit pourquoi.
        const devisesMelangees = rn !== null && rn.securedCurrencies.length > 1;
        const argent = <T,>(n: T): T | null => (devisesMelangees ? null : n);
        if (devisesMelangees) {
          avertissements.push(
            `Revenus encaissés dans plusieurs devises NON convertibles (${rn.securedCurrencies.join(", ")}) : aucun taux de change réglé pour au moins l'une d'elles. Tous les montants valent null (jamais une somme de devises mélangées) ; comptes et taux restent justes.`,
          );
        }
        if (churn.conversions.length > 0) {
          avertissements.push(
            `Une partie du revenu a été convertie au taux du projet (${churn.conversions
              .map((c) => `${c.from} × ${c.rate}`)
              .join(", ")}) : un taux posé à la main n'est pas une comptabilité.`,
          );
        }
        return json({
          projet: projet.slug,
          devise: churn.currency,
          cohorte:
            churn.cohortFrom !== null
              ? { du: churn.cohortFrom, au: churn.cohortTo, clientsAcquis: churn.cohortSize }
              : "toute la profondeur",
          clientsPayants: r.clients,
          sur90Jours: {
            resiliations: r.resiliations,
            expirations: r.expirations,
            tauxResiliationPct: r.cancelRate,
            delaiAvantResiliationHeures: { mediane: heures(r.medMsToCancel), neufSurDix: heures(r.p90MsToCancel) },
            resiliations_detail: r.resiliationDetails.slice(0, 20).map((d) => ({
              offre: offre(d.planId),
              payeLe: jour(d.firstPaidAt),
              resilieLe: jour(d.canceledAt),
              delaiHeures: heures(d.delayMs),
              ...(d.paidDuringOutage ? { payePendantLaPanneDuWebhook: true } : {}),
            })),
          },
          perteAVenir: {
            dansLesJours: HORIZON_DAYS,
            clients: r.upcomingExpirations.length,
            clientsPayantsApres: r.projectedClients,
            liste: r.upcomingExpirations.map((u) => ({ offre: offre(u.planId), finAcces: jour(u.accessEndsAt) })),
          },
          echeances: {
            arriveesAEcheance: r.reachedTerm,
            renouvelees: r.renewed,
            tauxPct: r.renewalRate,
            renouvellementsMoyens: r.avgRenewals,
            echantillonSuffisant: r.sampleSufficient,
          },
          ...(rn !== null
            ? {
                renouvellement: {
                  echeances: rn.due,
                  tranchees: rn.resolvedDueCount,
                  concluant,
                  tauxResoluPct: pctFraction(rn.renewalRateResolved),
                  tauxBorneBassePct: pctFraction(rn.renewalRateWorstCase),
                  montantEnAttente: argent(rn.pendingRenewalAmount),
                  causesEchec: rn.failureCauses,
                  cyclesMoyens: rn.averageCycles,
                  cyclesParClient: rn.cycleDistribution,
                },
                revenu: {
                  nouveau: argent(rn.newNet),
                  renouvellement: argent(rn.renewalNet),
                  origineInconnue: argent(rn.unknownNet),
                  paiementsOrigineInconnue: rn.unknownPayments,
                  partRenouvellementPct: pctFraction(rn.renewalShare),
                },
                parClient: {
                  revenuACeJour: rn.revenueToDatePerClient,
                  // Projection dérivée du TAUX, seulement si concluant ; à 100 %
                  // la formule diverge et l'écran affiche une borne basse (≥).
                  projete: concluant ? rn.projectedPerClientResolved : null,
                  ...(concluant && rn.projectedPerClientResolved === null
                    ? { projeteAuMoins: rn.projectedPerClientWorstCase }
                    : {}),
                  clientsAuNetSecurise: rn.securedMembers,
                  clientsDontToutEstEnLitige: rn.atRiskOnlyMembers,
                  coutAcquisition: montantAffiche(cout),
                  ratioRevenuACeJourSurCout: ratioRevenuCout(rn.revenueToDatePerClient, cout),
                  ratioProjeteBorneBasseSurCout: ratioRevenuCout(rn.projectedPerClientWorstCase, cout),
                },
                cohortesParSemaine: rn.cohorts.map((c) => ({
                  semaine: c.week,
                  clients: c.clients,
                  cycles: c.cycles,
                  net: argent(c.net),
                  netParClient: argent(c.netPerClient),
                  ...(c.cyclesWithoutNet > 0 ? { cyclesSansNet: c.cyclesWithoutNet } : {}),
                  ...(c.clients < COHORT_MIN_CLIENTS ? { anecdotique: true } : {}),
                })),
                cohortesMuresPct: pctFraction(rn.matureShare),
                parOffre: rn.byPlanOutcome.map((o) => ({
                  offre: offre(o.planId),
                  renouvelees: o.renewed,
                  enAttente: o.pending,
                  echouees: o.failed,
                  tauxResoluPct: pctFraction(o.rateResolved),
                  tauxBorneBassePct: pctFraction(o.rateWorstCase),
                  ...(o.topFailureCause ? { causePrincipaleEchec: o.topFailureCause } : {}),
                  montantEnAttente: argent(o.pendingAmount),
                })),
              }
            : {}),
          lecture: [
            "Cohorte = les clients ACQUIS sur la période, suivis depuis : une seule population (comme l'onglet). Sans du/au : toute la profondeur.",
            "« clients » compte ici des ABONNEMENTS Whop (une personne peut en avoir plusieurs) — pas les personnes d'economie_unitaire. Ne jamais comparer les deux sans le dire.",
            `Résiliations et expirations comptées sur les ${ANALYSIS_WINDOW_DAYS} derniers jours. RÉSILIÉ = a annulé mais garde l'accès jusqu'à la fin de la période payée ; EXPIRÉ = accès perdu, le vrai churn.`,
            "Taux de renouvellement « résolu » : sur les échéances tranchées ; « borne basse » : en comptant les échéances en attente comme perdues.",
            "Une cohorte « anecdotique » a trop peu de clients pour être une tendance.",
          ],
          ...(avertissements.length > 0 ? { avertissements } : {}),
        });
      }

      if (name === "marches") {
        const au =
          typeof args.au === "string" && args.au.trim() !== ""
            ? args.au.trim()
            : parisDayKey(Date.now() - 86_400_000);
        const du =
          typeof args.du === "string" && args.du.trim() !== ""
            ? args.du.trim()
            : shiftDay(au, -29);
        if (minuitParisDe(du) === null || minuitParisDe(au) === null) {
          throw new ToolError("« du » et « au » doivent être des jours AAAA-MM-JJ.");
        }
        if (du > au) throw new ToolError("« du » doit précéder « au ».");
        // Les bornes de l'écran : jours de Paris inclusifs → instants (même fonction).
        const bornes = windowToMs({ from: du, to: au });
        const pnl = await lire(() => ctx.runQuery(internal.mcpTools.lireMarches, { ...ids, ...bornes }));
        const groupes = await lire(() => ctx.runQuery(internal.mcpTools.lireGroupesMarches, ids));
        const produit = await lire(() => ctx.runQuery(internal.mcpTools.lireAnalyticsProduit, ids));
        // Le trafic suit la période, comme à l'écran (cf agregatsSurPeriode).
        const trafic = await agregatsSurPeriode(projet._id, produit, du, au);
        const maille = args.maille === "pays" ? "pays" : "marche";
        const marches = deriverMarches({
          pnl,
          traffic: trafic.recalcul?.funnels.countryPersons ?? produit.funnels.countryPersons,
          groups: groupes.map((g) => ({ id: g._id as string, nom: g.name, pays: g.countries })),
          maille,
          // Codes ISO : Claude les lit, et un nom traduit n'ajouterait rien.
          libellePays: (code) => code,
          libelleHorsMarche: "Aucun pays défini",
        });
        const filtre = typeof args.pays === "string" ? plier(args.pays) : null;
        const retenus =
          filtre === null
            ? marches
            : marches.filter(
                (m) =>
                  plier(m.label).includes(filtre) ||
                  m.countries.some((c) => c !== null && plier(c) === filtre),
              );
        // Les marchés SANS AUCUNE activité (trafic seul) sont résumés, pas listés :
        // 9 lignes à zéro sur 20 chez Snytch. Un filtre explicite les garde.
        const tousLesMarches = args.tous_les_marches === true || filtre !== null;
        const inactifs = tousLesMarches ? [] : retenus.filter(marcheInactif);
        const listes = tousLesMarches ? retenus : retenus.filter((m) => !marcheInactif(m));
        const { totalCost, totalRevenue, totalMarge } = lignesEtTotaux(pnl);
        const ctxDevises = contexteDevises(pnl);
        const verdicts: Record<string, string> = {
          accelerer: "accélérer",
          reparer: "réparer (le paiement casse)",
          surveiller: "surveiller",
          couper: "couper",
          trop_tot: "trop tôt",
          sans_depense: "sans dépense",
          inconnu: "inconnu (coût non convertible)",
        };
        const pct = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);
        const avertissements: string[] = [];
        if (!pnl.whopConfigured) {
          avertissements.push("Aucun compte Whop relié : ni clients ni revenu par marché, seulement les coûts.");
        }
        if (marches.some((m) => m.decision.verdict === "inconnu")) {
          avertissements.push(
            `Coûts en ${pnl.payCurrency ?? "devise de paie"} sans taux vers ${pnl.revenueCurrency ?? "la devise du revenu"} : aucun verdict ni ratio sur ces marchés (jamais deux monnaies comparées).`,
          );
        }
        if (trafic.erreur !== null) {
          avertissements.push(
            `Trafic : recalcul sur la période impossible (${trafic.erreur}) — le trafic affiché est celui des 90 derniers jours.`,
          );
        }
        return json({
          projet: projet.slug,
          periode: { du, au },
          traficSur: !produit.configured
            ? "PostHog non configuré : pas de trafic"
            : trafic.fenetre === null
              ? "aucune donnée PostHog sur la période"
              : trafic.recalcul !== null
                ? { du: trafic.fenetre.from, au: trafic.fenetre.to, source: "recalculé sur la période (bornée aux jours de données)" }
                : trafic.erreur === null
                  ? { source: "cache des 90 derniers jours (la période couvre toutes les données)" }
                  : { source: "cache des 90 derniers jours (recalcul impossible)" },
          maille: maille === "pays" ? "par pays" : "par marché (marchés composés regroupés)",
          devises: { revenu: pnl.revenueCurrency, paie: pnl.payCurrency, tauxPaieVersRevenu: pnl.fxRateToRevenue },
          total: {
            coutCreateurs: montantAffiche(toDisplayAmount(totalCost, ctxDevises)),
            revenuNet: Math.round(totalRevenue * 100) / 100,
            marge: totalMarge,
          },
          seuils: {
            depensePromoMinPourJuger: DECISION.minSpend,
            accelererSiRetourAuMoins: DECISION.goReturn,
            accelererSiClientsAuMoins: DECISION.goClients,
            couperSiRetourSous: DECISION.cutReturn,
            reparerSiCheckoutVersClientSousPct: DECISION.fixMaxCheckoutToClient * 100,
            checkoutsMinPourJugerLePaiement: DECISION.fixMinCheckouts,
          },
          marches: listes.map((m) => ({
            marche: m.label,
            pays: m.countries.filter((c): c is string => c !== null),
            ...(m.composed ? { compose: true } : {}),
            verdict: verdicts[m.decision.verdict] ?? m.decision.verdict,
            createatrices: m.creators,
            videos: m.videos,
            coutPromo: m.promoCostComparable,
            coutTotal: m.costComparable,
            clients: m.clients,
            paiements: m.payments,
            revenuNet: m.revenueNet,
            coutParClient: m.cac,
            panierMoyen: m.basket,
            cyclesParClient: m.cycles,
            revenuSurCout: m.retour,
            retourAcquisition: m.acquisitionReturn,
            valeurAcquisition: m.acquisitionValue,
            rembourseLeJour: m.payback.day,
            remboursement: m.payback.state,
            coutPour1000VuesPromo: m.costPer1000,
            valeurPour1000VuesPromo: m.rpmAcquisition,
            encaissePour1000VuesPromo: m.rpmCollected,
            vuesPromo: m.promoViews,
            evolutionClientsPct: pct(m.deltaClients),
            evolutionRevenuPct: pct(m.deltaRevenue),
            trafic: {
              visiteurs: m.visitors,
              checkouts: m.checkouts,
              clientsPostHog: m.trafficClients,
              conversionPct: pct(m.conversion),
              visiteVersCheckoutPct: pct(m.decision.visitToCheckout),
              checkoutVersClientPct: pct(m.decision.checkoutToClient),
            },
            // Les offres VENDUES, les plus vendues d'abord (cf offresVendues) :
            // l'agrégat les range par prix, et ses cinq premières étaient à 0 client.
            ...(() => {
              const { lignes, nonAffichees } = offresVendues(m.plans, 5);
              return {
                offres: lignes.map((p) => ({
                  offre: p.label ?? p.planId,
                  prix: p.price,
                  clients: p.clients,
                  partPct: pct(p.share),
                })),
                ...(nonAffichees > 0 ? { offresNonAffichees: nonAffichees } : {}),
              };
            })(),
          })),
          ...(inactifs.length > 0
            ? {
                marchesSansActivite: {
                  nombre: inactifs.length,
                  visiteurs: inactifs.reduce((t, m) => t + m.visitors, 0),
                  checkouts: inactifs.reduce((t, m) => t + m.checkouts, 0),
                  marches: inactifs.map((m) => m.label),
                  lecture:
                    "Ni dépense, ni vidéo, ni vue promo, ni paiement sur la période : seul le trafic (pays de connexion) les fait apparaître. Détail : tous_les_marches.",
                },
              }
            : {}),
          parMois: serieMensuelle(pnl).map((x) => ({
            mois: x.month,
            coutCreateurs: x.cost,
            revenuNet: x.revenueNet,
            ecart: x.ecart,
          })),
          lecture: [
            "L'argent (coût, clients, revenu) suit le pays de FACTURATION (Whop) ; le trafic, le pays de CONNEXION (PostHog). Côte à côte, jamais divisés l'un par l'autre.",
            "« clients » compte ici des ABONNEMENTS Whop (une personne peut en avoir plusieurs) — pas les personnes d'economie_unitaire. Ne jamais comparer les deux sans le dire. « trafic.clientsPostHog » compte, lui, des personnes PostHog.",
            "Montants dans la devise du revenu (coûts convertis au taux du projet). « retourAcquisition » = valeur des clients gagnés ÷ coût promo ; « revenuSurCout » = revenu net ÷ coût.",
            "Trafic : recalculé sur la période comme à l'écran (même calcul, même cache) ; « traficSur » dit sur quels jours il porte.",
            "Verdicts triés par ce qu'il faut faire d'abord ; « Aucun pays défini » = coût sans pays cible, hors marché.",
          ],
          ...(avertissements.length > 0 ? { avertissements } : {}),
        });
      }

      if (name === "paiements") {
        const { payCurrency, rows } = await lire(() => ctx.runQuery(internal.mcpTools.lirePaiements, ids));
        // LE regroupement de l'écran Paiements (convex/paymentsView).
        const vue = regrouperPaiements(rows, Date.now());
        const arrondi = (n: number) => Math.round(n * 100) / 100;
        const parDevise = (l: { currency: string | null; amount: number }[]) =>
          l.map((t) => ({ devise: t.currency, montant: arrondi(t.amount) }));
        const cycle = (c: (typeof rows)[number]) => ({
          du: jour(c.cycleStart),
          // cycleEnd est EXCLUSIF (début du cycle suivant) : dernier jour = veille.
          au: jour(c.cycleEnd - 86_400_000),
          statut: c.status === "paid" ? "payé" : "en cours",
          devise: c.currency,
          valeur: c.totalDue,
          ...(c.advances.length > 0
            ? { acomptes: arrondi(c.advances.reduce((s, a) => s + a.amount, 0)) }
            : {}),
          resteAVerser: c.remainingDue,
          detail: {
            fixe: c.pricingBreakdown?.fixedTotal ?? null,
            cpm: c.pricingBreakdown?.cpmTotal ?? null,
            paliers: c.pricingBreakdown?.bonusTierCashTotal ?? null,
            primesDeDefi: c.pricingBreakdown?.challengeTotal ?? null,
            bonusParVideo: c.pricingBreakdown?.videoBonusTotal ?? null,
          },
          ...((c.pricingBreakdown?.unmeasuredPayablePosts ?? 0) > 0
            ? { postsPayablesSansMesure: c.pricingBreakdown!.unmeasuredPayablePosts }
            : {}),
          ...(c.rushCount !== null ? { rushesDeposes: c.rushCount } : {}),
        });
        const garder = (nomCreatrice: string) => filtreNom(nomCreatrice, args.createatrice);
        const limite = typeof args.reglees === "number" ? args.reglees : 10;
        return json({
          projet: projet.slug,
          deviseDuProjet: payCurrency,
          // PAR DEVISE, jamais fondus : on ne vire pas des euros et des dollars
          // du même geste (cf convex/payCurrency).
          aVerser: parDevise(vue.aVerser),
          createatricesAPayer: vue.avecDu.length,
          cyclesDus: vue.cyclesDus,
          plusVieuxCycleDuDepuisJours: vue.ageDuPlusVieux,
          totalSurLHistorique: parDevise(vue.totalHistorique),
          parCreatrice: vue.avecDu
            .filter((g) => garder(g.creatorName))
            .map((g) => ({
              createatrice: g.creatorName,
              // Le TYPE de moyen seulement : jamais les coordonnées (IBAN, PayPal).
              moyenDePaiement: g.paymentMethod,
              devise: g.currency,
              resteAVerser: g.remaining,
              cycles: g.cycles.map(cycle),
            })),
          aZero: vue.aZero.filter((g) => garder(g.creatorName)).map((g) => g.creatorName),
          ...(limite > 0
            ? {
                derniersReglements: vue.reglees
                  .filter((p) => garder(p.creatorName))
                  .slice(0, limite)
                  .map((p) => ({ createatrice: p.creatorName, payeLe: jour(p.paidAt), ...cycle(p) })),
              }
            : {}),
          lecture: [
            "Un cycle = 30 jours glissants propres à chaque créatrice. « valeur » = ce que vaut le cycle ; « resteAVerser » = valeur − acomptes déjà versés (jamais négatif). « aVerser » = ce que « tout payer » verserait (hors créatrices supprimées).",
            "Un cycle en cours peut encore monter : une vidéo est rémunérée jusqu'à J+30 après publication. « postsPayablesSansMesure » = posts qui compteront mais dont les vues ne sont pas encore relevées.",
            "Chaque montant est dans la devise de SA créatrice (« devise » du cycle) : une créatrice n'est payée que dans une devise, mais un projet peut en mêler plusieurs. Les totaux (« aVerser », « totalSurLHistorique ») sont donc donnés PAR DEVISE, jamais additionnés.",
          ],
        });
      }

      if (name === "planning") {
        // Les missions ABANDONNÉES gardent leur jour prévu mais ne sortiront
        // jamais : hors du planning comme du calendrier de l'écran.
        const lignes = (await lire(() => ctx.runQuery(internal.mcpTools.lirePlanning, ids))).filter(
          (r) => isOnPublicationCalendar(r) && filtreNom(r.creatorName, args.createatrice),
        );
        const maintenant = Date.now();
        const horizon = typeof args.jours === "number" ? args.jours : 7;
        const libelles = {
          on_time: "à l'heure",
          late: "publié hors date",
          missed: "manqué",
          scheduled: "prévu",
        } as const;
        // LE statut du calendrier (convex/calendarStatus), jugé dans le fuseau de
        // la créatrice, comme l'écran et les notifications de retard.
        const planifiees = lignes
          .filter((r) => r.postDate != null)
          .map((r) => ({
            r,
            statut: calendarStatus({
              postDate: r.postDate,
              postedAt: r.postedAt,
              now: maintenant,
              timeZone: r.creatorTimezone,
            }) as Exclude<CalendarStatus, "none">,
          }));
        const item = ({ r, statut }: (typeof planifiees)[number]) => {
          const cible = r.targets[0];
          return {
            createatrice: r.creatorName,
            compte: cible?.accountHandle ?? null,
            plateforme: cible?.platform ?? null,
            pays: cible?.country ?? null,
            jourPrevu: plannedDayKey(r.postDate!),
            statut: libelles[statut],
            quoi: r.scriptCampaignName ?? r.formatName,
            ...(r.postedAt != null ? { publieLe: jour(r.postedAt) } : {}),
          };
        };
        const parJour = (a: (typeof planifiees)[number], b: (typeof planifiees)[number]) =>
          (a.r.postDate ?? 0) - (b.r.postDate ?? 0);
        // « Aujourd'hui » = le rappel admin de l'écran : prévu aujourd'hui, pas encore publié.
        const aujourdhui = planifiees.filter(
          ({ r }) => isSameLocalDay(r.postDate!, maintenant) && r.postedAt == null,
        );
        const manques = planifiees.filter((p) => p.statut === "missed").sort((a, b) => parJour(b, a));
        const horsDate = planifiees.filter((p) => p.statut === "late").sort((a, b) => parJour(b, a));
        const limiteAVenir = plannedDayKey(maintenant + horizon * 86_400_000);
        const aujourdhuiCle = plannedDayKey(maintenant);
        const aVenir = planifiees
          .filter(
            (p) =>
              p.statut === "scheduled" &&
              plannedDayKey(p.r.postDate!) > aujourdhuiCle &&
              plannedDayKey(p.r.postDate!) <= limiteAVenir,
          )
          .sort(parJour);
        const tally = onTimeTally(
          planifiees.map(({ r }) => ({ postDate: r.postDate, postedAt: r.postedAt, timeZone: r.creatorTimezone })),
          maintenant,
        );
        const nus = lignes.filter((r) => r.postDate == null);
        const limite = typeof args.limite === "number" ? args.limite : 30;
        const liste = (xs: (typeof planifiees)[number][]) => ({
          nombre: xs.length,
          ...(xs.length > limite ? { tronque: `${limite} premiers sur ${xs.length}` } : {}),
          posts: xs.slice(0, limite).map(item),
        });
        return json({
          projet: projet.slug,
          aujourdhui: { jour: aujourdhuiCle, aPublier: liste(aujourdhui) },
          manques: liste(manques),
          publiesHorsDate: liste(horsDate),
          aVenir: { jusquAu: limiteAVenir, ...liste(aVenir) },
          ponctualite: {
            aLHeure: tally.onTime,
            horsDate: tally.late,
            manques: tally.missed,
            prevus: tally.scheduled,
            postsPasses: tally.past,
            tauxALHeurePct: tally.rate === null ? null : Math.round(tally.rate * 1000) / 10,
          },
          sansDateDePublication: { total: nus.length, aFaire: nus.filter((r) => r.postedAt == null).length },
          lecture: [
            "Statut jugé dans le FUSEAU de la créatrice (une publication du 8 au soir à New York n'est pas en retard parce qu'il est déjà le 9 à Paris) ; le jour prévu est un jour de Paris.",
            "« manqué » = jour prévu passé chez elle, rien de publié ; « publié hors date » = publié, mais pas le jour prévu ; « prévu » compte le jour même (elle a encore la soirée).",
            "Taux à l'heure = à l'heure ÷ posts passés (hors « prévu ») — le même chiffre que le calendrier et les notifications de retard. Les posts sans date de publication n'y entrent pas.",
          ],
        });
      }

      if (name === "validation") {
        const { aRelire, publiees } = await lire(() => ctx.runQuery(internal.mcpTools.lireValidation, ids));
        const maintenant = Date.now();
        // LE créneau de la file (convex/reviewQueue), lu à l'heure de l'ÉQUIPE : le
        // serveur n'a pas de « jour local », l'écran d'un admin à Paris, si.
        const fuseau = "Europe/Paris";
        const creneaux = {
          overdue: "en retard (jour prévu passé, pas encore validée)",
          today: "à publier aujourd'hui",
          tomorrow: "à publier demain",
          upcoming: "plus tard",
          undated: "sans date prévue",
        } as const;
        const file = aRelire.filter((v) => filtreNom(v.creatorName, args.createatrice));
        const parCreneau = (c: keyof typeof creneaux) =>
          file.filter((v) => reviewSlot(v.postDate, maintenant, fuseau) === c).length;
        const limite = typeof args.limite === "number" ? args.limite : 30;
        const recentes = publiees.filter((p) => filtreNom(p.creatorName, args.createatrice));
        return json({
          projet: projet.slug,
          aRelire: {
            total: file.length,
            aPublierDemain: countTomorrow(file, maintenant, fuseau),
            parCreneau: {
              enRetard: parCreneau("overdue"),
              aujourdhui: parCreneau("today"),
              demain: parCreneau("tomorrow"),
              plusTard: parCreneau("upcoming"),
              sansDate: parCreneau("undated"),
            },
            ...(file.length > limite ? { tronque: `${limite} premières sur ${file.length}` } : {}),
            // Dans l'ordre de la file de l'écran : par date de publication prévue.
            videos: file.slice(0, limite).map((v) => ({
              createatrice: v.creatorName,
              quoi: v.label,
              ...(v.challengeName ? { defi: v.challengeName } : {}),
              comptes: v.targets.map((t) => `${t.accountHandle ?? "?"} (${t.platform})`),
              jourPrevu: v.postDate == null ? null : plannedDayKey(v.postDate),
              creneau: creneaux[reviewSlot(v.postDate, maintenant, fuseau)],
              echeance: jour(v.dueDate),
              ...(v.comboSummary ? { combo: v.comboSummary } : {}),
            })),
          },
          publieesRecemment: recentes.slice(0, limite).map((p) => ({
            createatrice: p.creatorName,
            quoi: p.label,
            publieLe: jour(p.publishedAt),
            liens: p.targets.map((t) => t.publishedUrl).filter((u): u is string => u !== null),
          })),
          lecture: [
            "« aRelire » = vidéos soumises par les créatrices, en attente de validation avant publication, dans l'ordre de la file (date de publication prévue).",
            "Créneaux lus à l'heure de Paris (l'écran les lit à l'heure de l'admin) : « demain » est ce qui doit être validé en priorité.",
            "Pour VOIR une vidéo de la file : `regarder_video` avec la créatrice et son jour prévu (images clés + script attendu).",
          ],
        });
      }

      if (name === "regarder_video") {
        const v = await lire(() =>
          ctx.runQuery(internal.mcpTools.lireVideoSoumise, { ...ids, ...designationDepuis(args) }),
        );
        const mission = {
          projet: projet.slug,
          mission: v.libelle,
          statut: v.statut,
          hookAttendu: v.hookAttendu,
          ctaAttendu: v.ctaAttendu,
          scriptAttendu: v.script,
          consigne: v.consigne,
          texteAIncruster: v.texteAIncruster,
          plageHoraire: v.plage,
          ...(v.retourPrecedent ? { refusPrecedent: v.retourPrecedent } : {}),
        };
        if (v.uid === null || v.streamStatus !== "ready") {
          return json({
            ...mission,
            images: [],
            pourquoi:
              v.uid !== null && v.streamStatus === "processing"
                ? "La vidéo est encore en transcodage chez Cloudflare : réessaie dans quelques minutes, ou regarde-la dans l'écran Validation."
                : "Cette vidéo n'a pas de copie Cloudflare Stream lisible (ancienne, ou copie échouée) : je ne peux pas en tirer d'images. Elle se regarde dans l'écran Validation.",
          });
        }
        const config = cloudflareStreamConfig();
        const uid = v.uid;
        const langue = langueTranscription(v.locale);
        const duree = config ? await fetchStreamDuration(config, uid) : null;
        const [{ vignettes, echecs }, ecoute] = await Promise.all([
          lireVignettes(uid, instantsDeLaVideo(duree), fetch),
          transcription(
            config
              ? {
                  lister: () => listStreamCaptions(config, uid),
                  lancer: () => generateStreamCaptions(config, uid, langue),
                  vtt: () => fetchStreamCaptionsVtt(config, uid, langue),
                }
              : null,
            langue,
          ),
        ]);
        const derniere = ecoute.etat === "prete" ? ecoute.repliques[ecoute.repliques.length - 1] : undefined;
        const fin = duree ?? derniere?.fin ?? 0;
        const dit =
          ecoute.etat === "prete"
            ? {
                langue,
                ditAuDebut: ditEntre(ecoute.repliques, 0, 4) || null,
                ditALaFin: ditEntre(ecoute.repliques, Math.max(fin - 6, 0), fin + 1) || null,
                repliques: ecoute.repliques.slice(0, 80).map((r) => `[${instantTexte(r.debut)}] ${r.texte}`),
                ...(ecoute.repliques.length === 0 ? { remarque: "Rien de transcrit : vidéo sans parole, ou parole inaudible." } : {}),
              }
            : {
                langue,
                etat:
                  ecoute.etat === "lancee"
                    ? "Transcription lancée à l'instant (gratuite) : rappelle regarder_video dans une minute pour entendre la vidéo."
                    : ecoute.etat === "en_cours"
                      ? "Transcription en cours chez Cloudflare : rappelle regarder_video dans une minute."
                      : ecoute.etat === "indisponible"
                        ? "Transcription indisponible : Cloudflare Stream n'est pas configuré sur ce déploiement."
                        : `Transcription impossible : ${ecoute.message}`,
              };
        const valider = domaines.some((d) => d.scope === "publications");
        const entete = {
          ...mission,
          duree: duree === null ? null : instantTexte(duree),
          images: vignettes.map((x) => instantTexte(x.secondes)),
          ...(echecs.length > 0 ? { imagesManquantes: echecs.map(instantTexte) } : {}),
          ce_qui_est_dit: dit,
          lecture: [
            "Images FIXES (pas le mouvement) : juge ce qui se voit — texte incrusté (présent, lisible, conforme), cadrage vertical, la fin (CTA).",
            "Ce qui est DIT vient d'une transcription automatique : approximative sur les noms propres et les chiffres. Compare l'IDÉE au hook et au CTA attendus (ditAuDebut, ditALaFin), pas le mot à mot.",
            vignettes.length === 0
              ? "Aucune image n'a pu être lue : ne conclus rien sur cette vidéo, renvoie vers l'écran Validation."
              : "Chaque image est précédée de son instant dans la vidéo.",
            valider
              ? "Pour trancher : `valider_video` ou `refuser_video` (avec un motif concret) — après mon accord ; chacun envoie un email à la créatrice."
              : "Cette connexion ne peut pas valider ni refuser : propose ton avis, la décision se prend dans l'écran Validation.",
          ],
        };
        return {
          content: [
            { type: "text", text: JSON.stringify(entete, null, 1) },
            ...vignettes.flatMap((x) => [
              { type: "text" as const, text: `Image à ${instantTexte(x.secondes)}` },
              { type: "image" as const, data: x.data, mimeType: x.mimeType },
            ]),
          ],
        };
      }

      if (name === "defis") {
        const liste = await lire(() => ctx.runQuery(internal.mcpTools.lireDefis, ids));
        const statuts = { draft: "brouillon", active: "ouvert", closed: "clos" } as const;
        const recompense = (r: { type: string; amount?: number; libelle?: string; coutReel?: number }) =>
          r.type === "cash"
            ? { type: "argent", montantParGagnante: r.amount ?? null }
            : { type: "nature", objet: r.libelle ?? null, coutReel: r.coutReel ?? null };
        const regle = (w: { kind: string; n?: number }) =>
          w.kind === "first" ? "la première" : w.kind === "topN" ? `les ${w.n} premières` : "toutes celles qui franchissent";
        const resume = (c: (typeof liste)[number]) => ({
          defi: c.name,
          statut: statuts[c.status as keyof typeof statuts] ?? c.status,
          ...(c.hiddenAt !== null ? { masque: true } : {}),
          objectifVues: c.targetViews,
          mode: c.mode === "cumulative" ? "vues cumulées de ses vidéos" : "sa meilleure vidéo seule",
          echeance: jour(c.deadline),
          recompense: recompense(c.reward),
          gagnantes: regle(c.winnerRule),
          participantes: c.participantCount,
          victoires: c.winCount,
          termine: c.over,
        });
        const demande = typeof args.defi === "string" ? args.defi.trim() : "";
        if (demande === "") {
          return json({ projet: projet.slug, defis: liste.map(resume) });
        }
        // Le nom exact d'abord, sinon une sous-chaîne qui ne désigne qu'UN défi.
        const exact = liste.filter((c) => plier(c.name) === plier(demande));
        const proches = exact.length > 0 ? exact : liste.filter((c) => plier(c.name).includes(plier(demande)));
        if (proches.length !== 1) {
          throw new ToolError(
            `Défi « ${demande} » introuvable ou ambigu. Défis possibles : ${liste.map((c) => c.name).join(", ") || "aucun"}.`,
          );
        }
        const choisi = proches[0];
        const d = await lire(() => ctx.runQuery(internal.mcpTools.lireDefi, { ...ids, id: choisi._id }));
        if (!d.detail) throw new ToolError(`Défi « ${choisi.name} » introuvable.`);
        const { detail, apercu } = d;
        return json({
          projet: projet.slug,
          ...resume(choisi),
          ...(detail.challenge.description ? { description: detail.challenge.description } : {}),
          classement: detail.ranking.map((r) => ({
            rang: r.rank,
            createatrice: r.name,
            score: r.score,
            videosComptees: r.videoCount,
            aFranchiLObjectif: r.crossed,
          })),
          // « victoires » (le NOMBRE) vient du résumé ; la liste a son propre nom.
          victoiresActees: detail.wins.map((w) => ({
            position: w.position,
            createatrice: w.creatorName,
            le: jour(w.wonAt),
            scoreAuMomentDeGagner: w.scoreAtWin,
            ...(w.cancelledAt !== null ? { annulee: jour(w.cancelledAt), motif: w.cancelReason } : {}),
          })),
          gagneraientMaintenant: (apercu?.wouldWin ?? []).map((w) => ({ createatrice: w.name, score: w.score })),
          videos: detail.videos.slice(0, 30).map((v) => ({
            createatrice: v.creatorName,
            vues: v.views,
            comptee: v.counted,
            ...(v.removedAt !== null ? { retiree: jour(v.removedAt) } : {}),
            liens: v.publishedUrls,
          })),
          lecture: [
            "Score = vues cumulées des vidéos du défi (mode cumulé) ou vues de la meilleure (mode unique) ; seules les vidéos publiées et non retirées comptent.",
            "« gagneraientMaintenant » = qui décrocherait une place si la victoire était actée maintenant (règle de gagnantes, échéance comprise).",
            "La récompense est PAR gagnante. Le « coutReel » d'une récompense en nature est ce qu'elle coûte au projet, jamais montré aux créatrices.",
          ],
        });
      }

      if (name === "veille") {
        const vue = (args.vue as string | undefined) ?? "comptes";
        const limite = typeof args.limite === "number" ? args.limite : 20;
        const nombre = (n: number | null | undefined) => (typeof n === "number" ? n : null);
        const pct = (x: number | null | undefined) => (typeof x === "number" ? Math.round(x * 1000) / 10 : null);

        if (vue === "tendances") {
          const pays = typeof args.pays === "string" ? args.pays.trim().toUpperCase() : "";
          if (!TREND_COUNTRIES.includes(pays as (typeof TREND_COUNTRIES)[number])) {
            throw new ToolError(`« pays » est requis pour les tendances : ${TREND_COUNTRIES.join(", ")}.`);
          }
          const demande = typeof args.hashtag === "string" ? args.hashtag.trim().replace(/^#/, "") : "";
          const t = await lire(() => ctx.runQuery(internal.mcpTools.lireTendances, { ...ids, countryCode: pays }));
          if (demande === "") {
            return json({
              projet: projet.slug,
              pays,
              releveLe: jour(t.fetchedAt),
              hashtags: t.hashtags.slice(0, limite).map((h) => ({
                rang: h.rank,
                // Tel que stocké (TikTok le renvoie avec son « # »).
                hashtag: h.hashtag,
                posts: h.posts,
                vuesVideos: h.videoViews,
                tendance: h.trendDirection,
                createursEnTete: h.topCreators,
                lien: h.tiktokUrl,
              })),
              lecture: ["Hashtags tendance du pays tels que le dernier relevé les a rangés ; appelle avec « hashtag » pour ses vidéos."],
            });
          }
          // La forme STOCKÉE (avec « # ») est la clé des vidéos : on la retrouve dans
          // la liste du pays, que la demande porte le « # » ou non.
          const trouve = t.hashtags.find((h) => plier(h.hashtag.replace(/^#/, "")) === plier(demande));
          if (!trouve) {
            throw new ToolError(
              `Hashtag « ${demande} » absent des tendances ${pays}. Hashtags : ${t.hashtags.map((h) => h.hashtag).join(", ") || "aucun"}.`,
            );
          }
          const vids = await lire(() =>
            ctx.runQuery(internal.mcpTools.lireVideosTendance, { ...ids, countryCode: pays, hashtag: trouve.hashtag }),
          );
          return json({
            projet: projet.slug,
            pays,
            hashtag: trouve.hashtag,
            videos: [...vids]
              .sort((a, b) => b.views - a.views)
              .slice(0, limite)
              .map((v) => ({
                compte: v.authorHandle ?? null,
                vues: v.views,
                likes: v.likes,
                commentaires: v.comments,
                partages: v.shares,
                engagementPct: pct(v.engagement),
                publieLe: jour(v.publishedAt),
                legende: v.caption ?? null,
                lien: v.url,
              })),
          });
        }

        const comptes = await lire(() => ctx.runQuery(internal.mcpTools.lireComptesVeille, ids));
        if (vue === "comptes") {
          return json({
            projet: projet.slug,
            comptesSuivis: comptes.accounts.length,
            limite: comptes.limit,
            comptes: comptes.accounts.map((a) => ({
              compte: a.handle,
              note: a.note,
              abonnes: nombre(a.authorFansSnapshot),
              videos: a.videoCount,
              dernierReleve: jour(a.lastSyncAt),
            })),
          });
        }

        // vue === "videos" : le mur, un compte ou tous.
        const demande = typeof args.compte === "string" ? plier(args.compte.replace(/^@/, "")) : null;
        const compte =
          demande === null ? null : comptes.accounts.find((a) => plier(a.handle.replace(/^@/, "")) === demande);
        if (demande !== null && !compte) {
          throw new ToolError(
            `Compte « ${args.compte} » absent de la veille. Comptes suivis : ${comptes.accounts.map((a) => a.handle).join(", ") || "aucun"}.`,
          );
        }
        const mur = await lire(() =>
          ctx.runQuery(internal.mcpTools.lireMurVeille, { ...ids, ...(compte ? { accountId: compte._id } : {}) }),
        );
        const video = (v: (typeof mur)[number]) => ({
          compte: v.accountHandle,
          vues: v.views,
          likes: v.likes,
          commentaires: v.comments,
          partages: v.shares,
          enregistrements: v.saves ?? null,
          engagementPct: pct(v.engagement),
          publieLe: jour(v.publishedAt),
          dureeSec: v.durationSec ?? null,
          legende: v.caption ?? null,
          ...(v.hashtags && v.hashtags.length > 0 ? { hashtags: v.hashtags } : {}),
          lien: v.url,
        });
        return json({
          projet: projet.slug,
          ...(compte ? { compte: compte.handle } : {}),
          populaires: mur.filter((v) => v.bucket === "popular").slice(0, limite).map(video),
          recentes: mur.filter((v) => v.bucket === "recent").slice(0, limite).map(video),
          lecture: [
            "Le mur de l'écran Veille : « populaires » = les plus vues au dernier relevé ; « récentes » = les autres, de la plus récente à la plus ancienne (épinglées exclues).",
            "Engagement = (likes + commentaires + partages) ÷ vues, calculé comme à l'écran.",
          ],
        });
      }

      if (name === "fiabilite") {
        const r = await lire(() => ctx.runQuery(internal.mcpTools.lireFiabilite, ids));
        const maintenant = Date.now();
        // LES contrôles de l'écran : même traduction du payload, même module.
        const controles = buildCoherenceChecks(coherenceInputsFrom(r.coherence));
        const etatControle = { ok: "ok", info: "info", violation: "écart" } as const;
        const doublons = r.membershipDuplicates;
        const repartition = new Map<number, number>();
        for (const d of doublons.duplicates) repartition.set(d.count, (repartition.get(d.count) ?? 0) + 1);
        return json({
          projet: projet.slug,
          posthogConfigure: r.configured,
          derniereSynchroPosthog: instantParis(r.computedAt),
          controles: controles.map((c) => ({ controle: c.label, etat: etatControle[c.status], detail: c.detail || null })),
          ecarts: controles.filter((c) => c.status === "violation").length,
          instrumentation: {
            evenements: r.instrumentation.events.map((e) => ({
              evenement: e.name,
              personnes: e.persons === 0 ? null : e.persons,
              premiereEmission: jour(e.firstSeenMs),
              etat: e.persons === 0 ? (e.notYetEmitted ? "attendu, absent" : "absent") : e.note ? "à surveiller" : "sain",
              ...(e.persons > 0 && e.note ? { note: e.note } : {}),
            })),
            proprietes: r.instrumentation.props.map((p) => ({
              propriete: p.key,
              surEvenement: p.onEvent,
              emise: p.present > 0,
              evenementsLaPortant: p.present,
            })),
          },
          comptesInternesExclus: {
            personnesPostHog: r.internalExcluded.persons,
            surPersonnesPostHog: r.internalExcluded.totalPersons,
            abonnementsWhop: r.whopInternalExcluded,
          },
          abonnementsParPersonne:
            doublons.memberships === 0
              ? null
              : {
                  abonnements: doublons.memberships,
                  personnes: doublons.users,
                  personnesAvecPlusieurs: doublons.duplicates.length,
                  repartition: [...repartition.entries()]
                    .sort((a, b) => a[0] - b[0])
                    .map(([abonnements, personnes]) => ({ abonnements, personnes })),
                },
          nonMesurable: [
            {
              quoi: "Assignations sans date de post",
              ...(r.publicationCoverage.total === 0
                ? { pourquoi: "aucune assignation" }
                : {
                    sansDate: r.publicationCoverage.unplanned,
                    sur: r.publicationCoverage.total,
                    pourquoi: "hors du taux à l'heure, des deux côtés de la fraction",
                  }),
            },
            ...NOT_MEASURABLE.map((x) => ({ quoi: x.what, pourquoi: x.why })),
          ],
          rupturesDeSerie: SERIES_BREAKS.map((b) => ({ depuis: b.since, quoi: b.what, effet: b.effect })),
          fraicheur: r.freshness.map((f) => ({
            source: FRESHNESS_SOURCE_LABELS[f.source] ?? f.source,
            derniereSynchro: instantParis(f.lastSyncMs),
            etat: isFreshnessStale(f.source, f.lastSyncMs, maintenant) ? "périmé" : "frais",
            perimeeAuDelaDeHeures: freshnessStaleHours(f.source),
          })),
          lecture: [
            "Les contrôles de cohérence de l'onglet Fiabilité, composés par le même module que l'écran. Un « écart » suspend à l'écran les chiffres qui en dépendent.",
            "Une source est « périmée » sans synchro depuis plus que SON seuil (perimeeAuDelaDeHeures) : 12 h pour PostHog et Whop, synchronisés plusieurs fois par jour ; 30 h pour les vues, relevées une seule fois par nuit à 23 h 30. Lire les ruptures de série avant de comparer deux périodes qui les traversent.",
            "Abonnements par personne : une personne peut avoir plusieurs abonnements Whop ; les identifiants ne sont pas donnés ici (voir l'écran).",
          ],
        });
      }

      if (name === "parcours") {
        const { du, au } = periodeDemandee(args);
        const produit = await lire(() => ctx.runQuery(internal.mcpTools.lireAnalyticsProduit, ids));
        if (!produit.configured) {
          return json({
            projet: projet.slug,
            configure: false,
            message: "PostHog n'est pas configuré sur ce projet : pas de tunnel ni de trafic.",
          });
        }
        const periode = await agregatsSurPeriode(projet._id, produit, du, au);
        // Les quatre agrégats que la période change — les mêmes que l'onglet.
        const a = periode.recalcul ?? produit;
        const fiabilite = await lire(() => ctx.runQuery(internal.mcpTools.lireFiabilite, ids));
        const facturation = await lire(() => ctx.runQuery(internal.mcpTools.lirePaysFacturation, ids));

        const seq = a.funnels.sequential.segments[0]?.steps ?? [];
        const atteinte = new Map((a.funnels.global.segments[0]?.steps ?? []).map((s) => [s.key, s.count]));
        const tunnel = buildFunnel(
          seq.map((s) => ({ key: s.key, label: PARCOURS_FUNNEL_LABELS[s.key] ?? s.key, count: s.count })),
        );
        const rows = a.checkoutReliability.rows;
        const perte = checkoutLoss(rows);
        const delai = payDelay(rows);
        const sec = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);
        const ecartWhop = whopWithoutAppAccess(fiabilite.coherence);
        const activation = (recent: boolean) =>
          aggregateActivation(a.activation.rows, recent).map((r) => ({
            type: ACTIVATION_SEGMENT_LABELS[r.segment] ?? r.segment,
            inscrits: r.persons,
            ontSaisiUnCompte: r.usernameEntered,
            ontAjouteUneCible: r.targetAdded,
            premiereAlerte: r.firstAlert,
          }));
        const pctFraction = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);
        const segments = (payload: SegmentPayload, split: readonly SplitRow[], avecVentes: boolean) => {
          const { rows: lignes, unknownShare, unknownVisitors } = buildSegmentRows(payload);
          const couverture = clientCoverage(split);
          return {
            inconnuPct: pctFraction(unknownShare),
            visiteursInconnus: unknownVisitors,
            lignes: lignes
              .filter((r) => r.key !== UNKNOWN_SEGMENT)
              .map((r) => ({
                segment: r.key,
                visiteurs: r.visit,
                inscrits: r.signup,
                checkouts: r.checkout,
                ...(avecVentes ? { clients: r.subs, visiteVersClientPct: pctFraction(r.rate) } : {}),
              })),
            ...(couverture.length > 0
              ? {
                  mesureCoteNavigateur: couverture.map((c) => ({
                    etape: c.event,
                    partPct: pctFraction(c.share),
                    nonMesurable: c.unmeasurable,
                  })),
                }
              : {}),
          };
        };

        const avertissements: string[] = [];
        if (periode.erreur !== null) {
          avertissements.push(
            `Recalcul sur la période impossible (${periode.erreur}) : chiffres des 90 derniers jours.`,
          );
        }
        const f = periode.fenetre;
        if (f !== null && f.from < "2026-07-29") {
          avertissements.push(
            "Tunnel corrigé le 29/07 : l'ordre des étapes était faux avant, les taux séquentiels d'avant ne se comparent pas à ceux d'après.",
          );
        }
        if (f !== null && f.from <= "2026-07-28" && f.to >= "2026-07-28") {
          avertissements.push(
            "Webhook de confirmation réparé le 28/07 au soir : les délais et taux de complétion qui traversent cette date ne sont comparables à rien.",
          );
        }
        if (f !== null && [...posthogOutageDays()].some((j) => j >= f.from && j <= f.to)) {
          avertissements.push(
            "Ingestion PostHog coupée du 07/09 21:00 au 08/09 11:53 (Paris) : visiteurs, inscriptions et paywalls sont creux sur ces heures ; clients et revenu viennent de Whop et restent justes.",
          );
        }

        return json({
          projet: projet.slug,
          periode: decrirePeriode(periode),
          tunnel: tunnel.map((t) => ({
            etape: t.label,
            personnes: t.count,
            partDesVisiteursPct: t.shareOfStart,
            perduesDepuisEtapePrecedente: t.droppedCount,
            perteDepuisEtapePrecedentePct: t.dropPct,
            concluant: t.conclusive,
            atteinteBrute: {
              libelle: PARCOURS_REACH_LABELS[t.key] ?? t.key,
              personnes: atteinte.get(t.key) ?? null,
            },
          })),
          checkoutsSansPaiement: {
            detournesVersLeGratuit: perte.divertedFree,
            echecDePaiementSansSuite: perte.failedPayment,
            disparusSansTentative: perte.disappeared,
            total: perte.total,
          },
          parAppareil: {
            checkoutsAvecAppareilConnuPct: deviceCoveragePct(rows),
            appareils: checkoutByDevice(rows).map((d) => ({
              contexte: d.label,
              checkouts: d.n,
              payes: d.converted,
              conversionPct: d.rate,
              concluant: d.conclusive,
            })),
          },
          delaiJusquAuPaiement: {
            medianeSec: sec(delai.medMs),
            neufSurDixSousSec: sec(delai.p90Ms),
            ancienSeuilTimeoutSec: sec(APP_TIMEOUT_MS),
          },
          paiementsWhopSansAccesApp:
            ecartWhop === null
              ? null
              : {
                  ecart: Math.max(0, ecartWhop.gap),
                  clientsWhop: ecartWhop.whop,
                  abonnesApp: ecartWhop.app,
                  sur: "toute la profondeur (pas la période)",
                },
          traficParPaysDeConnexion: segments(a.funnels.country, a.serverSideSplit.rows, false),
          traficParLangue: segments(a.funnels.language, [], true),
          ventesParPaysDeFacturation: {
            sur: "toute la profondeur (pas la période)",
            devise: "currency" in facturation ? (facturation.currency ?? null) : null,
            clientsAvecPays: facturation.clientsWithCountry,
            clients: facturation.clients,
            paiementsAvecPays: facturation.withCountry,
            paiements: facturation.payments,
            pays: facturation.rows.map((r) => ({
              pays: r.country,
              clients: r.clients,
              renouvellements: r.renewals,
              echecs: r.failures,
              revenuNet: r.net,
            })),
          },
          activation: {
            tousLesInscrits: activation(false),
            depuisLe28Juillet: activation(true),
          },
          lecture: [
            "Le tunnel est SÉQUENTIEL : chaque perte porte sur l'étape juste au-dessus. L'atteinte brute compte les personnes par étape quel que soit l'ordre (anonymes, double émission client + serveur) : elle peut dépasser le tunnel.",
            "Pays de CONNEXION (IP, PostHog) et pays de FACTURATION (Whop) sont deux populations : ne jamais diviser les ventes de l'un par le trafic de l'autre. Pas de colonne clients par pays de connexion : l'événement de souscription part surtout du serveur.",
            "Les lignes par segment ne s'additionnent pas (une personne peut visiter depuis deux pays). « inconnuPct » = part des visiteurs non attribués : le classement ne décrit que le reste.",
            "Activation : hors tunnel de paiement. La vue « depuis le 28/07 » ne garde que la période où payants, gratuits et inscrits sans accès sont comparables.",
          ],
          ...(avertissements.length > 0 ? { avertissements } : {}),
        });
      }

      if (name === "offres") {
        const { du, au } = periodeDemandee(args);
        const produit = await lire(() => ctx.runQuery(internal.mcpTools.lireAnalyticsProduit, ids));
        const periode = await agregatsSurPeriode(projet._id, produit, du, au);
        // Les sept agrégats que la période change — les mêmes que l'onglet.
        const a = periode.recalcul ? { ...produit, ...periode.recalcul.offres } : produit;
        const revenu = await lire(() => ctx.runQuery(internal.mcpTools.lireRevenus, ids));
        const attribution = await lire(() => ctx.runQuery(internal.mcpTools.lireAttribution, ids));
        const f = periode.fenetre;
        const bras = (v: string) => AB_ARM_LABELS[v] ?? v;
        const devise = revenu.currency ?? null;

        const arms = abArmRows(a.abArms.rows);
        const alertes = abArmChecks(arms).filter((c) => c.status !== "ok");
        const resume = abArmSummary(arms);
        // Le revenu par bras porte sur la MÊME population que les assignés : sur une
        // période recalculée, les abonnements ACQUIS dedans (comme l'écran) ; sinon
        // tout le test, comme les compteurs du cache.
        const fenetreRecalculee = periode.recalcul !== null ? periode.fenetre : null;
        const abRev =
          (fenetreRecalculee !== null
            ? await lire(() =>
                ctx.runQuery(internal.mcpTools.lireRevenuBrasPeriode, {
                  ...ids,
                  ...windowToMs(fenetreRecalculee),
                }),
              )
            : null) ?? revenu.abRevenue;
        const netParBras = new Map(abRev.rows.map((r) => [r.variant, r] as const));

        const offres = attributedOffers(a.abOffers.rows, revenu.plans);
        const comparabilite = armComparability(a.abOffers.rows, revenu.plans);
        const achats = armPurchases(a.abPurchases.rows, revenu.plans, {
          revenueCurrency: revenu.currency ?? null,
          payCurrency: attribution.payCurrency ?? null,
          fxRateToRevenue: attribution.fxRateToRevenue ?? null,
          otherRates: revenu.fxRates ?? null,
        });
        const incoherences = purchaseCoherenceIssues(
          achats,
          new Map(a.abArms.rows.map((r) => [r.variant, r.paid] as const)),
        );
        const paywalls = a.paywallById.rows;
        const paywallsMesures = paywalls.some((r) => r.key !== "(inconnu)" && r.key !== "(absent)");
        const scans = scanCostRows(a.scanCost.rows);
        const libelleContrat = (id: string) => EXPECTED_PAYWALL_IDS.find((p) => p.id === id);

        const avertissements: string[] = [];
        if (periode.erreur !== null) {
          avertissements.push(`Recalcul sur la période impossible (${periode.erreur}) : chiffres PostHog des 90 derniers jours.`);
        }
        if (f !== null && [...posthogOutageDays()].some((j) => j >= f.from && j <= f.to)) {
          avertissements.push(
            "Ingestion PostHog coupée du 07/09 21:00 au 08/09 11:53 (Paris) : paywalls vus et conversions creux sur ces heures ; le revenu vient de Whop et reste juste.",
          );
        }
        if (alertes.length > 0) {
          avertissements.push(
            `Contrôle du tableau A/B : ${alertes.length} écart(s) — ${alertes.map((c) => `${c.label} : ${c.detail}`).join(" · ")}. Corriger avant de décider quoi que ce soit sur ce test.`,
          );
        }
        if (incoherences.length > 0) {
          avertissements.push(`Achats par bras incohérents avec le tableau des bras : ${incoherences.join(" · ")}.`);
        }

        return json({
          projet: projet.slug,
          periode: decrirePeriode(periode),
          typesDePaywall: paywallTypeRows(a.abVariants.rows).map((v) => ({
            type: PAYWALL_TYPE_LABELS[v.variant] ?? v.variant,
            exposes: v.exposed,
            checkouts: v.checkouts,
            payes: v.paid,
            completionPct: v.completion,
            ciblesParClient: v.targetsPerClient,
          })),
          testAB:
            arms.length === 0
              ? { enCours: false, message: "Aucun bras assigné naturellement (sessions à bras forcé exclues)." }
              : {
                  enCours: true,
                  depuis: jour(a.abArms.startMs),
                  concluant: resume.concluant,
                  seuilParBras: AB_THRESHOLD,
                  plusPetitBras: resume.minExposed,
                  recruesManquantes: resume.remaining,
                  bras: arms.map((r) => {
                    const rev = netParBras.get(r.variant);
                    return {
                      bras: bras(r.variant),
                      assignes: r.exposed,
                      ontVuLePaywall: r.paywallViewers,
                      checkouts: r.checkouts,
                      nouveauxClients: r.paid,
                      renouvellementsExclus: r.renewals,
                      completionPct: r.completion,
                      ciblesParClient: r.targetsPerClient,
                      ...(r.targetsPerClient === null && r.paid > 0 ? { ciblesNonMesurees: true } : {}),
                      netParAssigne:
                        !rev || rev.memberships === 0
                          ? null
                          : { valeur: netPerAssigned(rev.net, r.exposed), devise },
                      ...(rev && rev.atRiskMemberships > 0
                        ? { enLitige: { abonnements: rev.atRiskMemberships, montant: rev.atRiskAmount, devise } }
                        : {}),
                    };
                  }),
                  ecartees: {
                    personnes: resume.excluded,
                    surUnSeulAppareil: resume.excludedSameDevice,
                    surPlusieursAppareils: resume.excludedMultiDevice,
                  },
                  revenu: {
                    abonnementsEcartes: abRev.excludedFlippers,
                    netEcarte: abRev.excludedFlippersNet,
                    rattachementsDivergents: abRev.divergences.length,
                    abonnementsNonRattaches: abRev.unattached,
                    devise,
                  },
                  rupture: `Le ${AB_BREAK_LABEL} : avant, le bras était tiré deux fois (navigateur puis serveur) et divergeait ; les données d'avant ne se comparent pas à celles d'après.`,
                },
          offresServies: {
            brasComparables: comparabilite.comparable,
            enCeMoment: comparabilite.current.map((o) => ({ bras: bras(o.variant), offre: o.label })),
            lignes: offres.map((o) => ({
              bras: bras(o.variant),
              offre: o.label,
              prix: o.amount,
              devise: o.currency,
              rythme: o.interval,
              du: instantParis(o.firstMs),
              au: instantParis(o.lastMs),
              ontVu: o.paywallViewers,
              checkouts: o.checkouts,
              payes: o.paid,
              conversionPct: o.conversionPct,
              revenu1erCyclePour1000Vues: o.firstCycleRevenuePer1000,
            })),
            personnesEcartees: excludedViewers(a.abOffers.rows),
          },
          achatsReels: achats.map((b) => ({
            bras: bras(b.variant),
            clients: b.armClients,
            ontAchetePlusieursOffres: b.armMultiPlan,
            lignes: b.rows.map((r) => ({
              offre: r.label,
              prix: r.price,
              devise: r.currency,
              rythme: r.interval,
              clients: r.clients,
              partPct: r.sharePct,
            })),
            revenu1erCycle: b.firstCycleRevenue,
            devise: b.currency,
          })),
          conversionParPaywall: paywallsMesures
            ? {
                depuis: jour(a.paywallById.startMs),
                paywalls: computeConversion(
                  paywalls.map((r) => ({ key: r.key, label: r.key, n: r.n, converted: r.converted })),
                ).map((r) => ({
                  paywall: r.key,
                  ...(libelleContrat(r.key) ? { libelle: libelleContrat(r.key)!.label, force: libelleContrat(r.key)!.forced } : {}),
                  vus: r.n,
                  convertis: r.converted,
                  conversionPct: r.rate,
                })),
              }
            : {
                mesure: false,
                raison: "paywall_id pas encore émis par l'app : les emplacements s'alimenteront dès qu'il arrivera.",
                emplacements: EXPECTED_PAYWALL_IDS.map((p) => ({ paywall: p.id, libelle: p.label, force: p.forced })),
              },
          planGratuit: {
            ontRecuLaSemaineOfferte: a.freePlan.signups,
            lontUtilisee: a.freePlan.used,
            usagePct: ratePct(a.freePlan.used, a.freePlan.signups),
            sontPassesAuPayant: a.freePlan.convertedPaid,
          },
          coutDesScansUsd: !scans.anyRuns
            ? null
            : !scans.anyCost
              ? { chiffre: false, raison: "cost_usd pas encore émis sur scan_completed" }
              : scans.rows.map((r) => ({
                  type: SCAN_KIND_LABELS[r.kind] ?? r.kind,
                  scans: r.runs,
                  coutTotal: r.withCost > 0 ? r.sumCostUsd : null,
                  coutMoyen: r.avgCostUsd,
                })),
          lecture: [
            "Mesures PostHog (types de paywall, test A/B, offres servies, achats, paywalls, plan gratuit, scans) recalculées sur la période comme à l'écran ; sur une période, le revenu par bras est celui des abonnements ACQUIS dans la période (encaissé à ce jour).",
            "Complétion = nouveaux clients ÷ checkouts ouverts. Cibles / client = cibles ajoutées APRÈS paiement ÷ nouveaux clients. Net par assigné = net sécurisé du bras ÷ assignés (intention de traiter), les deux sur la même population (la période, ou tout le test).",
            `Un test n'est concluant qu'à ${AB_THRESHOLD} assignés par bras. Un bras vend un MENU : « offresServies » = plan présélectionné, « achatsReels » = ce que les clients ont acheté (prix Whop).`,
            "Offres de rythmes différents (semaine / mois) ne se comparent pas sur le revenu du premier cycle ; « brasComparables » faux = le test mélange prix et rythme.",
          ],
          ...(avertissements.length > 0 ? { avertissements } : {}),
        });
      }

      if (name === "acquisition") {
        const { du, au } = periodeDemandee(args);
        const produit = await lire(() => ctx.runQuery(internal.mcpTools.lireAnalyticsProduit, ids));
        const attribution = await lire(() => ctx.runQuery(internal.mcpTools.lireAttribution, ids));
        const revenu = await lire(() => ctx.runQuery(internal.mcpTools.lireRevenus, ids));
        const compteurs = await lire(() => ctx.runQuery(internal.mcpTools.lireCompteursVues, ids));
        const nature = await lire(() => ctx.runQuery(internal.mcpTools.lireRecompensesNature, ids));
        const conversion = await lire(() => ctx.runQuery(internal.mcpTools.lireConversionCreatrices, ids));

        // La fenêtre de l'écran : la période bornée aux jours de la série PostHog.
        // Sans série (PostHog absent), l'écran montre toute la profondeur.
        const plage = dataRangeOf(produit.overview.daily.map((d) => parisDayKey(d.ts)));
        const fenetre = clampWindow({ from: du, to: au }, plage);
        if (plage !== null && fenetre === null) {
          throw new ToolError(`La période ne recoupe pas les données : elles vont du ${plage.first} au ${plage.last}.`);
        }
        const fen = windowedAttribution(
          attribution.rows,
          attribution.costs.promoBonusByDay,
          attributionDaily(produit.overview.daily),
          fenetre,
        );
        const fx = {
          payCurrency: attribution.payCurrency,
          revenueCurrency: revenu.currency,
          fxRateToRevenue: attribution.fxRateToRevenue,
        };
        const mesure = (m: { visitors: number | null; signups: number | null; sales: number | null; revenue: number | null; currency: string | null }) => ({
          visiteurs: m.visitors,
          inscrits: m.signups,
          ventes: m.sales,
          revenuNet: m.revenue,
          devise: m.currency,
        });

        return json({
          projet: projet.slug,
          periode:
            fenetre === null
              ? "toute la profondeur (pas de série PostHog pour borner la période, comme à l'écran)"
              : { du: fenetre.from, au: fenetre.to },
          compteursDeVues: {
            sur: "toute la profondeur (pas la période)",
            totales: { vues: compteurs.totales, sertA: compteurs.usage.totales },
            payables: { vues: compteurs.payables, sertA: compteurs.usage.payables },
            promo: { vues: compteurs.promo, sertA: compteurs.usage.promo },
            paliers: { vues: compteurs.paliers, sertA: compteurs.usage.paliers },
          },
          efficaciteParCreatrice: fen.creators.map((c) => ({
            createatrice: c.creatorName,
            videosPromo: c.videos,
            vuesMedianes: c.medianViews,
            videosAuDessusDe50k: c.hitCount,
            vuesPromo: c.promoViews,
          })),
          joursSolo: !attribution.attributionAvailable
            ? "la série quotidienne PostHog n'est pas encore disponible"
            : fen.soloDays.map((d) =>
                d.isSolo && d.attribution
                  ? {
                      jour: d.day,
                      createatrice: d.attribution.creatorName,
                      vuesPromo: d.promoViews,
                      visiteurs: d.attribution.visitors,
                      inscrits: d.attribution.signups,
                      clients: d.attribution.clients,
                    }
                  : { jour: d.day, createatrices: d.creators.length, vuesPromo: d.promoViews, attribuable: false },
              ),
          recompensesEnNature: !nature.hasNatureTiers
            ? null
            : {
                sur: "toute la profondeur (pas la période)",
                dejaDu:
                  nature.dueTotal === 0 && nature.dueMissingCost > 0
                    ? null
                    : montantAffiche(toDisplayAmount(nature.dueTotal, fx)),
                engageSiLesPaliersTombent:
                  nature.engagedTotal === 0 && nature.engagedMissingCost > 0
                    ? null
                    : montantAffiche(toDisplayAmount(nature.engagedTotal, fx)),
                coutsReelsRenseignes: nature.anyCostConfigured,
                recompensesSansCoutReel: nature.dueMissingCost + nature.engagedMissingCost,
                paliers: nature.rows.map((r) => ({
                  seuilVues: r.seuilVues,
                  recompense: r.libelle,
                  coutReel: r.coutReel === null ? null : montantAffiche(toDisplayAmount(r.coutReel, fx)),
                  dues: r.dueCount,
                  engagees: r.engagedCount,
                  laPlusProche:
                    r.closestCreatorName === null || r.closestCumul === null
                      ? null
                      : {
                          createatrice: r.closestCreatorName,
                          vues: r.closestCumul,
                          pctDuSeuil: natureClosestPct(r.closestCumul, r.seuilVues),
                        },
                })),
              },
          conversionParCreatrice:
            conversion === null
              ? null
              : {
                  sur: `toute la profondeur, depuis le ${conversion.firstDate} (lien de parrainage, pas la période)`,
                  visiteursEtInscritsJusquAu: conversion.visitorsThroughDate,
                  ventesSynchroLe: instantParis(conversion.salesSyncMs),
                  lignes: conversion.display.rows.map((r) =>
                    r.kind === "creator"
                      ? { createatrice: r.creatorName, ref: r.ref, ...(r.status ? { statut: r.status } : {}), ...mesure(r) }
                      : r.kind === "influencer"
                        ? { influenceuse: r.name, ref: r.ref, ...mesure(r) }
                        : r.kind === "ref-only"
                          ? { ref: r.ref, revendiquee: false, ...mesure(r) }
                          : { createatrice: r.creatorName, ref: null, mesure: "aucune ref posée : l'attribution est aveugle sur elle (ce n'est pas un zéro)" },
                  ),
                  sansSource: conversion.display.unattributed === null ? null : mesure(conversion.display.unattributed),
                  attribueANommees: mesure(conversion.display.attributed),
                  total: mesure(conversion.display.total),
                  ...(conversion.conflicts.length > 0
                    ? { refsEnConflit: conversion.conflicts.map((c) => ({ ref: c.ref, revendiquePar: c.holders })) }
                    : {}),
                  ...(conversion.suspectRefs.length > 0 ? { attributionsDouteuses: conversion.suspectRefs } : {}),
                },
          lecture: [
            "Efficacité et jours solo suivent la période, comme à l'écran. La médiane prédit la prochaine vidéo ; le nombre de vidéos au-dessus de 50 000 vues prédit le volume. La moyenne ne prédit rien.",
            "Jour solo = une seule créatrice a publié en promo ce jour-là : les inscriptions lui reviennent sans ambiguïté. Un jour à plusieurs créatrices n'est pas attribuable.",
            "Les quatre compteurs de vues ne s'additionnent jamais : chacun a un seul usage (« sertA »).",
            "Récompenses en nature : « dejaDu » est une dépense (palier franchi) ; « engage » est une promesse, pas une dépense. Conversion par créatrice : par lien de parrainage (ref), visiteurs PostHog et ventes Whop n'ont pas la même fraîcheur.",
          ],
        });
      }

      if (name === "dashboard") {
        const maintenant = Date.now();
        // Chaque section derrière SON bloc, comme à l'écran : un droit manquant
        // masque la section concernée, jamais tout le tableau de bord.
        const assignments = await peutLire(() => ctx.runQuery(internal.mcpTools.lirePlanning, ids));
        const comptes = await peutLire(() => ctx.runQuery(internal.mcpTools.lireComptesSuivi, ids));
        const fiches = await peutLire(() => ctx.runQuery(internal.mcpTools.lireFichesCreatrices, ids));
        const du = await peutLire(() => ctx.runQuery(internal.mcpTools.lireTotalDu, ids));
        const decisions = await peutLire(() => ctx.runQuery(internal.mcpTools.lireDecisions, ids));
        const refus = (x: { refus: string }) => ({ nonAccessible: x.refus });
        const ok = <T,>(x: T | { refus: string }): x is T =>
          !(typeof x === "object" && x !== null && "refus" in x);

        // LES cartes de l'écran (convex/dashboardActions).
        const cartes = dashboardActions({
          assignments: ok(assignments) ? assignments : undefined,
          comptes: ok(comptes) ? comptes : undefined,
          creators: ok(fiches) ? fiches : undefined,
          now: maintenant,
        });
        const compteDe = (c: { handle: string; plateforme: string }) => `${c.handle} (${c.plateforme})`;
        const verdicts: Record<string, string> = {
          pending: "en attente (pas encore de relevé)",
          "open-door": "porte ouverte",
          rising: "monte",
          fading: "s'éteint",
          below: "sous les seuils",
        };
        const etats: Record<string, string> = {
          window: "fenêtre active",
          cruise: "croisière",
          alarm: "alarme",
        };
        const pct = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);

        return json({
          projet: projet.slug,
          actions: {
            aValider: ok(assignments) ? cartes.submitted.length : refus(assignments),
            warmupsEnRetard: ok(comptes)
              ? { comptes: cartes.warmupLate.length, liste: cartes.warmupLate.map(compteDe) }
              : refus(comptes),
            warmupsAValider: ok(comptes)
              ? { comptes: cartes.warmupReady.length, liste: cartes.warmupReady.map(compteDe) }
              : refus(comptes),
            // PAR DEVISE (jamais fondu) ; « valeur » garde le total ramené dans
            // la devise du projet — un indicateur, pas un montant à virer.
            du: ok(du)
              ? {
                  parDevise: du.byCurrency.map((t) => ({ devise: t.currency, montant: t.amount })),
                  valeur: du.dueTotal,
                  devise: du.payCurrency,
                }
              : refus(du),
          },
          aDecider: !ok(decisions)
            ? refus(decisions)
            : {
                portesOuvertes: decisions.openDoors.map((d) => ({
                  createatrice: d.post.creatorName,
                  compte: d.post.compte,
                  plateforme: d.post.plateforme,
                  publieLe: instantParis(d.post.postedAt),
                  vues: d.post.vues,
                  likeRatePct: pct(d.likeRate),
                  enregistrements: d.post.saves,
                  abonnesGagnes: d.post.followersDelta,
                  action: "programmer la frappe (une vidéo le soir même, 21 h-23 h)",
                })),
                aGraduer: decisions.graduations.map((g) => ({
                  hook: g.content,
                  meilleurRun: g.best,
                  runs: g.runs,
                })),
                hooksMorts: decisions.deadHooks.map((h) => ({
                  hook: h.content,
                  campagne: h.campaignName,
                  runs: h.runs,
                  meilleuresVues: h.bestViews,
                  action: "désactiver",
                })),
                alarmesCompte: decisions.alarms.map((a) => ({
                  compte: a.compte,
                  createatrice: a.creatorName,
                  postsConsecutifsSousLesSeuils: a.streak,
                  action: "stop promos, warmup prouvé pendant 5-7 jours",
                })),
              },
          posts48h: !ok(decisions)
            ? refus(decisions)
            : groupRecentPosts(decisions.posts48h, decisions.alarms).map((g) => {
                // Par défaut, l'ESSENTIEL : les posts déjà relevés, les plus vus
                // d'abord — une créatrice à 28 posts dont 10 sans relevé et 14 à
                // zéro noyait le reste (Snytch, 30/09/2026). Le compte reste exact.
                const { gardes, enAttenteDeReleve, autres } =
                  args.tous_les_posts === true
                    ? { gardes: g.posts, enAttenteDeReleve: 0, autres: 0 }
                    : postsEssentiels(g.posts, {
                        mesure: (p) => p.snapshotAt !== null,
                        vues: (p) => p.vues,
                        max: 5,
                      });
                return {
                  createatrice: g.label,
                  etat: etats[g.state] ?? g.state,
                  posts: g.posts.length,
                  vues: g.vues48,
                  abonnesGagnes: g.followers,
                  ...(enAttenteDeReleve > 0 ? { sansReleve: enAttenteDeReleve } : {}),
                  ...(autres > 0 ? { autresPosts: autres } : {}),
                  detail: gardes.map((p) => {
                    const mesureSaves = savesAvailability(p.saves, p.plateforme);
                    return {
                      titre: p.label || null,
                      type: p.type,
                      compte: p.compte,
                      plateforme: p.plateforme,
                      publieLe: instantParis(p.postedAt),
                      vues: p.vues,
                      vuesGagnees24h: p.delta24h,
                      likes: p.likes,
                      likeRatePct: pct(rateOf(p.likes, p.vues)),
                      enregistrements: mesureSaves === "measured" ? p.saves : null,
                      ...(mesureSaves === "unavailable" ? { enregistrementsNonDisponibles: true } : {}),
                      verdict: verdicts[verdictOf(p, maintenant)] ?? verdictOf(p, maintenant),
                      releveLe: instantParis(p.snapshotAt),
                      releve: p.snapshotSource,
                    };
                  }),
                };
              }),
          lecture: [
            "Le Dashboard de l'app : les quatre cartes d'action, « À décider » (une ligne par DÉCISION, jamais une tâche), les posts des 48 dernières heures par créatrice. La conversion par créatrice (« Ce que ça a rapporté ») est dans l'outil « acquisition ».",
            `Porte ouverte = post de moins de 48 h à ${OPEN_DOOR_MIN_VIEWS} vues ou plus, like rate ≥ ${OPEN_DOOR_MIN_LIKE_RATE * 100} %, au moins un enregistrement et des abonnés gagnés. Alarme compte = ${ACCOUNT_ALARM_RUN_LENGTH} posts consécutifs sous les seuils. Hook mort = au moins ${DEAD_HOOK_MIN_RUNS} runs publiés, aucun au-dessus de ${DEAD_HOOK_MAX_VIEWS} vues.`,
            "Décisions recalculées toutes les 30 min (cache de l'écran). Vues, likes et saves d'un post viennent de son relevé LE PLUS RÉCENT, pris entier : « nuit » (23 h 30) ou « rapide » (toutes les 2 h pendant les 36 premières heures), daté par « releveLe ». Un compteur que ce relevé ne fournit pas (likes masqués sur Instagram) vaut null, jamais la valeur d'un autre relevé.",
            "Posts des 48 h : par défaut les 5 posts DÉJÀ RELEVÉS les plus vus par créatrice ; « sansReleve » = posts sans aucun relevé (trop récents, ou plateforme non relevée), « autresPosts » = relevés non listés. « posts » et « vues » comptent tout. Détail complet : tous_les_posts.",
            "« nonAccessible » = le rôle de la clé n'a pas le bloc de cette section (l'écran la masque aussi).",
          ],
        });
      }

      if (name === "sante_produit") {
        const { du, au } = periodeDemandee(args);
        const produit = await lire(() => ctx.runQuery(internal.mcpTools.lireAnalyticsProduit, ids));
        if (!produit.configured) {
          return json({
            projet: projet.slug,
            configure: false,
            message: "PostHog n'est pas configuré sur ce projet : pas de mesures produit.",
          });
        }
        const periode = await agregatsSurPeriode(projet._id, produit, du, au);
        // Les agrégats que la période change — les mêmes que l'onglet.
        const a = periode.recalcul ? { ...produit, ...periode.recalcul.sante } : produit;
        const f = periode.fenetre;
        const sec = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
        const secDeMs = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);

        const fsp = a.firstSearchAfterPay;
        const verdict = firstSearchVerdict(fsp);
        const recherche = searchOutcome(a.searchResults.rows, a.instrumentation.events);
        const parEtape = frictionStepEmitted(a.frictionByStep.rows);

        const avertissements: string[] = [];
        if (periode.erreur !== null) {
          avertissements.push(`Recalcul sur la période impossible (${periode.erreur}) : chiffres des 90 derniers jours.`);
        }
        if (f !== null && [...posthogOutageDays()].some((j) => j >= f.from && j <= f.to)) {
          avertissements.push(
            "Ingestion PostHog coupée du 07/09 21:00 au 08/09 11:53 (Paris) : recherches, scans et frictions sont creux sur ces heures.",
          );
        }

        return json({
          projet: projet.slug,
          periode: decrirePeriode(periode),
          premiereRechercheApresPaiement:
            fsp.paid === 0
              ? "en attente de subscription_completed"
              : {
                  payantsMesurables: fsp.paid,
                  exclusCarPayesAvantInstrumentation: fsp.paidExcluded,
                  rechercheInstrumenteeDepuis: instantParis(fsp.instrStartMs),
                  ontCherche: fsp.searched,
                  trouves: verdict.found,
                  exploitablePct: verdict.exploitableRate,
                  echantillonSuffisant: verdict.sampleSufficient,
                  seuilEchantillon: MIN_SAMPLE_SIZE,
                  delaiPaiementVersRechercheSec: { mediane: sec(fsp.medDelaySec), neufSurDix: sec(fsp.p90DelaySec) },
                  resultats: fsp.results.map((r) => ({
                    resultat: SEARCH_RESULT_LABELS[r.result] ?? r.result,
                    exploitable: r.result === "found",
                    personnes: r.persons,
                  })),
                  resiliationsRattachables: fsp.cancelJoinable,
                },
          fiabiliteDesScans: scansByReason(a.scanReliability.rows).map((s) => ({
            declenchement: SCAN_REASON_LABELS[s.reason] ?? s.reason,
            ...(s.isUnfollowScan ? { detecteLesDesabonnements: true } : {}),
            executes: s.runs,
            echecs: s.failures,
            tauxEchecPct: s.rate,
            resultats: s.results.map((r) => ({
              resultat: SCAN_RESULT_LABELS[r.result] ?? r.result,
              echec: isScanFailure(r.result),
              executes: r.runs,
              partPct: s.runs > 0 ? Math.round((r.runs / s.runs) * 1000) / 10 : null,
            })),
          })),
          resultatsDeRecherche: {
            lignes: a.searchResults.rows.map((r) => ({
              resultat: SEARCH_RESULT_LABELS[r.result] ?? r.result,
              personnes: r.persons,
            })),
            bloquesParLePaywall: recherche.measured
              ? "mesuré (ligne « Bloqués par le paywall avant résultat »)"
              : recherche.deducedPaywalled === null
                ? null
                : { personnes: recherche.deducedPaywalled, source: "déduit (handle_submitted − handle_search_result)" },
          },
          latenceDesScans: a.scanLatency.rows.map((r) => ({
            scan: r.bucket,
            medianeSec: secDeMs(r.medianMs),
            neufSurDixSec: secDeMs(r.p90Ms),
            scans: r.n,
          })),
          latenceDeLaRecherche: "non mesurable (pas de durée émise sur handle_search_result)",
          frictions: {
            pages: a.friction.rows.map((r) => ({ page: r.page, personnes: r.persons })),
            parEtapeDOnboarding: parEtape
              ? a.frictionByStep.rows.map((r) => ({ etape: r.step, personnes: r.persons }))
              : "non ventilé : l'app n'émet pas encore onboarding_step sur le rageclick",
          },
          lecture: [
            "L'onglet Santé produit de l'Analytics, recalculé sur la période comme à l'écran.",
            `Première recherche après paiement : exploitable = « Trouvé » ; le taux porte sur les payants qui ont cherché, à lire comme une tendance sous ${MIN_SAMPLE_SIZE}. Les payants d'avant l'instrumentation sont exclus (leur absence de recherche n'est pas mesurable).`,
            "Fiabilité des scans : taux d'échec = échecs ÷ exécutés, par déclenchement ; le planifié complet est celui qui détecte les désabonnements.",
            "Frictions = clics répétés au même endroit en quelques secondes (rageclicks), en personnes.",
          ],
          ...(avertissements.length > 0 ? { avertissements } : {}),
        });
      }

      if (name === "vues") {
        const jourDecale = (jour: string, n: number) => {
          const [y, m, d] = jour.split("-").map(Number);
          return parisDayKey(parisMidnightUtc(y, m, d + n));
        };
        const au =
          typeof args.au === "string" && args.au.trim() !== ""
            ? args.au.trim()
            : parisDayKey(Date.now() - 86_400_000);
        const du =
          typeof args.du === "string" && args.du.trim() !== ""
            ? args.du.trim()
            : jourDecale(au, -6);
        if (minuitParisDe(du) === null || minuitParisDe(au) === null) {
          throw new ToolError("« du » et « au » doivent être des jours AAAA-MM-JJ.");
        }
        if (du > au) throw new ToolError("« du » doit précéder « au ».");
        let jours = 1;
        while (jourDecale(du, jours) <= au) jours += 1;
        if (jours > VUES_PERIODE_MAX_JOURS) {
          throw new ToolError(
            `Période de ${jours} jours : ${VUES_PERIODE_MAX_JOURS} au plus par appel. Découpe-la (par mois, par exemple).`,
          );
        }
        const warmup = (
          { exclure: "exclude", inclure: "all", seulement: "only" } as const
        )[(args.warmup as "exclure" | "inclure" | "seulement" | undefined) ?? "exclure"];
        const filtres = {
          ...(typeof args.createatrice === "string" ? { createatrice: args.createatrice } : {}),
          ...(typeof args.compte === "string" ? { compte: args.compte } : {}),
          ...(typeof args.pays === "string" ? { pays: args.pays } : {}),
          ...(typeof args.plateforme === "string"
            ? { plateforme: args.plateforme as Plateforme }
            : {}),
          warmup,
        };
        const lecture = (d: string, a: string) =>
          lire(() => ctx.runQuery(internal.mcpTools.lireVues, { ...ids, du: d, au: a, ...filtres }));
        const r = await lecture(du, au);
        const par = (args.par as string | undefined) ?? "createatrice";
        const lignes = {
          createatrice: r.parCreatrice,
          compte: r.parCompte,
          pays: r.parPays,
          plateforme: r.parPlateforme,
        }[par as "createatrice" | "compte" | "pays" | "plateforme"];
        const pct = (x: number, total: number) =>
          total > 0 ? Math.round((1000 * x) / total) / 10 : null;
        let comparaison: Record<string, unknown> | undefined;
        if (args.comparer === true) {
          const auAvant = jourDecale(du, -1);
          const duAvant = jourDecale(du, -jours);
          const avant = await lecture(duAvant, auAvant);
          comparaison = {
            du: duAvant,
            au: auAvant,
            total: avant.total,
            evolutionPct:
              avant.total > 0
                ? Math.round((1000 * (r.total - avant.total)) / avant.total) / 10
                : null,
          };
        }
        // PART estimée, pas seulement « au moins une vue » : un seul post relevé
        // à plus de 30 h d'écart levait le drapeau du jour entier, et les sept
        // jours d'une semaine l'étaient toujours (prod, 21-27/09/2026).
        const vuesEstimees = r.parJour.reduce((s, j) => s + j.vuesEstimees, 0);
        return json({
          projet: projet.slug,
          periode: { du, au, jours },
          perimetre: {
            posts: "tous les posts du projet, quelle que soit leur date de publication",
            warmup: { exclude: "posts de chauffe exclus", all: "posts de chauffe inclus", only: "posts de chauffe seulement" }[warmup],
            ...(Object.keys(filtres).length > 1 ? { filtres: { ...filtres, warmup: undefined } } : {}),
          },
          total: r.total,
          postsRetenus: r.postsRetenus,
          parJour: r.parJour.map((j) => ({
            jour: j.jour,
            vues: j.vues,
            vuesEstimees: j.vuesEstimees,
            partEstimeePct: pct(j.vuesEstimees, j.vues),
          })),
          estimation: {
            vuesEstimees,
            partEstimeePct: pct(vuesEstimees, r.total),
            lecture:
              "vuesEstimees = vues venues d'un écart de plus de 30 h entre deux relevés d'un même post, réparties au prorata des heures : pas mesurées. Le reste est mesuré relevé à relevé.",
          },
          repartition: {
            par,
            lignes: lignes.slice(0, 25).map((l) => ({
              nom: l.libelle,
              vues: l.vues,
              partPct: pct(l.vues, r.total),
            })),
            ...(lignes.length > 25 ? { tronque: `25 premières sur ${lignes.length}` } : {}),
          },
          ...(comparaison ? { comparaison } : {}),
          methode:
            "Vues gagnées = écart entre deux relevés, réparti au prorata des heures sur les jours de Paris qu'il traverse ; une vidéo part de 0 vue à sa publication. Le dernier jour n'est complet qu'après le relevé de 23 h 30.",
        });
      }

      const modeWarmup = (
        { exclure: "exclude", inclure: "all", seulement: "only" } as const
      )[(args.warmup as "exclure" | "inclure" | "seulement" | undefined) ?? "exclure"];

      if (name === "meilleurs_posts") {
        const jourDecale = (jr: string, n: number) => {
          const [y, m, d] = jr.split("-").map(Number);
          return parisDayKey(parisMidnightUtc(y, m, d + n));
        };
        const au =
          typeof args.au === "string" && args.au.trim() !== ""
            ? args.au.trim()
            : parisDayKey(Date.now());
        const du =
          typeof args.du === "string" && args.du.trim() !== ""
            ? args.du.trim()
            : jourDecale(au, -29);
        const debut = minuitParisDe(du);
        const fin = minuitParisDe(jourDecale(au, 1));
        if (debut === null || minuitParisDe(au) === null || fin === null) {
          throw new ToolError("« du » et « au » doivent être des jours AAAA-MM-JJ.");
        }
        if (du > au) throw new ToolError("« du » doit précéder « au ».");
        const posts = await lire(() =>
          ctx.runQuery(internal.mcpTools.lirePosts, {
            ...ids,
            dateFrom: debut,
            dateTo: fin - 1,
            warmup: modeWarmup,
            ...(typeof args.plateforme === "string"
              ? { plateforme: args.plateforme as Plateforme }
              : {}),
            ...(typeof args.createatrice === "string" ? { createatrice: args.createatrice } : {}),
            ...(typeof args.compte === "string" ? { compte: args.compte } : {}),
            ...(typeof args.campagne === "string" ? { campagne: args.campagne } : {}),
            ...(typeof args.pays === "string" ? { pays: args.pays } : {}),
          }),
        );
        const tri = ((args.tri as string | undefined) ?? "vues") as
          | "vues"
          | "likes"
          | "commentaires"
          | "saves";
        const signe = args.ordre === "pires" ? 1 : -1;
        const limite = typeof args.limite === "number" ? args.limite : 20;
        const classes = [...posts].sort(
          (a, b) => signe * ((a[tri] ?? -1) - (b[tri] ?? -1)) || a.titre.localeCompare(b.titre),
        );
        return json({
          projet: projet.slug,
          perimetre: {
            publies: { du, au },
            warmup: { exclude: "posts de chauffe exclus", all: "posts de chauffe inclus", only: "posts de chauffe seulement" }[modeWarmup],
          },
          tri: `${tri}, ${args.ordre === "pires" ? "les moins bons d'abord" : "les meilleurs d'abord"}`,
          total: posts.length,
          vuesCumulees: posts.reduce((s, p) => s + p.vues, 0),
          ...(classes.length > limite ? { tronque: `${limite} sur ${classes.length}` } : {}),
          posts: classes.slice(0, limite),
          lecture:
            "vues/likes/commentaires/saves = cumul à ce jour (dernier relevé). Un post publié hier n'a pas eu le temps d'un post d'il y a trois semaines : pour comparer à maturité égale, l'outil scripts mesure à J+X. saves = null quand la plateforme ne les expose pas.",
        });
      }

      if (name === "scripts") {
        const fenetre = ((args.fenetre as string | undefined) ?? "j7") as "j3" | "j7" | "j14" | "j30";
        const r = await lire(() =>
          ctx.runQuery(internal.mcpTools.lireScripts, {
            ...ids,
            fenetre,
            warmup: modeWarmup,
            ...(typeof args.campagne === "string" ? { campagne: args.campagne } : {}),
          }),
        );
        if (r.kind === "liste") {
          return json({ projet: projet.slug, campagnes: r.campagnes });
        }
        if (r.kind === "ambigu") {
          throw new ToolError(
            `Campagne « ${String(args.campagne)} » introuvable ou ambiguë. Campagnes possibles : ${r.candidates.join(" ; ")}.`,
          );
        }
        const verdict = {
          a_pousser: "à pousser",
          a_couper: "à couper",
          neutre: "neutre",
          en_test: "en test (pas encore jugeable)",
        } as const;
        const arrondi = (x: number | null) => (x === null ? null : Math.round(x));
        return json({
          projet: projet.slug,
          campagne: { nom: r.nom, statut: r.statut },
          fenetre: `vues à ${fenetre.toUpperCase().replace("J", "J+")} après publication`,
          warmup: { exclude: "posts de chauffe exclus", all: "posts de chauffe inclus", only: "posts de chauffe seulement" }[modeWarmup],
          postsMesures: r.decisions.totalPosts,
          decisions: r.decisions.dimensions.map((d) => ({
            dimension: d.kind,
            briques: d.decisions.map((b) => ({
              brique: b.label,
              verdict: verdict[b.verdict],
              raison: b.reason,
              posts: b.postCount,
              vuesMediane: arrondi(b.viewsMedian),
              medianeDesAutres: arrondi(b.peerMedian),
            })),
          })),
          signauxForts: r.decisions.strongSignals.map((s) => ({
            brique: s.label,
            dimension: s.kind,
            posts: s.postCount,
            vuesMediane: arrondi(s.viewsMedian),
            foisLaMediane: Math.round(s.multipleOfGlobal * 10) / 10,
            raison: s.reason,
          })),
          meilleursCombos: r.combos.slice(0, 10).map((c) => ({
            hook: c.hookLabel,
            flux: c.fluxLabel,
            cta: c.ctaLabel,
            posts: c.postCount,
            vuesMediane: arrondi(c.viewsMedian),
            jugeable: c.status === "jugeable",
            auDessusDeLaCampagne: c.signal,
          })),
          lecture: `Une brique n'est jugée qu'à partir de ${DECISION_THRESHOLD} posts : en dessous, « en test », même si ses premiers chiffres sont bons (les signaux forts les signalent à part). Les verdicts comparent la médiane d'une brique à celle des autres briques de même rôle.`,
        });
      }

      if (name === "compta") {
        // Les libellés de l'écran (messages/admin/fr/money.json › Compta).
        const POSTES: Record<string, string> = {
          gross: "CA brut",
          refunds: "remboursements",
          disputes: "litiges",
          fees: "frais Whop",
          transfers: "virements vers la banque",
          internal: "mouvements internes (hors résultat)",
          unclassified: "non classé",
        };
        const USAGES: Record<string, string> = {
          pay: "rémunération",
          creators: "paiement créatrices",
          provision: "mise de côté (impôts, URSSAF)",
          business: "charges de l'activité",
          recover: "à récupérer (bloqué, en transit)",
          other: "autre",
        };
        const CATEGORIES: Record<string, string> = {
          hosting: "hébergement",
          tools: "outils",
          subscriptions: "abonnements",
          ads: "publicité",
          scans: "scans",
          other: "autre",
        };
        const RAISONS: Record<string, string> = {
          unclassified: "lignes Whop non classées",
          ledgerCurrency: "montants Whop dans une devise sans taux",
          creatorsCurrency: "paie créatrices sans taux de conversion",
          scanUnknown: "scans sans coût mesuré (cost_usd absent)",
          scanMissing: "coût des scans pas encore lu",
          otherCurrency: "autre charge dans une devise sans taux",
          scanPaidCurrency: "paiement de scans dans une devise sans taux",
        };
        const controle = (
          c: { paid: number | null; sent: number | null; gap: number | null; significant: boolean } | null,
        ) =>
          c === null
            ? null
            : { verseSelonPaiements: c.paid, sortiDeWhopPourElles: c.sent, ecart: c.gap, aEclaircir: c.significant };

        const moisDemande = typeof args.mois === "string" && args.mois.trim() !== "" ? args.mois.trim() : null;
        if (moisDemande !== null) {
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(moisDemande)) {
            throw new ToolError("« mois » doit être au format AAAA-MM (ex. 2026-09).");
          }
          const d = await lire(() => ctx.runQuery(internal.mcpTools.lireComptaMois, { ...ids, month: moisDemande }));
          return json({
            projet: projet.slug,
            mois: d.month,
            devise: d.currency,
            devisePaie: d.payCurrency,
            grandLivre: {
              caBrut: d.ledger.gross,
              remboursements: d.ledger.refunds,
              litiges: d.ledger.disputes,
              fraisWhop: d.ledger.fees,
              netWhop: d.ledger.net,
              virementsRecus: d.ledger.transfersReceived,
              parType: d.types.map((x) => ({
                type: x.lineType,
                poste: POSTES[x.bucket] ?? x.bucket,
                lignes: x.count,
                montant: x.amount,
                devise: x.currency,
                contreValeur: x.converted,
              })),
            },
            virements: d.transfers.map((x) => ({
              jour: x.day,
              montant: x.amount,
              devise: x.currency,
              contreValeur: x.converted,
              vers: x.destination,
              ...(x.failed
                ? { echoue: true, revenuSurWhopLe: x.returnedDay, compte: false }
                : {
                    parts: x.parts.map((p) => ({
                      montant: p.amount,
                      usage: USAGES[p.usage] ?? p.usage,
                      motif: p.note,
                      compteeEnCharge: p.countedAs === null ? null : (CATEGORIES[p.countedAs] ?? p.countedAs),
                    })),
                    sansMotif: Math.round((x.amount - x.parts.reduce((s, p) => s + p.amount, 0)) * 100) / 100,
                  }),
            })),
            createatrices: {
              total: d.creatorsTotal.converted,
              // PAR DEVISE de paie (une créatrice en euros, une autre en
              // dollars) ; `taux` n'existe que si le mois n'en a qu'une.
              totalParDevisePaie: d.creatorsTotal.payByCurrency.map((x) => ({
                devise: x.currency,
                montant: x.amount,
              })),
              taux: d.creatorsTotal.rate,
              versements: d.creators.map((c) => ({
                jour: c.day,
                createatrice: c.name,
                nature: c.kind === "advance" ? "acompte" : "solde du cycle",
                montantDevisePaie: c.amount,
                devisePaie: c.currency,
                contreValeur: c.converted,
              })),
              controle: controle(d.creatorsControl),
            },
            scans: {
              source: d.scanSource === "paid" ? "paiements réels" : d.scanSource === "estimate" ? "estimation cost_usd" : null,
              total: d.scanTotal,
              paiements: d.scanPaid.map((c) => ({
                jour: c.day,
                libelle: c.label,
                montant: c.amount,
                devise: c.currency,
                contreValeur: c.converted,
                depuisUnVirement: c.transferLineId !== null,
              })),
              estimation:
                d.scan === null
                  ? null
                  : { usd: d.scan.usd, contreValeur: d.scan.converted, scans: d.scan.runs, fige: d.scan.frozen },
            },
            autresCharges: d.charges.map((c) => ({
              jour: c.day,
              libelle: c.label,
              categorie: CATEGORIES[c.category] ?? c.category,
              montant: c.amount,
              devise: c.currency,
              contreValeur: c.converted,
              ...(c.planned ? { prevue: true } : {}),
              ...(c.recurring ? { chaqueMois: true } : {}),
              ...(c.transferLineId !== null ? { depuisUnVirement: true } : {}),
            })),
            soldeWhop: {
              ouverture: d.reconciliation.opening,
              netWhop: d.reconciliation.net,
              virementsRecus: d.reconciliation.transfersReceived,
              autresMouvements: d.reconciliation.otherMovements,
              cloture: d.reconciliation.closing,
            },
            lecture: [
              "Trésorerie : une recette au jour de l'encaissement Whop, une charge au jour du paiement (créatrices : quand le cycle est marqué payé, acomptes à leur date).",
              "Un virement Whop → banque ne change jamais le résultat ; seule une part « charges de l'activité » COMPTÉE EN CHARGE y entre (elle figure aussi dans autresCharges ou scans.paiements). Une part « paiement créatrices » n'est jamais comptée : la paie l'est déjà dans createatrices.",
              "Scans : dès qu'un paiement réel existe ce mois, la somme des paiements REMPLACE l'estimation (rendue pour comparer).",
            ],
          });
        }

        const annee = typeof args.annee === "number" ? args.annee : Number(parisDayKey(Date.now()).slice(0, 4));
        if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
          throw new ToolError("« annee » doit être une année entre 2020 et 2100.");
        }
        const o = await lire(() => ctx.runQuery(internal.mcpTools.lireCompta, { ...ids, year: annee }));
        const treso = await lire(() => ctx.runQuery(internal.mcpTools.lireComptaTresorerie, ids));
        if (!o.configured) {
          return json({
            projet: projet.slug,
            configure: false,
            message: "Compta indisponible : aucun compte Whop n'est relié à ce projet (les revenus viennent du grand livre Whop).",
          });
        }
        const avertissements: string[] = [];
        if (o.sync.lastSyncAt === null) avertissements.push("Grand livre Whop jamais lu : les revenus sont vides tant que le premier import n'a pas tourné.");
        if (o.sync.lastError) avertissements.push(`Dernier import en erreur : ${o.sync.lastError}`);
        if (o.sync.lastSyncAt !== null && !o.sync.historyComplete) avertissements.push("Historique Whop pas encore complet : les premiers mois peuvent manquer de lignes.");
        if (o.currency === null && o.sync.lastSyncAt !== null) avertissements.push("Devise de référence indéterminée : plusieurs devises sans taux, les montants ne s'additionnent pas.");
        if (o.unclassified.length > 0) avertissements.push(`${o.unclassified.length} type(s) de ligne Whop non classé(s) : ils ne comptent ni au CA ni au résultat tant qu'on ne leur a pas choisi une colonne dans l'onglet.`);
        if (o.toRecover.length > 0) avertissements.push(`${o.toRecover.length} somme(s) à récupérer (voir aRecuperer).`);
        for (const a of treso.accounts) {
          if (!a.counted) avertissements.push(`Compte « ${a.name} » jamais relevé : il n'est pas compté dans la trésorerie.`);
          else if (a.stale) avertissements.push(`Compte « ${a.name} » relevé il y a ${a.ageDays} jours : son solde a pu bouger depuis (les dépenses ne se voient qu'au prochain relevé).`);
        }
        return json({
          projet: projet.slug,
          exercice: o.year,
          devise: o.currency,
          devisePaie: o.payCurrency,
          import: {
            luLe: instantParis(o.sync.lastSyncAt),
            historiqueComplet: o.sync.historyComplete,
            ...(o.sync.lastError ? { erreur: o.sync.lastError } : {}),
          },
          seuilsDeCA:
            o.thresholds === null
              ? null
              : {
                  caBrutCumule: o.thresholds.cumul,
                  statut: { below: "sous les deux seuils", between: "entre les deux seuils", above: "au-delà du seuil majoré" }[o.thresholds.status],
                  seuil: 37_500,
                  seuilMajore: 41_250,
                  resteAvantSeuil: o.thresholds.base.remaining,
                  seuilAtteintVers: o.thresholds.base.reachedOn,
                  resteAvantSeuilMajore: o.thresholds.majored.remaining,
                  seuilMajoreAtteintVers: o.thresholds.majored.reachedOn,
                  rythmeParJour: o.thresholds.dailyRate,
                  projectionAu31Dec: o.thresholds.endOfYear,
                },
          totaux: {
            caBrut: o.totals.gross,
            remboursements: o.totals.refunds,
            litiges: o.totals.disputes,
            fraisWhop: o.totals.fees,
            netWhop: o.totals.net,
            createatrices: o.totals.creators,
            scans: o.totals.scans,
            autresCharges: o.totals.other,
            resultat: o.totals.result,
            virementsRecus: o.totals.transfersReceived,
            incomplet: o.totals.incomplete,
          },
          mois: o.rows.map((r) => ({
            mois: r.month,
            ...(r.inProgress ? { enCours: true } : {}),
            caBrut: r.ledger.gross,
            remboursements: r.ledger.refunds,
            litiges: r.ledger.disputes,
            fraisWhop: r.ledger.fees,
            netWhop: r.ledger.net,
            createatrices: r.creators,
            scans: r.scans,
            scansSource: r.scanSource === "paid" ? "paiements réels" : r.scanSource === "estimate" ? "estimation cost_usd" : null,
            ...(r.scanSource === "paid" ? { scansEstimation: r.scanEstimate } : {}),
            autresCharges: r.other,
            resultat: r.result,
            virementsRecus: r.ledger.transfersReceived,
            ...(r.plannedCount > 0 ? { chargesPrevues: r.plannedCount } : {}),
            ...(r.incomplete.length > 0 ? { incomplet: r.incomplete.map((k) => RAISONS[k] ?? k) } : {}),
            ...(r.scanPaidLow ? { alerteScans: "paiements réels bien sous l'estimation : un paiement de scans manque peut-être" } : {}),
            ...(r.creatorsControl ? { controleCreatrices: controle(r.creatorsControl) } : {}),
          })),
          soldeWhop: {
            parDevise: o.balance.byCurrency.map((b) => ({ devise: b.currency, montant: b.amount, contreValeur: b.converted })),
            total: o.balance.converted,
            dernierVirement: o.balance.lastTransfer
              ? { jour: jour(o.balance.lastTransfer.at), montant: o.balance.lastTransfer.amount, devise: o.balance.lastTransfer.currency }
              : null,
          },
          aRecuperer: o.toRecover.map((x) => ({
            jour: x.day,
            montant: x.amount,
            devise: x.currency,
            contreValeur: x.converted,
            motif: x.note,
            vers: x.destination,
            depuisJours: x.ageDays,
          })),
          nonClasses: o.unclassified.map((u) => ({ type: u.lineType, lignes: u.count, montant: u.amount, mois: u.months })),
          tresorerie: {
            leJour: treso.today,
            disponiblePourDepenser: treso.available,
            enCaisse: treso.inCash,
            misDeCote: treso.setAside.remaining,
            surWhop: treso.whop.total,
            comptes: treso.accounts.map((a) => ({
              nom: a.name,
              devise: a.currency,
              compte: a.counted,
              dernierReleve: a.reading === null ? null : { jour: a.reading.day, montant: a.reading.amount },
              releveIlYaJours: a.ageDays,
              aRelever: a.stale,
              virementsWhopArrivesDepuis: a.since,
              soldeEstime: a.estimated,
              recoitLesVirementsWhopVers: a.destinations,
            })),
            misDeCoteDetail: { partsMiseDeCote: treso.setAside.provisioned, dejaPaye: treso.setAside.used },
            aRecuperer: treso.toRecover,
          },
          ...(avertissements.length > 0 ? { avertissements } : {}),
          lecture: [
            "Résultat = net Whop − créatrices − scans − autres charges, par mois de Paris. Trésorerie : recette au jour de l'encaissement Whop, charge au jour du paiement (créatrices : quand le cycle est marqué payé).",
            "Les virements Whop → banque ne sont pas des charges : seule une part de virement « comptée en charge » entre au résultat (dans scans ou autresCharges). « mois » donne le détail d'un mois, ventilation comprise.",
            "Scans : paiements réels au fournisseur s'il y en a ce mois, sinon l'estimation cost_usd (dollars convertis).",
            "Trésorerie (aujourd'hui) : disponiblePourDepenser = surWhop + comptes relevés − misDeCote. Jarvia ne lit aucune banque : un compte vaut son dernier solde RELEVÉ à la main + les virements Whop arrivés depuis ; les dépenses ne se voient qu'au relevé suivant, donc un relevé ancien est à vérifier. Un compte jamais relevé n'est pas compté. misDeCote = parts « Mise de côté » des virements − ce qui en est marqué payé. aRecuperer est hors total.",
            "Seuils 37 500 € / 41 250 € : franchise en base de TVA (prestations de services) — repère à confirmer avec le comptable. Projection linéaire au rythme des 30 derniers jours, pas une prévision.",
            "contreValeur = montant converti dans la devise de référence au taux du projet ; null = aucun taux pour cette devise (jamais additionné 1:1).",
          ],
        });
      }

      throw new ToolError(`Outil inconnu : ${name}.`);
    },
  };
}
