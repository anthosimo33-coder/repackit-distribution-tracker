// convex/provisionAdmin.ts
// OUTIL ONE-SHOT — provisioning d'un compte admin (associé). Internal-only,
// JAMAIS exposé au client (aucun wrapper authed/public). À SUPPRIMER
// intégralement via la PR de cleanup une fois le 1er login confirmé.
//
// Sécurité : aucun argument de rôle promu → impossible de fabriquer un
// superadmin avec ces fonctions. Le rôle global est figé "member" et le rôle
// projet figé "admin". Lancé manuellement via `npx convex run ... --prod` par un
// opérateur ayant accès au deployment.
import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const RESET_TTL_MS = 48 * 60 * 60 * 1000; // 48 h (aligné convex/passwordReset.ts)

/**
 * Crée un compte mot de passe pour `email` (role GLOBAL "member", jamais
 * superadmin) par INSERTS BRUTS `users` + `authAccounts`, contournant le gate de
 * signup (auth.ts `createOrUpdateUser`, « inscription fermée »).
 *
 * Compte STRUCTURELLEMENT identique à un signup normal (vérifié contre la lib
 * Convex Auth — users.js/createOrUpdateAccount) :
 *   - users        : { email, role:"member" } (idem callback invitation auth.ts)
 *   - authAccounts : { userId, provider:"password", providerAccountId:email }
 * `secret` est OMIS (optional) : aucun mot de passe posé ici → l'utilisateur le
 * fixe via le lien de reset (`modifyAccountCredentials` remplit `secret` ; il
 * exige seulement que la ligne authAccounts existe, pas un secret préalable).
 * `emailVerified` non requis (le gate login `Password.js` ne s'active que si
 * `config.verify` est défini, ce qui n'est pas le cas ici). AUCUNE autre table
 * touchée (sessions/verifiers créés au sign-in).
 *
 * Mint aussi le lien de reset. Refuse si l'email existe déjà (préserve l'unicité
 * `.unique()` des lookups auth). Retour : userId/email/resetPath/expiresAt.
 *
 *   npx convex run provisionAdmin:provisionAdminAccount \
 *     '{"email":"...","brandingProjectId":"<id>"}' --prod
 */
export const provisionAdminAccount = internalMutation({
  args: { email: v.string(), brandingProjectId: v.id("projects") },
  handler: async (
    ctx,
    { email, brandingProjectId },
  ): Promise<{
    userId: Id<"users">;
    email: string;
    resetPath: string;
    expiresAt: number;
  }> => {
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (existing !== null) {
      throw new ConvexError(`User ${email} existe déjà — provisioning annulé.`);
    }

    // Inserts bruts (mêmes champs qu'un signup invitation). secret omis →
    // posé par le reset ; emailVerified non requis.
    const userId = await ctx.db.insert("users", { email, role: "member" });
    await ctx.db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: email,
    });

    // Lien de reset (même mécanique que passwordReset.generatePasswordResetLink).
    const expiresAt = Date.now() + RESET_TTL_MS;
    // Token long opaque (2× UUID v4, tirets retirés) — 244 bits d'entropie.
    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
    await ctx.db.insert("passwordResetTokens", {
      token,
      userId,
      projectId: brandingProjectId,
      expiresAt,
    });

    return {
      userId,
      email,
      resetPath: `/reset-password/${token}`,
      expiresAt,
    };
  },
});

/**
 * Accorde le rôle ADMIN à `userId` sur `projectId` EXACT (par id, pas par slug →
 * aucun risque de créer un projet). Idempotent : insère le membership SI absent ;
 * ne modifie jamais un membership existant ni le projet. Valide que user + projet
 * existent. Role figé "admin".
 *
 *   npx convex run provisionAdmin:grantProjectAdmin \
 *     '{"userId":"<id>","projectId":"<id>"}' --prod
 */
export const grantProjectAdmin = internalMutation({
  args: { userId: v.id("users"), projectId: v.id("projects") },
  handler: async (
    ctx,
    { userId, projectId },
  ): Promise<{ created: boolean; role: string }> => {
    const user = await ctx.db.get(userId);
    if (user === null) throw new ConvexError("User introuvable.");
    const project = await ctx.db.get(projectId);
    if (project === null) throw new ConvexError("Projet introuvable.");
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", userId).eq("projectId", projectId),
      )
      .first();
    if (existing !== null) return { created: false, role: existing.role };
    await ctx.db.insert("memberships", { userId, projectId, role: "admin" });
    return { created: true, role: "admin" };
  },
});
