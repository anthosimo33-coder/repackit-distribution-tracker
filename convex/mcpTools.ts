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
      v.union(v.literal("TikTok"), v.literal("Instagram"), v.literal("YouTube")),
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
        plateforme: { type: "string", description: "Plateforme.", enum: ["TikTok", "Instagram", "YouTube"] },
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
              ? { plateforme: args.plateforme as "TikTok" | "Instagram" | "YouTube" }
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
