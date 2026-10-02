import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Efface ce que Convex Auth garde d'un user, À APPELER AVANT `db.delete(userId)`.
 *
 * Supprimer la seule row `users` laisse `authAccounts` derrière elle : l'email
 * reste PRIS. Une réinvitation sur cet email échoue alors dans Convex Auth
 * (`createAccountFromCredentials` → « Account … already exists »), AVANT même
 * notre callback createOrUpdateUser — /join n'en montre que son message
 * générique. Cas réel du 02/10 : une créatrice supprimée puis recréée pour un
 * mot de passe oublié, bloquée à l'activation ; 32 comptes orphelins en prod.
 *
 * Emporte : sessions (+ refresh tokens), comptes de connexion (+ codes de
 * vérification, + compteur d'échecs de connexion, indexé par l'id du compte).
 */
export async function deleteAuthDataOfUser(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<{ sessions: number; accounts: number }> {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const s of sessions) await deleteSession(ctx, s._id);

  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .collect();
  for (const a of accounts) await deleteAccount(ctx, a._id);

  return { sessions: sessions.length, accounts: accounts.length };
}

export async function deleteSession(
  ctx: MutationCtx,
  sessionId: Id<"authSessions">,
): Promise<void> {
  const tokens = await ctx.db
    .query("authRefreshTokens")
    .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
    .collect();
  for (const t of tokens) await ctx.db.delete(t._id);
  await ctx.db.delete(sessionId);
}

export async function deleteAccount(
  ctx: MutationCtx,
  accountId: Id<"authAccounts">,
): Promise<void> {
  const codes = await ctx.db
    .query("authVerificationCodes")
    .withIndex("accountId", (q) => q.eq("accountId", accountId))
    .collect();
  for (const c of codes) await ctx.db.delete(c._id);
  const limits = await ctx.db
    .query("authRateLimits")
    .withIndex("identifier", (q) => q.eq("identifier", accountId))
    .collect();
  for (const l of limits) await ctx.db.delete(l._id);
  await ctx.db.delete(accountId);
}
