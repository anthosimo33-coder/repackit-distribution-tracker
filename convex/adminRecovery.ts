import { ConvexError, v } from "convex/values";
import {
  createAccount,
  modifyAccountCredentials,
  invalidateSessions,
} from "@convex-dev/auth/server";
import type { WithoutSystemFields } from "convex/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  deleteAccount,
  deleteAuthDataOfUser,
  deleteSession,
} from "./authCleanup";

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
      // Un compte de connexion SANS user = login fantôme laissé par une
      // suppression d'avant le correctif : il bloque toute (ré)invitation.
      const orphanAccount = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", PASSWORD_PROVIDER).eq("providerAccountId", email),
        )
        .first();
      return {
        email,
        userExists: false as const,
        orphanPasswordAccount: orphanAccount !== null,
        hint:
          orphanAccount !== null
            ? "Login fantôme (authAccounts sans user) : l'email est bloqué, " +
              "toute invitation échouera → adminRecovery:purgeOrphanAuth d'abord."
            : "Aucun user pour cet email. Le compte n'a jamais finalisé son signup " +
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

    // Sessions (+ refresh tokens) et comptes d'auth de CE user.
    const removed = await deleteAuthDataOfUser(ctx, user._id);

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
      removedSessions: removed.sessions,
      removedAccounts: removed.accounts,
      removedMemberships: memberships.length,
      creatorResetToInvited: creator !== null,
    };
  },
});

/**
 * PURGE des logins FANTÔMES — comptes de connexion et sessions dont le user a
 * été supprimé. Jusqu'au 02/10, deleteCreator et la suppression de projet ne
 * retiraient que la row `users` : l'email restait pris et toute réinvitation
 * échouait (« Account … already exists »). Un compte sans user ne peut plus
 * rien ouvrir : le retirer ne coupe l'accès de personne. Idempotent.
 *
 *   ./scripts/convex-prod.sh run adminRecovery:purgeOrphanAuth '{"dryRun":true}'
 */
export const purgeOrphanAuth = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    const accounts = await ctx.db.query("authAccounts").collect();
    const orphanAccounts: Doc<"authAccounts">[] = [];
    for (const a of accounts) {
      if ((await ctx.db.get(a.userId)) === null) orphanAccounts.push(a);
    }
    const sessions = await ctx.db.query("authSessions").collect();
    const orphanSessions: Doc<"authSessions">[] = [];
    for (const s of sessions) {
      if ((await ctx.db.get(s.userId)) === null) orphanSessions.push(s);
    }
    if (!dryRun) {
      for (const a of orphanAccounts) await deleteAccount(ctx, a._id);
      for (const s of orphanSessions) await deleteSession(ctx, s._id);
    }
    return {
      dryRun,
      orphanAccounts: orphanAccounts.length,
      orphanSessions: orphanSessions.length,
      emails: orphanAccounts.map((a) => a.providerAccountId).sort(),
    };
  },
});

/** Invitation encore utilisable pour cet email (lecture seule). */
export const pendingInvitationByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    // Même normalisation que inviteCreator : c'est sous cette forme que
    // l'invitation, puis le compte de connexion, portent l'email.
    const email = args.email.trim().toLowerCase();
    const now = Date.now();
    const invitations = (await ctx.db.query("invitations").collect()).filter(
      (i) =>
        i.email.toLowerCase() === email.toLowerCase() &&
        i.usedAt === undefined &&
        i.expiresAt > now,
    );
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", PASSWORD_PROVIDER).eq("providerAccountId", email),
      )
      .first();
    return {
      invitations: invitations.map((i) => ({
        email: i.email,
        token: i.token,
        projectId: i.projectId,
        creatorId: i.creatorId,
      })),
      hasPasswordAccount: account !== null,
    };
  },
});

/**
 * ACTIVE une invitation À LA PLACE de la créatrice, avec un mot de passe
 * choisi par l'admin (elle n'a plus qu'à se connecter). Passe par le MÊME
 * chemin que /join : createAccount → callback createOrUpdateUser, qui vérifie
 * l'invitation, crée user + membership, lie la fiche et consomme le token.
 * Refuse si l'email a déjà un compte de connexion (fantôme compris) ou si
 * plusieurs invitations valides existent (projets différents).
 *
 *   ./scripts/convex-prod.sh run adminRecovery:activateInvitationByEmail '{"email":"…","password":"<8+>"}'
 */
export const activateInvitationByEmail = internalAction({
  args: { email: v.string(), password: v.string() },
  handler: async (
    ctx,
    { email, password },
  ): Promise<{ ok: true; email: string; userId: string }> => {
    if (password.length < 8) {
      throw new ConvexError("password doit faire au moins 8 caractères.");
    }
    const found = await ctx.runQuery(
      internal.adminRecovery.pendingInvitationByEmail,
      { email },
    );
    if (found.hasPasswordAccount) {
      throw new ConvexError(
        `« ${email} » a déjà un compte de connexion → diagnoseAccountByEmail ` +
          "(fantôme : purgeOrphanAuth ; compte vivant : resetTestPasswordByEmail).",
      );
    }
    if (found.invitations.length !== 1) {
      throw new ConvexError(
        `${found.invitations.length} invitation(s) valide(s) pour « ${email} » — il en faut exactement une.`,
      );
    }
    const invitation = found.invitations[0];
    const { user } = await createAccount(ctx, {
      provider: PASSWORD_PROVIDER,
      // Email EXACT de l'invitation : c'est lui que /join envoie (preview.email).
      account: { id: invitation.email, secret: password },
      // inviteToken n'est pas un champ de `users` : il ne fait que transiter
      // jusqu'au callback createOrUpdateUser (cf profile() dans convex/auth.ts).
      profile: {
        email: invitation.email,
        inviteToken: invitation.token,
      } as unknown as WithoutSystemFields<Doc<"users">>,
    });
    return { ok: true, email: invitation.email, userId: user._id };
  },
});
