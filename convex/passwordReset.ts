import {
  e2eMutation,
  permissionMutation,
  publicMutation,
  publicQuery,
  requireCreatorInScope,
} from "./functions";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  modifyAccountCredentials,
  invalidateSessions,
} from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ERR, err } from "./errorCodes";
import { planResetRequest, RESET_EMAIL_TTL_MS } from "./passwordResetRequest";

/**
 * Reset mot de passe — un lien /reset-password/<token> à usage unique, par
 * DEUX portes :
 *   - Voie B (admin) : l'admin génère le lien depuis la fiche créateur et le
 *     transmet (WhatsApp). Valable 48 h.
 *   - Libre-service (requestPasswordReset) : « Mot de passe oublié ? » sur la
 *     page de connexion, le lien part par email (Resend). Valable 1 h.
 * Le créateur clique, choisit un nouveau mot de passe. Personne ne voit
 * JAMAIS de mot de passe en clair.
 *
 * Sécurité :
 *   - generatePasswordResetLink = gardée par bloc (droit creators.manage requis),
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

/** Compte mot de passe d'un email EXACT (providerAccountId), ou null. */
async function passwordAccountByEmail(ctx: QueryCtx | MutationCtx, email: string) {
  return await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) =>
      q.eq("provider", PASSWORD_PROVIDER).eq("providerAccountId", email),
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
export const generatePasswordResetLink = permissionMutation("creators.manage")({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, { creatorId }) => {
    const creator = await ctx.db.get(creatorId);
    if (!creator || creator.projectId !== ctx.projectId) {
      throw err(ERR.CREATOR_NOT_FOUND, "Créateur introuvable.");
    }
    // Un lien de reset donne la main sur le COMPTE de la créatrice : c'est le
    // geste le plus fort du bloc, il ne sort pas du périmètre.
    await requireCreatorInScope(ctx, ctx.userId, ctx.projectId, creator._id);
    if (!creator.userId) {
      throw err(ERR.ACCOUNT_NOT_FINALIZED, "Ce créateur n'a pas encore finalisé son compte. Utilise « Régénérer l'invitation ».");
    }
    const user = await ctx.db.get(creator.userId);
    if (!user) {
      throw err(ERR.LOGIN_ACCOUNT_NOT_FOUND, "Compte de connexion introuvable.");
    }
    if (user.role === "superadmin") {
      throw err(ERR.RESET_FORBIDDEN_SUPERADMIN, "Réinitialisation non autorisée pour un compte superadmin.");
    }
    const account = await passwordAccountFor(ctx, creator.userId);
    if (account === null) {
      throw err(ERR.ACCOUNT_HAS_NO_PASSWORD, "Ce compte n'a pas de mot de passe (connexion externe) — reset impossible.");
    }

    // Un seul lien actif : on supprime les anciens tokens de ce user.
    const previous = await ctx.db
      .query("passwordResetTokens")
      .withIndex("by_user", (q) => q.eq("userId", creator.userId!))
      .collect();
    for (const t of previous) await ctx.db.delete(t._id);

    const now = Date.now();
    const expiresAt = now + RESET_TTL_MS;
    const token = newResetToken();
    await ctx.db.insert("passwordResetTokens", {
      token,
      userId: creator.userId,
      projectId: ctx.projectId,
      expiresAt,
    });
    return { token, expiresAt };
  },
});

/** Token long opaque (2× UUID v4, tirets retirés) — 244 bits d'entropie. */
function newResetToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

/**
 * PUBLIC (pré-session) — « Mot de passe oublié ? ». Envoie un lien de reset à
 * l'email s'il a un compte mot de passe. Réponse IDENTIQUE dans tous les cas
 * (compte ou pas, superadmin, lien déjà parti il y a une minute) : la page ne
 * doit pas servir à tester quels emails sont inscrits. La règle est dans
 * passwordResetRequest.planResetRequest ; ici on ne fait que lire et écrire.
 *
 * Le nouveau lien remplace tout lien actif du même user, y compris un lien
 * généré par l'admin : un seul lien valide à la fois.
 */
export const requestPasswordReset = publicMutation({
  args: { email: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const typed = args.email.trim();
    if (typed.length === 0 || typed.length > 320) return { ok: true };
    // Les comptes créés par invitation portent l'email en minuscules
    // (inviteCreator) ; un compte bootstrap garde la casse saisie.
    let account = await passwordAccountByEmail(ctx, typed.toLowerCase());
    if (account === null && typed !== typed.toLowerCase()) {
      account = await passwordAccountByEmail(ctx, typed);
    }
    const user = account ? await ctx.db.get(account.userId) : null;

    let projectId: Id<"projects"> | null = null;
    let lastTokenCreatedAt: number | null = null;
    let previous: Doc<"passwordResetTokens">[] = [];
    if (user !== null) {
      const fiche = await ctx.db
        .query("creators")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();
      const membership = fiche
        ? null
        : await ctx.db
            .query("memberships")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .first();
      projectId = fiche?.projectId ?? membership?.projectId ?? null;
      previous = await ctx.db
        .query("passwordResetTokens")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      lastTokenCreatedAt = previous.reduce<number | null>(
        (max, t) => (max === null || t._creationTime > max ? t._creationTime : max),
        null,
      );
    }

    const now = Date.now();
    const plan = planResetRequest({ user, projectId, lastTokenCreatedAt, now });
    if (plan !== "send" || user === null || projectId === null) {
      return { ok: true };
    }

    for (const t of previous) await ctx.db.delete(t._id);
    const token = newResetToken();
    await ctx.db.insert("passwordResetTokens", {
      token,
      userId: user._id,
      projectId,
      expiresAt: now + RESET_EMAIL_TTL_MS,
    });
    // Hors transaction, comme tous les emails : un Resend en panne ne doit pas
    // faire échouer la demande (cf convex/emails.ts).
    await ctx.scheduler.runAfter(0, internal.emails.sendPasswordReset, {
      userId: user._id,
      token,
    });
    return { ok: true };
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

/**
 * Lit le dernier lien de reset d'un email (spec « mot de passe oublié ») : les
 * emails de test ne partent jamais (isNonNotifiableRecipient), la spec récupère
 * donc le lien ici. null = aucun lien.
 */
export const e2eLatestPasswordResetToken = e2eMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const account = await passwordAccountByEmail(ctx, email);
    if (account === null) return null;
    const tokens = await ctx.db
      .query("passwordResetTokens")
      .withIndex("by_user", (q) => q.eq("userId", account.userId))
      .collect();
    const last = tokens.sort((a, b) => b._creationTime - a._creationTime)[0];
    return last
      ? { token: last.token, ttlMs: last.expiresAt - last._creationTime, count: tokens.length }
      : null;
  },
});
