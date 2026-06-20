import { ConvexError, v } from "convex/values";
import {
  modifyAccountCredentials,
  invalidateSessions,
} from "@convex-dev/auth/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

/**
 * Récupération d'accès ADMIN — réservé aux internalQuery/Action/Mutation (jamais
 * exposé au client : aucun wrapper authed/public ici). Lancé manuellement via
 * `npx convex run` par un opérateur ayant accès au deployment. Tout est scopé
 * par EMAIL EXACT et refuse de toucher un compte superadmin (garde-fou).
 *
 * Contexte auth (Convex Auth, provider Password — cf convex/auth.ts) :
 *   - `users`         : 1 row par personne (email, role).
 *   - `authAccounts`  : 1 row (provider="password", providerAccountId=email,
 *                       secret=hash scrypt du mot de passe). C'EST là que vit le
 *                       mot de passe. Le réinitialiser = re-hasher un nouveau
 *                       secret sur CE row (modifyAccountCredentials).
 *   - `authSessions` / `authRefreshTokens` : sessions vivantes (invalidées au
 *                       reset pour forcer une reconnexion propre).
 *
 * Il n'existe PAS de flux "mot de passe oublié" par email (aucun service email).
 * La voie propre sans suppression est donc modifyAccountCredentials.
 */

const PASSWORD_PROVIDER = "password";

/**
 * DIAGNOSTIC (lecture seule) — à lancer EN PREMIER pour savoir quelle voie de
 * récupération s'applique. Ne modifie rien.
 *
 *   npx convex run adminRecovery:diagnoseAccountByEmail '{"email":"anthosimo33@gmail.com"}' --prod
 */
export const diagnoseAccountByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    if (user === null) {
      return {
        email,
        userExists: false as const,
        hint:
          "Aucun user pour cet email. Le compte n'a jamais finalisé son signup " +
          "→ voie (a) : (re)générer l'invitation du créateur (regenerateInvitation) " +
          "et finaliser via /join.",
      };
    }

    const passwordAccount = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", user._id).eq("provider", PASSWORD_PROVIDER),
      )
      .first();

    const creator = await ctx.db
      .query("creators")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    return {
      email,
      userExists: true as const,
      userId: user._id,
      role: user.role ?? "member",
      isSuperadmin: user.role === "superadmin",
      // providerAccountId EXACT (respecte la casse stockée) — c'est l'id à
      // passer au reset. null = pas de compte mot de passe (provider externe ?).
      passwordAccountId: passwordAccount?.providerAccountId ?? null,
      hasPasswordAccount: passwordAccount !== null,
      creatorStatus: creator?.status ?? null,
      membershipCount: memberships.length,
      hint:
        passwordAccount !== null
          ? "Compte mot de passe présent → voie (b) recommandée : " +
            "adminRecovery:resetTestPasswordByEmail (réinitialise le mot de passe)."
          : "User présent mais SANS compte mot de passe → reset impossible ; " +
            "utiliser deleteTestLoginByEmail puis (re)inviter.",
    };
  },
});

/**
 * RÉINITIALISATION du mot de passe (voie recommandée, AUCUNE suppression).
 * Re-hashe un nouveau mot de passe sur le compte `password` de cet email exact,
 * puis invalide les sessions en cours. Garde-fous : email exact, refus si le
 * compte est superadmin, refus si aucun compte mot de passe, mot de passe ≥ 8.
 *
 *   npx convex run adminRecovery:resetTestPasswordByEmail '{"email":"anthosimo33@gmail.com","newPassword":"<mdp-temporaire-8+>"}' --prod
 *
 * Ensuite : se connecter sur /login avec cet email + le nouveau mot de passe.
 */
export const resetTestPasswordByEmail = internalAction({
  args: { email: v.string(), newPassword: v.string() },
  handler: async (
    ctx,
    { email, newPassword },
  ): Promise<{ ok: boolean; email: string; message: string }> => {
    if (newPassword.length < 8) {
      throw new ConvexError("newPassword doit faire au moins 8 caractères.");
    }
    const diag = await ctx.runQuery(
      internal.adminRecovery.diagnoseAccountByEmail,
      { email },
    );
    if (!diag.userExists) {
      throw new ConvexError(
        `Aucun user pour « ${email} » — rien à réinitialiser. Voie (a) : (re)inviter.`,
      );
    }
    if (diag.isSuperadmin) {
      throw new ConvexError(
        `Refus : « ${email} » est superadmin. Réinitialisation de mot de passe non autorisée par ce script.`,
      );
    }
    if (diag.passwordAccountId === null) {
      throw new ConvexError(
        `« ${email} » n'a pas de compte mot de passe — reset impossible. ` +
          "Utiliser deleteTestLoginByEmail puis (re)inviter.",
      );
    }

    await modifyAccountCredentials(ctx, {
      provider: PASSWORD_PROVIDER,
      // providerAccountId EXACT lu en base (casse respectée).
      account: { id: diag.passwordAccountId, secret: newPassword },
    });
    // Tue les sessions/refresh tokens vivants → reconnexion propre obligatoire.
    await invalidateSessions(ctx, { userId: diag.userId });

    return {
      ok: true,
      email,
      message:
        "Mot de passe réinitialisé et sessions invalidées. Connecte-toi sur " +
        "/login avec ce nouveau mot de passe.",
    };
  },
});

/**
 * FALLBACK (suppression) — supprime UNIQUEMENT le login de cet email exact
 * (authAccounts + sessions + refresh tokens + memberships + user) et remet la
 * fiche créateur liée à l'état "invited" (userId retiré) pour pouvoir la
 * (re)inviter proprement. Garde-fous : email exact, refus superadmin. Ne touche
 * AUCUN autre compte, AUCUNE autre donnée métier (publications, comptes, etc.).
 *
 *   npx convex run adminRecovery:deleteTestLoginByEmail '{"email":"anthosimo33@gmail.com"}' --prod
 *
 * Puis : depuis l'admin du projet, régénérer l'invitation du créateur (bouton)
 * et finaliser via /join.
 */
export const deleteTestLoginByEmail = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (user === null) return { deleted: false, reason: "no_user" as const };
    if (user.role === "superadmin") {
      throw new ConvexError(
        `Refus : « ${email} » est superadmin. Suppression non autorisée.`,
      );
    }

    // Sessions + leurs refresh tokens.
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", user._id))
      .collect();
    for (const s of sessions) {
      const tokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const t of tokens) await ctx.db.delete(t._id);
      await ctx.db.delete(s._id);
    }

    // Comptes d'auth (tous providers de CE user — préfixe d'index sur userId).
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id))
      .collect();
    for (const a of accounts) await ctx.db.delete(a._id);

    // Memberships de CE user uniquement.
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);

    // Fiche créateur liée → rendue ré-invitable (status "invited", userId retiré).
    const creator: Doc<"creators"> | null = await ctx.db
      .query("creators")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (creator !== null) {
      await ctx.db.patch(creator._id, {
        userId: undefined,
        status: "invited",
      });
    }

    await ctx.db.delete(user._id);

    return {
      deleted: true as const,
      email,
      removedSessions: sessions.length,
      removedAccounts: accounts.length,
      removedMemberships: memberships.length,
      creatorResetToInvited: creator !== null,
    };
  },
});
