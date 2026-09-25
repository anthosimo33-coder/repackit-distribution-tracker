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
import { effectiveStatus, listComptesCore } from "./comptes";
import { listCreatorActivityCore, listCreatorsCore } from "./creators";
import { creatorPublicationStats } from "./publicationLateness";
import { getProjectProfitabilityCore } from "./profitability";
import { profitabilityReport } from "./profitabilityMath";
import { parisDayKey, parisMidnightUtc } from "./viewsDaily";
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
  getAttributionCore,
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
import { windowCosts } from "./attributionWindow";
import { getMarketPnlCore } from "./marketPnl";
import { listMarketGroupsCore } from "./marketGroups";
import { getProductAnalyticsCore } from "./posthogSync";
import { windowToMs } from "./marketWindow";
import { DECISION } from "./marketDecision";
import {
  contexteDevises,
  deriverMarches,
  lignesEtTotaux,
  serieMensuelle,
} from "./marketDerive";
import {
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

const jour = (ts: number | null | undefined): string | null =>
  typeof ts === "number" && ts > 0 ? parisDayKey(ts) : null;

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
  args: {},
  handler: async (ctx) =>
    (await creatorPublicationStats(ctx, ctx.projectId, Date.now())).map((s) => ({
      createatrice: s.creatorName,
      tauxALHeurePct: s.tally.rate === null ? null : Math.round(s.tally.rate * 100),
      aLHeure: s.tally.onTime,
      enRetard: s.tally.late,
      manques: s.tally.missed,
      aVenir: s.tally.scheduled,
      postsPasses: s.tally.past,
    })),
});

/** Carte Rentabilité (écran Paiements) — même lecture, même bloc. */
export const lireRentabilite = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => getProjectProfitabilityCore(ctx),
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

/** Contrôles de cohérence de l'onglet Analytics (clients acquis, garde-fou) — même bloc. */
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

/** Agrégats PostHog en cache (trafic par pays) — même lecture que l'onglet. */
export const lireAnalyticsProduit = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => getProductAnalyticsCore(ctx),
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
      "Taux de publication à l'heure par créatrice, sur tout l'historique du projet (même calcul que le calendrier et les notifications, dans le fuseau de chaque créatrice) : à l'heure, en retard, manqués, à venir. Trié du taux le plus bas au plus haut — pour répondre à « qui est en retard ».",
    inputSchema: {
      type: "object",
      properties: { projet: ARG_PROJET, createatrice: ARG_CREATRICE },
      additionalProperties: false,
    },
  },
  {
    name: "rentabilite",
    title: "Rentabilité du projet",
    description:
      "Rentabilité du projet, exactement comme la carte Rentabilité de l'écran Paiements (même calcul) : revenu Whop NET (après frais, devise du revenu), coût créatrices (fixe + CPM + bonus, devise de la paie), MARGE (revenu − coût converti, devise du revenu) et RPM (revenu net pour 1 000 vues). Cumul + détail mois par mois (mois de Paris), du plus récent au plus ancien. Par défaut le RPM « business » divise par les vues FACTURÉES seules ; inclure_non_facturees donne le RPM dilué (toutes les vues suivies). Lire les avertissements avant de conclure.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        mois: {
          type: "string",
          description: "Ne garder qu'un mois, au format AAAA-MM (ex. 2026-09).",
        },
        inclure_non_facturees: {
          type: "boolean",
          description:
            "Diviser le RPM par toutes les vues suivies (RPM dilué) au lieu des seules vues facturées (défaut : non).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "vues",
    title: "Vues gagnées sur une période",
    description:
      "Vues GAGNÉES pendant une période (jours de Paris), par tous les posts du projet quelle que soit leur date de publication — la courbe « Vues gagnées par jour » du Tracker, lue sur ces jours. Répond à « combien de vues Kelly a faites cette semaine ». Une vidéo part de 0 à sa publication : ses premières heures comptent. Total, détail par jour (jours estimés signalés) et répartition par créatrice, compte, pays ou plateforme. `comparer` ajoute la période précédente de même durée. Par défaut : les 7 derniers jours complets, posts de chauffe exclus (comme le Tracker).",
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
      },
      additionalProperties: false,
    },
  },
];

// ─── Exécution ───────────────────────────────────────────────────────────────

type Projet = { _id: Id<"projects">; slug: string; name: string; role: string };

const plier = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

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

/** Le serveur MCP d'UNE personne authentifiée. */
export function jarviaServer(ctx: ActionCtx, userId: Id<"users">): McpServer {
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

  const filtreNom = (nom: string | null, filtre: unknown) =>
    typeof filtre !== "string" || plier(nom ?? "").includes(plier(filtre));

  return {
    info: { name: "jarvia", version: "1.0.0" },
    instructions:
      "Données de Jarvia Creator Studio (distribution de vidéos par des créatrices), en LECTURE SEULE, avec les droits de la personne qui a créé la clé. Les chiffres sont ceux de l'app au moment de l'appel. Si plusieurs projets sont accessibles, précise `projet` (appelle `projets` pour la liste). Les dates sont des jours de Paris (AAAA-MM-JJ).",
    tools: OUTILS,
    async callTool(name, args) {
      if (name === "projets") {
        return json(
          (await projets()).map((p) => ({ slug: p.slug, nom: p.name, role: p.role })),
        );
      }
      const projet = await projetDe(args.projet);
      const ids = { userId, projectId: projet._id };

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
        const lignes = await lire(() => ctx.runQuery(internal.mcpTools.lirePonctualite, ids));
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
          note: "tauxALHeurePct = à l'heure ÷ posts passés ; null = aucun post passé encore.",
          createatrices: retenues,
        });
      }

      if (name === "rentabilite") {
        const mois = typeof args.mois === "string" ? args.mois.trim() : null;
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
            "Par client : tout est divisé par les clients ACQUIS sur la période (personnes, Whop fait foi). Coût d'acquisition = vidéos promo (fixe + CPM) + bonus et primes ; le coût complet du moteur compte aussi le warmup.",
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
                  montantEnAttente: rn.pendingRenewalAmount,
                  causesEchec: rn.failureCauses,
                  cyclesMoyens: rn.averageCycles,
                  cyclesParClient: rn.cycleDistribution,
                },
                revenu: {
                  nouveau: rn.newNet,
                  renouvellement: rn.renewalNet,
                  origineInconnue: rn.unknownNet,
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
                  net: c.net,
                  netParClient: c.netPerClient,
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
                  montantEnAttente: o.pendingAmount,
                })),
              }
            : {}),
          lecture: [
            "Cohorte = les clients ACQUIS sur la période, suivis depuis : une seule population (comme l'onglet). Sans du/au : toute la profondeur.",
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
        const maille = args.maille === "pays" ? "pays" : "marche";
        const marches = deriverMarches({
          pnl,
          traffic: produit.funnels.countryPersons,
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
        return json({
          projet: projet.slug,
          periode: { du, au },
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
          marches: retenus.map((m) => ({
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
            offres: m.plans.slice(0, 5).map((p) => ({
              offre: p.label ?? p.planId,
              prix: p.price,
              clients: p.clients,
              partPct: pct(p.share),
            })),
          })),
          parMois: serieMensuelle(pnl).map((x) => ({
            mois: x.month,
            coutCreateurs: x.cost,
            revenuNet: x.revenueNet,
            ecart: x.ecart,
          })),
          lecture: [
            "L'argent (coût, clients, revenu) suit le pays de FACTURATION (Whop) ; le trafic, le pays de CONNEXION (PostHog). Côte à côte, jamais divisés l'un par l'autre.",
            "Montants dans la devise du revenu (coûts convertis au taux du projet). « retourAcquisition » = valeur des clients gagnés ÷ coût promo ; « revenuSurCout » = revenu net ÷ coût.",
            "Trafic : le cache PostHog (90 derniers jours), pas recalculé sur la période — l'écran le recalcule quand il le peut. Les verdicts qui en dépendent (réparer) peuvent donc différer légèrement.",
            "Verdicts triés par ce qu'il faut faire d'abord ; « Aucun pays défini » = coût sans pays cible, hors marché.",
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
        const estimes = r.parJour.filter((j) => j.estime).map((j) => j.jour);
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
          parJour: r.parJour,
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
          ...(estimes.length > 0
            ? {
                joursEstimes: `${estimes.length} jour(s) dont au moins une part vient d'un écart de plus de 30 h entre deux relevés : valeur répartie au prorata, pas mesurée (${estimes.join(", ")}).`,
              }
            : {}),
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

      throw new ToolError(`Outil inconnu : ${name}.`);
    },
  };
}
