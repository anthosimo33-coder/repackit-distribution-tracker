import { authedQuery, e2eMutation, requireProjectAccess } from "./functions";
import { ConvexError, v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * P2 Multi-tenant — résolution du projet courant.
 *
 * Le slug du projet historique (cible du backfill). Réutilisé comme fallback
 * pour un superadmin qui n'aurait aucun membership explicite.
 */
export const REPACKIT_SLUG = "repackit";

export async function getProjectBySlug(
  ctx: QueryCtx,
  slug: string,
): Promise<Doc<"projects"> | null> {
  return await ctx.db
    .query("projects")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
}

/**
 * Projet « courant » pour l'utilisateur connecté — consommé par le front pour
 * obtenir le projectId à passer à toutes les autres queries/mutations.
 *
 * ⚠️ TODO(P3) : provisoire en attendant le sélecteur de projet. Tant qu'un
 * user n'a qu'un seul projet, cette résolution suffit. Règle :
 *   - membership le plus récent (dernier _creationTime) si l'user en a — gère
 *     le cas e2e (user superadmin rattaché en plus à un projet e2e dédié créé
 *     après la migration : ce membership récent l'emporte) ;
 *   - sinon (superadmin sans membership) : fallback projet "repackit" ;
 *   - sinon : null (l'AppShell affiche un état vide).
 */
export const getCurrentProject = authedQuery({
  args: {},
  handler: async (ctx) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .collect();

    if (memberships.length > 0) {
      const latest = memberships.reduce((a, b) =>
        b._creationTime > a._creationTime ? b : a,
      );
      const project = await ctx.db.get(latest.projectId);
      if (project) return project;
    }

    return await getProjectBySlug(ctx, REPACKIT_SLUG);
  },
});

// ─── Helpers e2e (gated E2E_SECRET) ────────────────────────────────────────

/**
 * Crée (ou réutilise) un projet par slug et attache l'utilisateur identifié
 * par email (membership idempotent). Le global-setup Playwright l'appelle pour
 * créer le projet e2e dédié + rattacher le user e2e — getCurrentProject
 * (membership le plus récent) renverra alors ce projet.
 */
export const e2eEnsureProjectForEmail = e2eMutation({
  args: {
    slug: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.optional(v.union(v.literal("admin"), v.literal("creator"))),
    accentColor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (project === null) {
      const id = await ctx.db.insert("projects", {
        name: args.name,
        slug: args.slug,
        accentColor: args.accentColor ?? "#FF5200",
        payoutDay: 5,
        status: "active",
        createdAt: Date.now(),
      });
      project = await ctx.db.get(id);
    }
    const projectId = project!._id;

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (user === null) {
      throw new ConvexError(`User e2e introuvable: ${args.email}`);
    }
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", user._id).eq("projectId", projectId),
      )
      .first();
    if (existing === null) {
      await ctx.db.insert("memberships", {
        userId: user._id,
        projectId,
        role: args.role ?? "admin",
      });
    }
    return { projectId };
  },
});

/**
 * Crée un user NON-superadmin (role "member") + un membership dans un projet —
 * sert UNIQUEMENT au test d'isolation inter-projets (le user e2e standard est
 * superadmin et contourne le membership). Idempotent par email.
 */
export const e2eEnsureMemberUser = e2eMutation({
  args: {
    email: v.string(),
    projectId: v.id("projects"),
    role: v.optional(v.union(v.literal("admin"), v.literal("creator"))),
  },
  handler: async (ctx, args) => {
    let user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (user === null) {
      const id = await ctx.db.insert("users", {
        email: args.email,
        role: "member",
      });
      user = await ctx.db.get(id);
    }
    const userId = user!._id;
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", userId).eq("projectId", args.projectId),
      )
      .first();
    if (existing === null) {
      await ctx.db.insert("memberships", {
        userId,
        projectId: args.projectId,
        role: args.role ?? "creator",
      });
    }
    return { userId };
  },
});

/**
 * Exécute requireProjectAccess pour le user (par email) sur projectId et
 * retourne { allowed, error? }. Sert au test d'isolation : un user member du
 * projet A doit être REFUSÉ sur le projet B. Ne passe pas par une session
 * (le user de test n'a pas de mot de passe) mais exerce la VRAIE logique de
 * garde requireProjectAccess.
 */
export const e2eAssertAccess = e2eMutation({
  args: { email: v.string(), projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (user === null) {
      return { allowed: false, error: "user introuvable" };
    }
    try {
      await requireProjectAccess(ctx, user._id, args.projectId);
      return { allowed: true };
    } catch (e) {
      return {
        allowed: false,
        error: e instanceof ConvexError ? String(e.data) : "error",
      };
    }
  },
});

/** Récupère l'id d'un projet par slug (e2e setup/teardown). */
export const e2eGetProjectIdBySlug = e2eMutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const project = await getProjectBySlug(ctx, args.slug);
    return { projectId: project?._id ?? null };
  },
});

/**
 * Crée (idempotent) un projet par slug SANS aucun membership — pour les tests
 * d'isolation / compteur d'IDs qui ne doivent PAS rattacher le user e2e (sinon
 * getCurrentProject renverrait ce projet vide). L'accès se fait via le bypass
 * superadmin du user e2e.
 */
export const e2eEnsureProjectBySlug = e2eMutation({
  args: { slug: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    let project = await getProjectBySlug(ctx, args.slug);
    if (project === null) {
      const id = await ctx.db.insert("projects", {
        name: args.name,
        slug: args.slug,
        accentColor: "#FF5200",
        payoutDay: 5,
        status: "active",
        createdAt: Date.now(),
      });
      project = await ctx.db.get(id);
    }
    return { projectId: project!._id };
  },
});

/**
 * Élague les memberships du user e2e (par email) pour ne garder QUE celui du
 * projet `keepSlug`. Rend getCurrentProject déterministe pour le user e2e
 * (sinon une spec d'isolation peut le rattacher à un projet vide et casser les
 * specs UI). Appelé au global-setup.
 */
export const e2ePruneMemberships = e2eMutation({
  args: { email: v.string(), keepSlug: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (user === null) return { pruned: 0 };
    const keep = await getProjectBySlug(ctx, args.keepSlug);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    let pruned = 0;
    for (const m of memberships) {
      if (keep && m.projectId === keep._id) continue;
      await ctx.db.delete(m._id);
      pruned += 1;
    }
    return { pruned };
  },
});
