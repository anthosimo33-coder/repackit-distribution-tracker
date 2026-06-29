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
import { internalAction, internalMutation } from "./_generated/server";
import { createAccount } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";

const RESET_TTL_MS = 48 * 60 * 60 * 1000; // 48 h (aligné convex/passwordReset.ts)

/**
 * Mint un token de reset (table passwordResetTokens, même shape/mécanique que
 * passwordReset.generatePasswordResetLink) pour `userId`, scopé `projectId`
 * (branding du preview /reset-password). Remplace tout token actif du user (un
 * seul lien valide à la fois).
 */
export const mintResetToken = internalMutation({
  args: { userId: v.id("users"), projectId: v.id("projects") },
  handler: async (
    ctx,
    { userId, projectId },
  ): Promise<{ token: string; expiresAt: number }> => {
    const previous = await ctx.db
      .query("passwordResetTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const t of previous) await ctx.db.delete(t._id);
    const expiresAt = Date.now() + RESET_TTL_MS;
    // Token long opaque (2× UUID v4, tirets retirés) — 244 bits d'entropie.
    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
    await ctx.db.insert("passwordResetTokens", {
      token,
      userId,
      projectId,
      expiresAt,
    });
    return { token, expiresAt };
  },
});

/**
 * (f) Crée un compte mot de passe pour `email` (role GLOBAL "member", jamais
 * superadmin) avec un mot de passe ALÉATOIRE généré et JETÉ ici (jamais retourné
 * ni loggé), puis mint un lien de reset. L'utilisateur fixe SON mot de passe via
 * le lien — aucun secret ne sort de cette fonction.
 * Retour : userId / email / resetPath / expiresAt — AUCUN secret.
 *
 * Le mot de passe réellement utilisable vient du flux de reset
 * (modifyAccountCredentials, éprouvé) : le hash initial n'est jamais utilisé.
 *
 *   npx convex run provisionAdmin:provisionAdminAccount \
 *     '{"email":"...","brandingProjectId":"<id>"}' --prod
 */
export const provisionAdminAccount = internalAction({
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
    // Mot de passe interne jeté : 24 octets aléatoires en hex. Jamais exfiltré.
    const throwaway = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const { user } = await createAccount<DataModel>(ctx, {
      provider: "password",
      account: { id: email, secret: throwaway },
      profile: { email, role: "member" },
    });
    const { token, expiresAt } = await ctx.runMutation(
      internal.provisionAdmin.mintResetToken,
      { userId: user._id, projectId: brandingProjectId },
    );
    return {
      userId: user._id,
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
