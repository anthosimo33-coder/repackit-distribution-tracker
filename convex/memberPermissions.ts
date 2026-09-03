/**
 * DROITS D'UN MEMBRE — écriture, trace, et relecture. Internal-only.
 *
 * L'écran de gestion (étape 6) n'existe pas encore : les premiers managers se
 * créent en ligne de commande. Ces fonctions sont donc le SEUL chemin d'écriture
 * des droits aujourd'hui — et c'est précisément pourquoi elles tracent dès
 * maintenant. Un droit accordé hors écran doit laisser la même trace qu'un droit
 * accordé à l'écran, sinon le journal ment par omission le jour où on le relit.
 *
 *   npx convex run memberPermissions:grantProjectManager \
 *     '{"email":"...","projectSlug":"...","permissions":["creators.read"]}' --env-file …
 *   npx convex run memberPermissions:setMemberPermissions '{...}' --env-file …
 *   npx convex run memberPermissions:describeMember '{"email":"...","projectSlug":"..."}' --env-file …
 *
 * ⚠️ L'ÉCRITURE EST PERMISSIVE, LA LECTURE EST LA GARANTIE. On stocke les
 * chaînes VERBATIM, sans refuser celles qui sortent du catalogue, et on rend un
 * rapport qui les nomme. Ce n'est pas de la négligence, c'est le corollaire du
 * modèle : `requirePermission` filtre par le catalogue à CHAQUE requête, donc une
 * valeur inconnue n'autorise rien où qu'elle vienne. Faire de l'écriture le
 * gardien créerait un second endroit où la règle vit — et le jour où un bloc est
 * renommé, un `permissions` figé en base par une validation d'hier continuerait
 * de décrire un monde qui n'existe plus.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";
import { PERMISSION_ID_LITERALS, defaultManagerPermissions, isPermissionId } from "./permissions";

/** Résout (user, projet) ou rejette avec un message qui dit lequel manque. */
async function resolveMember(
  ctx: MutationCtx,
  email: string,
  projectSlug: string,
): Promise<{ userId: Id<"users">; projectId: Id<"projects"> }> {
  const user = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .first();
  if (!user) throw new ConvexError(`Aucun compte pour « ${email} ».`);
  const project = await ctx.db
    .query("projects")
    .filter((q) => q.eq(q.field("slug"), projectSlug))
    .first();
  if (!project) throw new ConvexError(`Aucun projet « ${projectSlug} ».`);
  return { userId: user._id, projectId: project._id };
}

/**
 * Écrit le journal — UNIQUEMENT les blocs qui CHANGENT de sens. Un `set` qui
 * réécrit les mêmes droits ne produit aucune ligne : un journal qui consigne les
 * non-événements devient illisible, et c'est comme ça qu'on cesse de le lire.
 */
async function traceDiff(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  subjectUserId: Id<"users">,
  before: readonly string[],
  after: readonly string[],
  actorLabel: string,
) {
  const b = new Set(before);
  const a = new Set(after);
  const at = Date.now();
  const rows: { permission: string; granted: boolean }[] = [];
  for (const p of a) if (!b.has(p)) rows.push({ permission: p, granted: true });
  for (const p of b) if (!a.has(p)) rows.push({ permission: p, granted: false });
  for (const r of rows) {
    // Ajout seul : jamais de patch, jamais de delete sur cette table.
    await ctx.db.insert("permissionChanges", {
      projectId,
      subjectUserId,
      permission: r.permission,
      granted: r.granted,
      // Hors session (ligne de commande) → pas d'auteur identifié, et on le DIT
      // plutôt que d'attribuer le geste à quelqu'un.
      actorUserId: undefined,
      actorLabel,
      at,
    });
  }
  return rows;
}

/** Chaînes hors catalogue — nommées dans le rapport, stockées quand même. */
function unknownOf(permissions: readonly string[]): string[] {
  return permissions.filter((p) => !isPermissionId(p));
}

/**
 * Passe un membre du projet en `manager` avec un jeu de droits. Sans
 * `permissions`, applique les blocs cochés par défaut (frontière argent).
 * Crée le membership s'il n'existe pas.
 */
export const grantProjectManager = internalMutation({
  args: {
    email: v.string(),
    projectSlug: v.string(),
    permissions: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { email, projectSlug, permissions }) => {
    const { userId, projectId } = await resolveMember(ctx, email, projectSlug);
    const next = permissions ?? defaultManagerPermissions();
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", userId).eq("projectId", projectId),
      )
      .first();
    const before = membership?.permissions ?? [];
    if (membership) {
      await ctx.db.patch(membership._id, { role: "manager", permissions: next });
    } else {
      await ctx.db.insert("memberships", {
        userId,
        projectId,
        role: "manager",
        permissions: next,
      });
    }
    const traced = await traceDiff(ctx, projectId, userId, before, next, "cli");
    return {
      email,
      projectSlug,
      role: "manager" as const,
      permissions: next,
      unknown: unknownOf(next),
      traced: traced.length,
    };
  },
});

/**
 * Remplace les droits d'un membre (le multi-select soumet l'ensemble — même
 * patron que `setAssetFolders`). Ne touche PAS au rôle : refuse si le membership
 * n'est pas `manager`, parce que poser des droits sur un `admin` laisserait
 * croire qu'ils le limitent, alors qu'`admin` a tout.
 */
export const setMemberPermissions = internalMutation({
  args: {
    email: v.string(),
    projectSlug: v.string(),
    permissions: v.array(v.string()),
  },
  handler: async (ctx, { email, projectSlug, permissions }) => {
    const { userId, projectId } = await resolveMember(ctx, email, projectSlug);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", userId).eq("projectId", projectId),
      )
      .first();
    if (!membership) {
      throw new ConvexError(`« ${email} » n'est pas membre de « ${projectSlug} ».`);
    }
    if (membership.role !== "manager") {
      throw new ConvexError(
        `« ${email} » a le rôle « ${membership.role} » sur ce projet : les droits ne s'appliquent qu'à « manager ».`,
      );
    }
    const before = membership.permissions ?? [];
    await ctx.db.patch(membership._id, { permissions });
    const traced = await traceDiff(ctx, projectId, userId, before, permissions, "cli");
    return {
      email,
      projectSlug,
      permissions,
      unknown: unknownOf(permissions),
      traced: traced.length,
    };
  },
});

/** Relecture : rôle, droits stockés, droits EFFECTIFS, et le journal récent. */
export const describeMember = internalQuery({
  args: { email: v.string(), projectSlug: v.string() },
  handler: async (ctx, { email, projectSlug }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (!user) return null;
    const project = await ctx.db
      .query("projects")
      .filter((q) => q.eq(q.field("slug"), projectSlug))
      .first();
    if (!project) return null;
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", user._id).eq("projectId", project._id),
      )
      .first();
    const changes = await ctx.db
      .query("permissionChanges")
      .withIndex("by_project_subject", (q) =>
        q.eq("projectId", project._id).eq("subjectUserId", user._id),
      )
      .collect();
    const stored = membership?.permissions ?? [];
    return {
      email,
      globalRole: user.role ?? "member",
      projectRole: membership?.role ?? null,
      stored,
      // Ce qui est RÉELLEMENT accordé : les valeurs hors catalogue disparaissent
      // ici, exactement comme au contrôle d'accès.
      effective: stored.filter(isPermissionId),
      ignored: unknownOf(stored),
      catalogueSize: PERMISSION_ID_LITERALS.length,
      changes: changes
        .sort((a, b) => b.at - a.at)
        .map((c) => ({
          permission: c.permission,
          granted: c.granted,
          actorLabel: c.actorLabel,
          at: c.at,
        })),
    };
  },
});
