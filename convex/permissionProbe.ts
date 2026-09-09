/**
 * SONDES DU SOCLE DE PERMISSIONS — les seules fonctions qui portent
 * `permissionQuery` tant qu'aucune des 212 n'est migrée.
 *
 * POURQUOI ELLES EXISTENT. Sans elles, les wrappers `permissionQuery` /
 * `permissionMutation` seraient livrés SANS AVOIR JAMAIS SERVI : on saurait que
 * `requirePermission` refuse correctement (l'assertion e2e ci-dessous le prouve),
 * mais pas que le wrapper l'appelle vraiment, ni qu'il injecte le bon `ctx`. Un
 * wrapper de contrôle d'accès jamais exécuté est exactement le genre de code
 * qu'on croit vert.
 *
 * Elles portent DEUX blocs voisins et de sens opposés — un coché par défaut, un
 * décoché — pour que le test puisse montrer, sur la même session, un OUI et un
 * NON. Une sonde unique prouverait qu'on peut passer, jamais qu'on peut être
 * arrêté.
 *
 * ⚠️ Elles ne rendent AUCUNE donnée : `{ ok: true }` et le nom du bloc franchi.
 * Leur valeur est d'être refusées. Elles restent après la migration des 212 —
 * ce sont elles qui casseront si le câblage des wrappers régresse un jour, alors
 * que les fonctions métier, elles, casseraient pour mille autres raisons.
 */
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import {
  e2eMutation,
  permissionQuery,
  requirePermission,
} from "./functions";
import { isPermissionId } from "./permissions";

/** Sonde sur un bloc COCHÉ par défaut pour un manager. */
export const probeCreatorsRead = permissionQuery("creators.read")({
  args: {},
  handler: async () => ({ ok: true as const, permission: "creators.read" }),
});

/** Sonde sur un bloc DÉCOCHÉ par défaut — le voisin qui doit refuser. */
export const probePaymentsManage = permissionQuery("payments.manage")({
  args: {},
  handler: async () => ({ ok: true as const, permission: "payments.manage" }),
});

/**
 * Assertion du contrôle d'accès par bloc, AS l'utilisateur `email`. Exécute la
 * MÊME garde que les wrappers (`requirePermission`) et renvoie `{ allowed, error }`
 * sans lever — même patron que `creators.e2eAssertViewAsAccess`.
 *
 * Sert à couvrir les cas que le wrapper ne peut pas atteindre depuis une session :
 * un rôle de membership inconnu, un bloc hors catalogue passé par un appelant non
 * typé, un projet inexistant. `permission` est `v.string()` À DESSEIN : c'est
 * précisément la valeur hors catalogue qu'on veut pouvoir soumettre.
 */
export const e2eAssertPermission = e2eMutation({
  args: {
    email: v.string(),
    projectId: v.id("projects"),
    permission: v.string(),
  },
  handler: async (ctx, { email, projectId, permission }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (user === null) return { allowed: false, error: "user introuvable" };
    try {
      // Le cast est le SUJET du test : on soumet volontairement une chaîne que le
      // type interdit, pour vérifier que la garde ne s'en remet pas au typage.
      await requirePermission(
        ctx,
        user._id,
        projectId,
        permission as Parameters<typeof requirePermission>[3],
      );
      return { allowed: true, error: null as string | null };
    } catch (e) {
      const data = e instanceof ConvexError ? (e.data as { code?: string }) : null;
      return { allowed: false, error: data?.code ?? String(e) };
    }
  },
});

/** Le bloc soumis appartient-il au catalogue ? Exposé pour l'assertion e2e. */
export const e2eIsPermissionId = e2eMutation({
  args: { permission: v.string() },
  handler: async (_ctx, { permission }) => ({
    known: isPermissionId(permission),
  }),
});

/**
 * Pose un rôle de membership (et ses droits) sur un compte existant, pour les
 * specs. Crée le membership s'il n'existe pas.
 *
 * POURQUOI CETTE FONCTION EXISTE. Un manager ne peut être fabriqué par aucun
 * chemin atteignable depuis une spec : `memberPermissions.grantProjectManager`
 * est une `internalMutation` (ligne de commande seulement), et `team.*` exige
 * une session superadmin ET refuse un membership de portail. Sans elle, le rôle
 * manager restait intestable de bout en bout — ce qu'il a été depuis #154.
 *
 * ⚠️ `permissions` est `v.array(v.string())` À DESSEIN, comme la CLI : une spec
 * doit pouvoir écrire une valeur HORS CATALOGUE pour vérifier qu'elle n'ouvre
 * rien. La garantie est à la lecture (`grantedPermissions`), jamais à l'écriture.
 *
 * `role`, lui, reste l'union du schéma : le backend refuserait un littéral
 * inconnu à l'insertion, et c'est une propriété qu'on ASSERTE plutôt que
 * contourner (cf e2e/permission-cascade.spec.ts).
 */
export const e2eSetMembershipRole = e2eMutation({
  args: {
    email: v.string(),
    projectId: v.id("projects"),
    role: v.union(
      v.literal("admin"),
      v.literal("manager"),
      v.literal("creator"),
      v.literal("talent"),
      v.literal("clipper"),
    ),
    permissions: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { email, projectId, role, permissions }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (user === null) throw new ConvexError(`Compte introuvable : ${email}`);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", user._id).eq("projectId", projectId),
      )
      .first();
    if (membership === null) {
      await ctx.db.insert("memberships", {
        userId: user._id,
        projectId,
        role,
        permissions,
      });
    } else {
      await ctx.db.patch(membership._id, { role, permissions });
    }
    return { userId: user._id, role, permissions: permissions ?? [] };
  },
});

/**
 * Retire TOUT membership de ce compte sur ce projet. Sert au cas « pas de
 * membership » de la cascade, qui n'est atteignable autrement qu'en devinant un
 * projectId d'un autre projet — ce qui testerait l'isolation, pas la cascade.
 */
export const e2eDropMembership = e2eMutation({
  args: { email: v.string(), projectId: v.id("projects") },
  handler: async (ctx, { email, projectId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (user === null) throw new ConvexError(`Compte introuvable : ${email}`);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", user._id).eq("projectId", projectId),
      )
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);
    return { removed: memberships.length };
  },
});
