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
