import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Remédiation sécurité — wrappers de gating pour TOUTES les fonctions
 * publiques du repo.
 *
 * RÈGLE : aucun module ne doit définir de fonction publique via query /
 * mutation bruts de _generated/server. Toujours passer par :
 *   - authedQuery / authedMutation : identité requise (session Convex Auth).
 *     ctx est enrichi de `userId` (Id<"users"> de l'appelant).
 *   - superadminMutation : identité requise + role === "superadmin".
 *     Réservé aux opérations d'administration (P4 : invitations…).
 *   - e2eMutation : PAS d'identité, mais arg `secret` strictement égal à
 *     process.env.E2E_SECRET côté deployment. Si la variable n'est pas
 *     définie sur le deployment → rejet systématique (cas prod, où
 *     E2E_SECRET ne doit JAMAIS être défini). Sert aux mutations de seed /
 *     cleanup e2e qui doivent fonctionner AVANT toute session (global-setup
 *     Playwright, fenêtre bootstrap pas encore franchie).
 *
 * Les internalMutation (migrations one-shot) restent inchangées : non
 * exposées à l'API publique, appelables uniquement via `convex run`.
 */

async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Non authentifié.");
  }
  return userId;
}

/**
 * P2 — vérifie que `userId` a accès au projet `projectId` :
 *   - superadmin (users.role) : accès implicite à TOUS les projets, sans
 *     membership ;
 *   - sinon : un membership (userId, projectId) doit exister (rôle admin ou
 *     creator — la séparation par fonction arrive en P4+).
 * Rejette sinon (isolation inter-projets ; B6 : projet et rôle = deux couches
 * distinctes).
 */
export async function requireProjectAccess(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
) {
  const project = await ctx.db.get(projectId);
  if (project === null) {
    throw new ConvexError("Projet introuvable.");
  }
  const user = await ctx.db.get(userId);
  if (user?.role === "superadmin") return;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", userId).eq("projectId", projectId),
    )
    .first();
  if (membership === null) {
    throw new ConvexError("Accès au projet refusé.");
  }
}

/**
 * P1 Créateurs — COUCHE RÔLE au-dessus de la couche projet. Vérifie que
 * `userId` est ADMIN du projet :
 *   - superadmin (users.role) : accès implicite (comme requireProjectAccess) ;
 *   - sinon : un membership (userId, projectId) de rôle "admin" est requis.
 * Un membership "creator" est REJETÉ — le rôle creator n'a accès à rien de
 * l'app interne (toutes ses fonctions passent par adminQuery/adminMutation).
 */
export async function requireProjectAdmin(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
) {
  const project = await ctx.db.get(projectId);
  if (project === null) {
    throw new ConvexError("Projet introuvable.");
  }
  const user = await ctx.db.get(userId);
  if (user?.role === "superadmin") return;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", userId).eq("projectId", projectId),
    )
    .first();
  if (membership === null) {
    throw new ConvexError("Accès au projet refusé.");
  }
  if (membership.role !== "admin") {
    throw new ConvexError("Réservé aux administrateurs du projet.");
  }
}

export const authedQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    const userId = await requireUserId(ctx);
    return { userId };
  }),
);

export const authedMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    const userId = await requireUserId(ctx);
    return { userId };
  }),
);

export const superadminMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (user?.role !== "superadmin") {
      throw new ConvexError("Réservé aux superadmins.");
    }
    return { userId };
  }),
);

export const e2eMutation = customMutation(mutation, {
  args: { secret: v.string() },
  input: async (_ctx, { secret }) => {
    const expected = process.env.E2E_SECRET;
    if (expected === undefined || expected.length === 0) {
      throw new ConvexError(
        "Fonctions e2e désactivées sur ce deployment (E2E_SECRET non défini).",
      );
    }
    if (secret !== expected) {
      throw new ConvexError("Secret e2e invalide.");
    }
    // `secret` est consommé ici : il n'atteint jamais le handler.
    return { ctx: {}, args: {} };
  },
});

/**
 * P2 — wrappers MÉTIER au-dessus des wrappers auth. Toute fonction qui touche
 * une table scopée projet passe par projectQuery/projectMutation : identité
 * requise + `projectId` (arg public obligatoire) + membership/superadmin
 * vérifié. Le handler reçoit `ctx.userId` et `ctx.projectId` (ne PAS
 * re-déclarer projectId dans les args du handler — le wrapper l'injecte).
 */
export const projectQuery = customQuery(query, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    await requireProjectAccess(ctx, userId, projectId);
    return { ctx: { userId, projectId }, args: {} };
  },
});

export const projectMutation = customMutation(mutation, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    await requireProjectAccess(ctx, userId, projectId);
    return { ctx: { userId, projectId }, args: {} };
  },
});

/**
 * P1 Créateurs — wrappers ADMIN (couche rôle au-dessus de projectQuery/
 * projectMutation). Même contrat (arg `projectId` obligatoire, `ctx.userId` +
 * `ctx.projectId` injectés) mais exige le rôle admin (ou superadmin). TOUTES
 * les fonctions de l'app interne (comptes, publications, hooks, icps, folders,
 * inspirations, presets, personnes, snapshots, dashboard, créateurs) passent
 * par ces wrappers. projectQuery/projectMutation restent la couche « accès
 * projet, tout rôle » (réservée à de futures fonctions creator-accessibles).
 */
export const adminQuery = customQuery(query, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    await requireProjectAdmin(ctx, userId, projectId);
    return { ctx: { userId, projectId }, args: {} };
  },
});

export const adminMutation = customMutation(mutation, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    await requireProjectAdmin(ctx, userId, projectId);
    return { ctx: { userId, projectId }, args: {} };
  },
});

/**
 * P5 Comptes créateurs — exige le rôle "creator" sur le projet ET résout SA
 * fiche `creators` (par userId, scopée projet). Retourne le creatorId, injecté
 * dans ctx → toute donnée servie par un creatorQuery/creatorMutation est
 * filtrée par CE creatorId côté serveur (un créateur ne voit que ses comptes).
 */
export async function requireCreator(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
): Promise<Id<"creators">> {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", userId).eq("projectId", projectId),
    )
    .first();
  if (membership === null || membership.role !== "creator") {
    throw new ConvexError("Réservé aux créateurs du projet.");
  }
  const fiches = await ctx.db
    .query("creators")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const creator = fiches.find((c) => c.projectId === projectId);
  if (creator === undefined) {
    throw new ConvexError("Fiche créateur introuvable.");
  }
  return creator._id;
}

export const creatorQuery = customQuery(query, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    const creatorId = await requireCreator(ctx, userId, projectId);
    return { ctx: { userId, projectId, creatorId }, args: {} };
  },
});

export const creatorMutation = customMutation(mutation, {
  args: { projectId: v.id("projects") },
  input: async (ctx, { projectId }) => {
    const userId = await requireUserId(ctx);
    const creatorId = await requireCreator(ctx, userId, projectId);
    return { ctx: { userId, projectId, creatorId }, args: {} };
  },
});

/**
 * P1 Créateurs — endpoint GENUINEMENT PUBLIC (pré-session). Réservé au flow
 * d'invitation : la page /join doit lire l'invitation par token AVANT que le
 * compte n'existe (aucune identité possible). Comme /login, pas d'auth. Seul
 * `creators.getInvitationPreview` doit l'utiliser, et ne retourner AUCUNE
 * info qui leak l'existence/état d'un token (cf no-leak du chantier).
 */
export const publicQuery = query;
