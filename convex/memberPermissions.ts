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
import {
  MEMBERSHIP_ROLES,
  promotionToAdminDecision,
  roleSetProblem,
  rolesOf,
} from "./roles";

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
export async function traceDiff(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  subjectUserId: Id<"users">,
  before: readonly string[],
  after: readonly string[],
  actorLabel: string,
  actorUserId?: Id<"users">,
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
      // plutôt que d'attribuer le geste à quelqu'un. Depuis l'écran de gestion,
      // c'est le compte connecté qui signe.
      actorUserId,
      actorLabel,
      at,
    });
  }
  return rows;
}

/** Chaînes hors catalogue — nommées dans le rapport, stockées quand même. */
export function unknownOf(permissions: readonly string[]): string[] {
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
      // AJOUT, jamais remplacement : provisionner un manager en ligne de
      // commande ne doit pas retirer à quelqu'un son espace créatrice — c'est
      // le même invariant que `team.addRole`, sur l'autre chemin d'écriture.
      const apres = MEMBERSHIP_ROLES.filter(
        (r) => rolesOf(membership).has(r) || r === "manager",
      );
      const probleme = roleSetProblem(apres);
      if (probleme !== null) throw new ConvexError(probleme);
      await ctx.db.patch(membership._id, {
        roles: apres,
        role: undefined,
        permissions: next,
      });
    } else {
      await ctx.db.insert("memberships", {
        userId,
        projectId,
        roles: ["manager"],
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
    if (!rolesOf(membership).has("manager")) {
      throw new ConvexError(
        `« ${email} » n'a pas le rôle manager sur ce projet (${[...rolesOf(membership)].join(", ") || "aucun rôle"}) : ` +
          "les droits ne s'appliquent qu'à « manager ».",
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
      projectRoles: [...rolesOf(membership)],
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

/**
 * Étiquette de journal d'une promotion. Ce n'est PAS un bloc du catalogue, et
 * c'est assumé : `permissionChanges.permission` est un `v.string()` justement
 * pour qu'une valeur hors catalogue reste LISIBLE à la relecture. Un bloc ne
 * décrirait pas le geste — devenir admin n'est pas cocher vingt cases, c'est
 * passer avant l'endroit où on les lit.
 */
export const ROLE_ADMIN_TRACE = "role:admin";

/**
 * PASSE UN MANAGER EN ADMINISTRATEUR DU PROJET, EN LIGNE DE COMMANDE.
 *
 * ⚠️ CE N'EST PLUS LE SEUL CHEMIN. `team.setTeamRole` fait le même geste depuis
 * l'écran « Rôles et droits » (et sait, lui, redescendre). Cette fonction reste
 * pour deux cas que l'écran ne couvre pas : un projet où plus personne ne peut
 * ouvrir l'écran, et l'amorçage d'un déploiement neuf.
 *
 * Ce commentaire disait auparavant que la montée était « délibérément hors
 * écran », au motif qu'accorder d'un clic le rôle qui passe AVANT toute
 * permission serait un geste fait par inadvertance. La crainte était juste, la
 * conclusion trop large : l'écran la traite en EXIGEANT QU'ON RECOPIE L'E-MAIL
 * de la personne, exactement comme `convex-prod.sh` exige qu'on recopie le nom
 * du déploiement. Ce qu'on refuse, c'est un clic distrait, pas une interface.
 *
 *   ./scripts/convex-prod.sh run memberPermissions:promoteToProjectAdmin \
 *     '{"email":"…","projectSlug":"snytch"}'
 *
 * CE QU'ELLE NE FAIT PAS :
 *   - elle ne CRÉE pas de membership (un accès qui n'existe pas ne se « promeut »
 *     pas ; c'est le travail de provisionAdmin:grantProjectAdmin) ;
 *   - elle ne touche PAS `permissions`. Les blocs stockés n'ouvrent ni ne
 *     limitent plus rien une fois le rôle `admin` posé (la cascade de
 *     `requirePermission` s'arrête avant de les lire), et les EFFACER écrirait au
 *     journal treize retraits de droits — un journal qui raconterait une
 *     rétrogradation le jour d'une promotion. Ils restent donc en place, et
 *     redeviennent l'état de départ si quelqu'un repasse la personne en manager.
 *
 * Le journal reçoit UNE ligne, signée « cli » : un droit accordé hors écran doit
 * laisser la même trace qu'un droit accordé à l'écran.
 */
export const promoteToProjectAdmin = internalMutation({
  args: { email: v.string(), projectSlug: v.string() },
  handler: async (ctx, { email, projectSlug }) => {
    const { userId, projectId } = await resolveMember(ctx, email, projectSlug);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", userId).eq("projectId", projectId),
      )
      .first();
    if (!membership) {
      throw new ConvexError(
        `« ${email} » n'est pas membre de « ${projectSlug} » — rien à promouvoir.`,
      );
    }
    const decision = promotionToAdminDecision(membership);
    if (decision === "refuse") {
      throw new ConvexError(
        `« ${email} » a le rôle « ${[...rolesOf(membership)].join(", ") || "aucun"} » sur « ${projectSlug} » : ` +
          "seul un « manager » se promeut en administrateur.",
      );
    }
    if (decision === "noop") {
      return {
        email,
        projectSlug,
        role: "admin" as const,
        changed: false,
        traced: 0,
      };
    }
    // Meme forme d'ecriture que partout ailleurs depuis la bascule : on pose la
    // LISTE et on efface le scalaire, sinon `rolesOf` continuerait de lire
    // l'ancienne valeur et la promotion serait sans effet.
    await ctx.db.patch(membership._id, { roles: ["admin"], role: undefined });
    // Réécrit par le MÊME écrivain que les droits cochés à l'écran : une seule
    // fonction connaît la forme d'une ligne de journal.
    const traced = await traceDiff(
      ctx,
      projectId,
      userId,
      [],
      [ROLE_ADMIN_TRACE],
      "cli",
    );
    return {
      email,
      projectSlug,
      role: "admin" as const,
      changed: true,
      // Les blocs restés en base — ils n'ouvrent ni ne limitent plus rien.
      dormantPermissions: membership.permissions ?? [],
      traced: traced.length,
    };
  },
});
