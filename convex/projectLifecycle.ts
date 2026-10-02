/**
 * MODIFIER et SUPPRIMER un projet — réservé au superadmin.
 *
 * Modifier : nom, couleur d'accent, logo téléversé. Le SLUG n'est pas
 * modifiable : il est dans les URL partagées (connexion brandée, liens des
 * notifications) et le code en dépend nommément (`snytch`, `repackit`).
 *
 * Supprimer : opération la plus destructrice de l'app, en deux temps.
 *   1. `deleteProject` — dans UNE transaction : les accès (memberships), les
 *      comptes utilisateur devenus orphelins, le logo, puis le document projet.
 *      Dès le commit, le projet a disparu de partout : du switcher, des URL, et
 *      de tous les crons (ils parcourent la table `projects`).
 *   2. `purgerProjet` — la purge des données, PAR LOTS, reprogrammée tant qu'il
 *      reste des lignes. Un projet comme Snytch porte des dizaines de milliers de
 *      relevés de vues : une seule transaction dépasserait les limites Convex.
 *
 * La liste des tables et leur ordre vivent dans `projectPurgeTables.ts`, pure
 * et testée contre le schéma : une table oubliée fait échouer la CI.
 */

import { v } from "convex/values";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { superadminMutation, superadminQuery, e2eMutation } from "./functions";
import { ERR, err } from "./errorCodes";
import { REPACKIT_SLUG } from "./projects";
import { purgeAndDeleteAssignment } from "./assignments";
import { deleteStorageBestEffort } from "./storageCleanup";
import { deleteAuthDataOfUser } from "./authCleanup";
import {
  PROJECT_NAME_MAX,
  LOGO_MAX_BYTES,
  deletionConfirmed,
  logoRefusal,
  normalizeAccentColor,
  normalizeProjectName,
} from "./projectLifecycleRules";
import { TABLES_PURGEES, type TablePurgee } from "./projectPurgeTables";

type Pid = Id<"projects">;

// ─── Modifier ────────────────────────────────────────────────────────────────

export const updateProject = superadminMutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    // Id = nouveau logo, DÉJÀ téléversé (storage.generateUploadUrl) ;
    // null = retirer le logo ; absent = ne pas toucher.
    logo: v.optional(v.union(v.id("_storage"), v.null())),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw err(ERR.PROJECT_NOT_FOUND, "Projet introuvable.");
    const patch: {
      name?: string;
      accentColor?: string;
      logoUrl?: string;
      logoStorageId?: Id<"_storage">;
    } = {};

    if (args.name !== undefined) {
      const name = normalizeProjectName(args.name);
      if (name === null) {
        throw err(ERR.PROJECT_NAME_REQUIRED, "Le nom du projet est requis.");
      }
      if (name.length > PROJECT_NAME_MAX) {
        throw err(
          ERR.PROJECT_NAME_TOO_LONG,
          `Le nom du projet dépasse ${PROJECT_NAME_MAX} caractères.`,
          { max: PROJECT_NAME_MAX },
        );
      }
      patch.name = name;
    }

    if (args.accentColor !== undefined) {
      const couleur = normalizeAccentColor(args.accentColor);
      if (couleur === null) {
        throw err(
          ERR.ACCENT_COLOR_INVALID,
          "Couleur invalide : format hexadécimal attendu (#ff5200).",
        );
      }
      patch.accentColor = couleur;
    }

    // Le blob à effacer APRÈS le patch (même transaction) : l'ancien logo quand
    // on le remplace ou le retire. Jamais un chemin statique (/brand/…) : il
    // n'a pas de pointeur de stockage.
    let blobARetirer: Id<"_storage"> | undefined;
    if (args.logo === null) {
      blobARetirer = project.logoStorageId;
      patch.logoUrl = undefined;
      patch.logoStorageId = undefined;
    } else if (args.logo !== undefined) {
      const meta = await ctx.db.system.get(args.logo);
      const refus = meta
        ? logoRefusal({ contentType: meta.contentType, size: meta.size })
        : "not_image";
      if (refus !== null) {
        // Le blob téléversé n'appartient à personne : il ne reste pas facturé.
        await deleteStorageBestEffort(ctx, args.logo);
        throw refus === "too_large"
          ? err(
              ERR.LOGO_TOO_LARGE,
              `Logo trop lourd : ${LOGO_MAX_BYTES / (1024 * 1024)} Mo maximum.`,
              { maxMb: LOGO_MAX_BYTES / (1024 * 1024) },
            )
          : err(ERR.LOGO_NOT_IMAGE, "Le logo doit être une image.");
      }
      const url = await ctx.storage.getUrl(args.logo);
      if (url === null) {
        throw err(ERR.LOGO_NOT_IMAGE, "Le logo doit être une image.");
      }
      if (project.logoStorageId !== args.logo) {
        blobARetirer = project.logoStorageId;
      }
      patch.logoUrl = url;
      patch.logoStorageId = args.logo;
    }

    await ctx.db.patch(project._id, patch);
    await deleteStorageBestEffort(ctx, blobARetirer);
    return { slug: project.slug };
  },
});

// ─── Supprimer : la purge par lots ───────────────────────────────────────────

/** Taille d'un lot de lecture — et plafond d'écritures par exécution (×4). */
const LOT = 100;
const ECRITURES_PAR_EXECUTION = 400;

interface Etape {
  /** Lit jusqu'à `n` lignes du projet (sert au décompte comme à la purge). */
  lire(ctx: QueryCtx, pid: Pid, n: number): Promise<unknown[]>;
  /** Efface jusqu'à `n` lignes (et ce qu'elles portent) ; rend le nombre traité. */
  purger(ctx: MutationCtx, pid: Pid, n: number): Promise<number>;
}

/**
 * Une étape de purge. `avant` efface ce que la ligne porte (fichier, lignes
 * filles sans index projet) ; `remplacer` se substitue à la suppression quand un
 * helper existant le fait déjà proprement (assignations).
 */
function etape<D extends { _id: Id<TableNames> }>(
  lire: (ctx: QueryCtx, pid: Pid, n: number) => Promise<D[]>,
  opts: {
    avant?: (ctx: MutationCtx, d: D) => Promise<void>;
    remplacer?: (ctx: MutationCtx, d: D) => Promise<void>;
  } = {},
): Etape {
  return {
    lire,
    async purger(ctx, pid, n) {
      const docs = await lire(ctx, pid, n);
      for (const d of docs) {
        if (opts.avant) await opts.avant(ctx, d);
        if (opts.remplacer) await opts.remplacer(ctx, d);
        else await ctx.db.delete(d._id);
      }
      return docs.length;
    },
  };
}

/**
 * Une étape par table, dans l'ordre de `TABLES_PURGEES`. Le type `Record`
 * oblige à en écrire une pour CHAQUE table de la liste : tsc casse sinon.
 */
const ETAPES: Record<TablePurgee, Etape> = {
  comptes: etape(
    (ctx, pid, n) =>
      ctx.db.query("comptes").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
    { avant: (ctx, c) => deleteStorageBestEffort(ctx, c.avatar?.storageId) },
  ),
  // Vidéo soumise (Convex + Cloudflare Stream) : le helper de suppression
  // d'assignation s'en charge déjà — on ne le réécrit pas.
  assignments: etape(
    (ctx, pid, n) =>
      ctx.db.query("assignments").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
    { remplacer: purgeAndDeleteAssignment },
  ),
  publications: etape(
    (ctx, pid, n) =>
      ctx.db.query("publications").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
    { avant: (ctx, p) => deleteStorageBestEffort(ctx, p.image) },
  ),
  metricSnapshots: etape((ctx, pid, n) =>
    ctx.db.query("metricSnapshots").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  earlyReadings: etape((ctx, pid, n) =>
    ctx.db
      .query("earlyReadings")
      .withIndex("by_project_capturedAt", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  earlyReadingAttempts: etape((ctx, pid, n) =>
    ctx.db
      .query("earlyReadingAttempts")
      .withIndex("by_project", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  accountProfileSnapshots: etape((ctx, pid, n) =>
    ctx.db
      .query("accountProfileSnapshots")
      .withIndex("by_project_capturedAt", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  publicationFlagChanges: etape((ctx, pid, n) =>
    ctx.db
      .query("publicationFlagChanges")
      .withIndex("by_project_at", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  publicationUrlChanges: etape((ctx, pid, n) =>
    ctx.db
      .query("publicationUrlChanges")
      .withIndex("by_project_at", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  // Invitations et fichiers déposés n'ont pas d'index projet : ils partent avec
  // leur créatrice. Les fichiers Drive eux-mêmes restent chez Google.
  creators: etape(
    (ctx, pid, n) =>
      ctx.db.query("creators").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
    {
      avant: async (ctx, c) => {
        const invitations = await ctx.db
          .query("invitations")
          .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
          .collect();
        for (const i of invitations) await ctx.db.delete(i._id);
        const depots = await ctx.db
          .query("snytchDriveFiles")
          .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
          .collect();
        for (const f of depots) await ctx.db.delete(f._id);
      },
    },
  ),
  creatorContracts: etape(
    (ctx, pid, n) =>
      ctx.db.query("creatorContracts").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
    { avant: (ctx, c) => deleteStorageBestEffort(ctx, c.storageId) },
  ),
  creatorConversions: etape((ctx, pid, n) =>
    ctx.db
      .query("creatorConversions")
      .withIndex("by_project_date", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  rushes: etape((ctx, pid, n) =>
    ctx.db.query("rushes").withIndex("by_project_status", (q) => q.eq("projectId", pid)).take(n),
  ),
  bonusUnlocks: etape((ctx, pid, n) =>
    ctx.db.query("bonusUnlocks").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  payments: etape((ctx, pid, n) =>
    ctx.db.query("payments").withIndex("by_project_period", (q) => q.eq("projectId", pid)).take(n),
  ),
  managerPayouts: etape((ctx, pid, n) =>
    ctx.db
      .query("managerPayouts")
      .withIndex("by_project_manager", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  challengeWins: etape((ctx, pid, n) =>
    ctx.db.query("challengeWins").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  // Les participations n'ont pas d'index projet : elles partent avec leur défi.
  challenges: etape(
    (ctx, pid, n) =>
      ctx.db.query("challenges").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
    {
      avant: async (ctx, c) => {
        const participations = await ctx.db
          .query("challengeParticipants")
          .withIndex("by_challenge", (q) => q.eq("challengeId", c._id))
          .collect();
        for (const p of participations) await ctx.db.delete(p._id);
      },
    },
  ),
  hooks: etape((ctx, pid, n) =>
    ctx.db.query("hooks").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  hookGraduations: etape((ctx, pid, n) =>
    ctx.db.query("hookGraduations").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  scriptBricks: etape((ctx, pid, n) =>
    ctx.db.query("scriptBricks").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  scriptCampaigns: etape((ctx, pid, n) =>
    ctx.db.query("scriptCampaigns").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  formats: etape(
    (ctx, pid, n) =>
      ctx.db.query("formats").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
    {
      avant: async (ctx, f) => {
        for (const ex of f.exampleVideos) {
          if (ex.kind === "file") await deleteStorageBestEffort(ctx, ex.storageId);
        }
      },
    },
  ),
  pricings: etape((ctx, pid, n) =>
    ctx.db.query("pricings").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  bonusTemplates: etape((ctx, pid, n) =>
    ctx.db.query("bonusTemplates").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  inspirations: etape(
    (ctx, pid, n) =>
      ctx.db.query("inspirations").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
    { avant: (ctx, i) => deleteStorageBestEffort(ctx, i.thumbnail) },
  ),
  folders: etape((ctx, pid, n) =>
    ctx.db.query("folders").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  assets: etape(
    (ctx, pid, n) =>
      ctx.db.query("assets").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
    {
      avant: async (ctx, a) => {
        await deleteStorageBestEffort(ctx, a.storageId);
        await deleteStorageBestEffort(ctx, a.postprocessBackup?.storageId);
      },
    },
  ),
  assetFolders: etape((ctx, pid, n) =>
    ctx.db.query("assetFolders").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  personnes: etape((ctx, pid, n) =>
    ctx.db.query("personnes").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  icps: etape((ctx, pid, n) =>
    ctx.db.query("icps").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  filterPresets: etape((ctx, pid, n) =>
    ctx.db.query("filterPresets").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  publicShares: etape((ctx, pid, n) =>
    ctx.db.query("publicShares").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  projectGuide: etape((ctx, pid, n) =>
    ctx.db.query("projectGuide").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  guideModules: etape((ctx, pid, n) =>
    ctx.db.query("guideModules").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  radarVideos: etape((ctx, pid, n) =>
    ctx.db.query("radarVideos").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  radarAccounts: etape((ctx, pid, n) =>
    ctx.db.query("radarAccounts").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  whopPayments: etape((ctx, pid, n) =>
    ctx.db.query("whopPayments").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  whopMemberships: etape((ctx, pid, n) =>
    ctx.db.query("whopMemberships").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  whopPlans: etape((ctx, pid, n) =>
    ctx.db.query("whopPlans").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  whopLedgerLines: etape((ctx, pid, n) =>
    ctx.db
      .query("whopLedgerLines")
      .withIndex("by_project_posted", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  comptaMonths: etape((ctx, pid, n) =>
    ctx.db
      .query("comptaMonths")
      .withIndex("by_project_month", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  comptaState: etape((ctx, pid, n) =>
    ctx.db.query("comptaState").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  comptaCharges: etape((ctx, pid, n) =>
    ctx.db
      .query("comptaCharges")
      .withIndex("by_project_month", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  comptaAccountReadings: etape((ctx, pid, n) =>
    ctx.db.query("comptaAccountReadings").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  comptaAccounts: etape((ctx, pid, n) =>
    ctx.db.query("comptaAccounts").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  comptaProvisionUses: etape((ctx, pid, n) =>
    ctx.db.query("comptaProvisionUses").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  mcpWriteLog: etape((ctx, pid, n) =>
    ctx.db.query("mcpWriteLog").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  mcpPropositions: etape((ctx, pid, n) =>
    ctx.db.query("mcpPropositions").withIndex("by_project_statut", (q) => q.eq("projectId", pid)).take(n),
  ),
  hookExperiments: etape((ctx, pid, n) =>
    ctx.db.query("hookExperiments").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  creatorMessages: etape((ctx, pid, n) =>
    ctx.db.query("creatorMessages").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  marketGroups: etape((ctx, pid, n) =>
    ctx.db.query("marketGroups").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  offerChanges: etape((ctx, pid, n) =>
    ctx.db.query("offerChanges").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  notificationWindows: etape((ctx, pid, n) =>
    ctx.db
      .query("notificationWindows")
      .withIndex("by_project_kind", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  permissionChanges: etape((ctx, pid, n) =>
    ctx.db
      .query("permissionChanges")
      .withIndex("by_project_subject", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  syncMarkers: etape((ctx, pid, n) =>
    ctx.db
      .query("syncMarkers")
      .withIndex("by_project_source", (q) => q.eq("projectId", pid))
      .take(n),
  ),
  leaderboardCache: etape((ctx, pid, n) =>
    ctx.db.query("leaderboardCache").withIndex("by_project", (q) => q.eq("projectId", pid)).take(n),
  ),
  dashboardCache: etape((ctx, pid, n) =>
    ctx.db.query("dashboardCache").withIndex("by_project_key", (q) => q.eq("projectId", pid)).take(n),
  ),
  posthogCache: etape((ctx, pid, n) =>
    ctx.db.query("posthogCache").withIndex("by_project_key", (q) => q.eq("projectId", pid)).take(n),
  ),
  posthogWindowCache: etape((ctx, pid, n) =>
    ctx.db
      .query("posthogWindowCache")
      .withIndex("by_project_key", (q) => q.eq("projectId", pid))
      .take(n),
  ),
};

/**
 * Une exécution de la purge : avance d'étape en étape, efface jusqu'à
 * ECRITURES_PAR_EXECUTION lignes, et se reprogramme tant qu'il en reste.
 * Idempotente : relancée sur un projet déjà purgé, elle parcourt des index vides
 * et s'arrête.
 */
export const purgerProjet = internalMutation({
  args: { projectId: v.id("projects"), depuis: v.number() },
  handler: async (ctx, { projectId, depuis }) => {
    let i = depuis;
    let ecrites = 0;
    while (i < TABLES_PURGEES.length) {
      const n = await ETAPES[TABLES_PURGEES[i]].purger(ctx, projectId, LOT);
      ecrites += n;
      // Moins qu'un lot plein : la table est vide pour ce projet.
      if (n < LOT) i += 1;
      if (ecrites >= ECRITURES_PAR_EXECUTION) break;
    }
    if (i < TABLES_PURGEES.length) {
      await ctx.scheduler.runAfter(0, internal.projectLifecycle.purgerProjet, {
        projectId,
        depuis: i,
      });
      return { termine: false, etape: TABLES_PURGEES[i], ecrites };
    }
    console.log(`[projectLifecycle] purge terminée pour ${projectId}`);
    return { termine: true, ecrites };
  },
});

// ─── Supprimer : ce que l'écran annonce, puis le geste ───────────────────────

/** Au-delà, l'écran affiche « 500+ » : lire tout Snytch pour un décompte serait inutile. */
const PLAFOND_DECOMPTE = 500;

export const getProjectDeletionImpact = superadminQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    const compter = async (table: TablePurgee) => {
      const n = (await ETAPES[table].lire(ctx, projectId, PLAFOND_DECOMPTE + 1))
        .length;
      return { n: Math.min(n, PLAFOND_DECOMPTE), plus: n > PLAFOND_DECOMPTE };
    };
    const membres = await ctx.db
      .query("memberships")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(PLAFOND_DECOMPTE + 1);
    return {
      name: project.name,
      slug: project.slug,
      // Le projet de REPLI : getCurrentProject y renvoie un superadmin sans
      // membership. Le supprimer laisserait ce cas sans projet du tout.
      protege: project.slug === REPACKIT_SLUG,
      compteurs: {
        creatrices: await compter("creators"),
        comptes: await compter("comptes"),
        assignations: await compter("assignments"),
        publications: await compter("publications"),
        paiements: await compter("payments"),
        membres: {
          n: Math.min(membres.length, PLAFOND_DECOMPTE),
          plus: membres.length > PLAFOND_DECOMPTE,
        },
      },
    };
  },
});

/**
 * Retire l'accès d'un membre au projet supprimé, et son compte utilisateur s'il
 * devient ORPHELIN — même règle que la suppression d'une créatrice : aucun autre
 * membership, aucune fiche créatrice ailleurs, et jamais un superadmin.
 */
async function retirerMembre(ctx: MutationCtx, userId: Id<"users">, pid: Pid) {
  const user = await ctx.db.get(userId);
  if (!user) return;
  const resets = await ctx.db
    .query("passwordResetTokens")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const autresAcces = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const fiches = await ctx.db
    .query("creators")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const orphelin =
    user.role !== "superadmin" &&
    autresAcces.every((m) => m.projectId === pid) &&
    fiches.every((f) => f.projectId === pid);
  for (const r of resets) {
    if (orphelin || r.projectId === pid) await ctx.db.delete(r._id);
  }
  if (orphelin) {
    await deleteAuthDataOfUser(ctx, userId);
    await ctx.db.delete(userId);
  }
}

export const deleteProject = superadminMutation({
  args: { projectId: v.id("projects"), confirmation: v.string() },
  handler: async (ctx, { projectId, confirmation }) => {
    const project = await ctx.db.get(projectId);
    if (!project) throw err(ERR.PROJECT_NOT_FOUND, "Projet introuvable.");
    if (project.slug === REPACKIT_SLUG) {
      throw err(
        ERR.PROJECT_DELETE_PROTECTED,
        `« ${project.name} » ne peut pas être supprimé : c'est le projet de repli de l'application.`,
        { name: project.name },
      );
    }
    if (!deletionConfirmed(project.name, confirmation)) {
      throw err(
        ERR.PROJECT_DELETE_CONFIRMATION,
        `La saisie ne correspond pas au nom du projet (« ${project.name} »).`,
        { name: project.name },
      );
    }

    // 1. L'accès tombe d'un coup : memberships, puis les comptes devenus
    //    orphelins (membres ET créatrices qui ont un compte de connexion).
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const creatrices = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const utilisateurs = new Set<Id<"users">>(memberships.map((m) => m.userId));
    for (const c of creatrices) if (c.userId) utilisateurs.add(c.userId);
    for (const m of memberships) await ctx.db.delete(m._id);
    for (const u of utilisateurs) await retirerMembre(ctx, u, projectId);

    // 2. Le logo téléversé, puis le projet lui-même.
    await deleteStorageBestEffort(ctx, project.logoStorageId);
    await ctx.db.delete(projectId);

    // 3. Les données, par lots, en arrière-plan.
    await ctx.scheduler.runAfter(0, internal.projectLifecycle.purgerProjet, {
      projectId,
      depuis: 0,
    });
    return { deleted: true as const, name: project.name };
  },
});

/**
 * Test e2e — sème `n` lignes d'une table simple, pour que la purge traverse
 * PLUSIEURS lots et au moins une reprise par le planificateur (au-delà de
 * ECRITURES_PAR_EXECUTION). Une ligne par table ne l'exercerait jamais.
 */
export const e2eSeedPersonnes = e2eMutation({
  args: { projectId: v.id("projects"), n: v.number() },
  handler: async (ctx, { projectId, n }) => {
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      await ctx.db.insert("personnes", {
        projectId,
        prenom: `[E2E_TEST] P${i}`,
        nom: "Purge",
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

/** Test e2e — état d'un projet par slug (null = supprimé). */
export const e2eProjectState = e2eMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const p = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    return p === null
      ? null
      : {
          name: p.name,
          accentColor: p.accentColor,
          logoUrl: p.logoUrl ?? null,
          hasLogoBlob: p.logoStorageId !== undefined,
        };
  },
});

/**
 * Test e2e — tables qui portent ENCORE des lignes du projet. Vide = purge
 * terminée. Lit par les mêmes étapes que la purge : la spec éprouve la liste
 * réelle, pas une copie.
 */
export const e2eRemainingProjectRows = e2eMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const restantes: string[] = [];
    for (const t of TABLES_PURGEES) {
      if ((await ETAPES[t].lire(ctx, projectId, 1)).length > 0) restantes.push(t);
    }
    const acces = await ctx.db
      .query("memberships")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(1);
    if (acces.length > 0) restantes.push("memberships");
    return restantes;
  },
});
