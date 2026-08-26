import { adminMutation, e2eMutation, publicQuery } from "./functions";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  modifyAccountCredentials,
  invalidateSessions,
} from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ERR, err } from "./errorCodes";

/**
 * Reset mot de passe ADMIN — Voie B (lien à usage unique, sans email).
 *
 * Pas de self-service "mot de passe oublié" (aucun service email). À la place,
 * l'admin génère un lien /reset-password/<token> depuis la fiche créateur et le
 * transmet (WhatsApp). Le créateur clique, choisit un nouveau mot de passe.
 * L'admin ne voit JAMAIS de mot de passe en clair.
 *
 * Sécurité :
 *   - generatePasswordResetLink = adminMutation (admin du projet requis),
 *     scopée projet, superadmin REFUSÉ (cohérent avec adminRecovery, PR #34).
 *   - Le mot de passe vit en hash scrypt dans authAccounts (provider
 *     "password", providerAccountId=email, secret=hash). Le reset re-hashe ce
 *     secret via modifyAccountCredentials (même mécanique que resetTestPassword
 *     de PR #34), puis invalide les sessions.
 *   - Token à USAGE UNIQUE (usedAt) + expiration : la consommation est faite
 *     dans une mutation transactionnelle (consumePasswordResetToken) AVANT le
 *     re-hash → un rejeu concurrent voit usedAt posé et échoue.
 */

const PASSWORD_PROVIDER = "password";
// Durée de validité du lien : 48 h. Assez long pour un envoi WhatsApp + action
// du créateur, assez court pour limiter la fenêtre d'un lien fuité.
const RESET_TTL_MS = 48 * 60 * 60 * 1000;

/** Compte mot de passe (authAccounts) d'un user, ou null. */
async function passwordAccountFor(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) =>
      q.eq("userId", userId).eq("provider", PASSWORD_PROVIDER),
    )
    .first();
}

/**
 * ADMIN — génère un lien de reset à usage unique pour un créateur DÉJÀ finalisé
 * (compte + mot de passe existants). Retourne { token, expiresAt } ; l'UI
 * compose l'URL /reset-password/<token>. Remplace tout lien actif précédent du
 * même user (un seul lien valide à la fois).
 *
 * Refus :
 *   - créateur hors projet courant → introuvable ;
 *   - créateur pas encore finalisé (status "invited", pas de userId) → orienter
 *     vers « Régénérer l'invitation » (/join) ;
 *   - compte superadmin → interdit (protège anthosimo972@gmail.com) ;
 *   - compte sans mot de passe (connexion externe) → reset impossible.
 */
export const generatePasswordResetLink = adminMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, { creatorId }) => {
    const creator = await ctx.db.get(creatorId);
    if (!creator || creator.projectId !== ctx.projectId) {
      throw new ConvexError("Créateur introuvable.");
    }
    if (!creator.userId) {
      throw new ConvexError(
        "Ce créateur n'a pas encore finalisé son compte. Utilise « Régénérer l'invitation ».",
      );
    }
    const user = await ctx.db.get(creator.userId);
    if (!user) {
      throw new ConvexError("Compte de connexion introuvable.");
    }
    if (user.role === "superadmin") {
      throw new ConvexError(
        "Réinitialisation non autorisée pour un compte superadmin.",
      );
    }
    const account = await passwordAccountFor(ctx, creator.userId);
    if (account === null) {
      throw new ConvexError(
        "Ce compte n'a pas de mot de passe (connexion externe) — reset impossible.",
      );
    }

    // Un seul lien actif : on supprime les anciens tokens de ce user.
    const previous = await ctx.db
      .query("passwordResetTokens")
      .withIndex("by_user", (q) => q.eq("userId", creator.userId!))
      .collect();
    for (const t of previous) await ctx.db.delete(t._id);

    const now = Date.now();
    const expiresAt = now + RESET_TTL_MS;
    // Token long opaque (2× UUID v4, tirets retirés) — 244 bits d'entropie.
    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
    await ctx.db.insert("passwordResetTokens", {
      token,
      userId: creator.userId,
      projectId: ctx.projectId,
      expiresAt,
    });
    return { token, expiresAt };
  },
});

/**
 * PUBLIC (pré-session) — aperçu d'un token de reset pour la page
 * /reset-password/<token>. Retour discriminé SANS LEAK : token absent / utilisé
 * / expiré → même `{ status: "invalid" }`. Le cas valide ne révèle QUE le nom
 * du projet (branding), jamais l'email ni l'identité du compte.
 */
export const getPasswordResetPreview = publicQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const t = await ctx.db
      .query("passwordResetTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!t || t.usedAt !== undefined || t.expiresAt < Date.now()) {
      return { status: "invalid" as const };
    }
    const project = await ctx.db.get(t.projectId);
    return {
      status: "valid" as const,
      projectName: project?.name ?? null,
    };
  },
});

/**
 * INTERNAL — consommation ATOMIQUE du token (validation + marquage usedAt).
 * Appelée par l'action de reset AVANT le re-hash. Garantit l'usage unique : un
 * second appel voit usedAt posé → rejet. Re-vérifie superadmin (défense en
 * profondeur) et l'existence du compte mot de passe. Retourne le
 * providerAccountId EXACT (casse respectée) à passer à modifyAccountCredentials.
 */
export const consumePasswordResetToken = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const t = await ctx.db
      .query("passwordResetTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!t || t.usedAt !== undefined || t.expiresAt < Date.now()) {
      throw err(ERR.RESET_LINK_INVALID, "Lien de réinitialisation invalide ou expiré.");
    }
    const user = await ctx.db.get(t.userId);
    if (!user) {
      throw err(ERR.RESET_LINK_INVALID, "Lien de réinitialisation invalide ou expiré.");
    }
    if (user.role === "superadmin") {
      throw err(ERR.OPERATION_NOT_ALLOWED, "Opération non autorisée.");
    }
    const account = await passwordAccountFor(ctx, t.userId);
    if (account === null) {
      throw err(ERR.ACCOUNT_HAS_NO_PASSWORD, "Ce compte n'a pas de mot de passe.");
    }
    await ctx.db.patch(t._id, { usedAt: Date.now() });
    return {
      providerAccountId: account.providerAccountId,
      userId: t.userId,
    };
  },
});

/**
 * PUBLIC (action, pré-session) — applique le nouveau mot de passe. Le token est
 * la capacité (comme le signUp /join) : sans token valide, rien ne se passe.
 * Ordre : valider la longueur → consommer le token (atomique, usage unique) →
 * re-hash le secret → invalider les sessions. Redirection /login côté UI.
 */
export const resetPasswordWithToken = action({
  args: { token: v.string(), newPassword: v.string() },
  handler: async (ctx, { token, newPassword }): Promise<{ ok: true }> => {
    if (newPassword.length < 8) {
      throw err(ERR.PASSWORD_TOO_SHORT, "Le mot de passe doit faire au moins 8 caractères.");
    }
    const { providerAccountId, userId } = await ctx.runMutation(
      internal.passwordReset.consumePasswordResetToken,
      { token },
    );
    await modifyAccountCredentials(ctx, {
      provider: PASSWORD_PROVIDER,
      account: { id: providerAccountId, secret: newPassword },
    });
    await invalidateSessions(ctx, { userId });
    return { ok: true };
  },
});

// ─── Helper e2e (gated E2E_SECRET) ──────────────────────────────────────────

/**
 * Force l'expiration d'un token de reset par token (spec « lien expiré »).
 * Même pattern que creators.e2eExpireInvitation.
 */
export const e2eExpirePasswordResetToken = e2eMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const t = await ctx.db
      .query("passwordResetTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (t) await ctx.db.patch(t._id, { expiresAt: Date.now() - 1000 });
    return { expired: t !== null };
  },
});
