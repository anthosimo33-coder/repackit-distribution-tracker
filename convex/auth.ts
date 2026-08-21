import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError, type Value } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { roleForKind } from "./roles";

/**
 * Remédiation sécurité — Convex Auth, provider Password (email + mot de
 * passe). Pas d'OAuth ni de magic link : outil interne, le mot de passe
 * suffit et n'exige aucun service email externe.
 *
 * Politique d'inscription (décision verrouillée) : signup FERMÉ par défaut.
 *   - Fenêtre bootstrap : si la table users est VIDE, le premier signup est
 *     accepté et devient superadmin. Permet d'initialiser chaque deployment
 *     (dev / test / prod) sans seed manuel.
 *   - Ensuite : création de comptes UNIQUEMENT par invitation (P4). Le
 *     paramètre `inviteToken` est déjà transmis par le provider (cf profile)
 *     mais aucun token n'existe encore → tout signup hors bootstrap est
 *     rejeté. P4 branchera la validation du token ici même.
 *
 * Le sign-IN d'un compte existant n'est jamais affecté (existingUserId set).
 */
// Durée de vie de l'access token (JWT). Défaut librairie = 1h, conservé en
// PROD (sécurisé). Surchargé via JWT_DURATION_MS UNIQUEMENT sur dev/test :
// défense en profondeur du fixture d'auth e2e (e2e/fixtures/auth-fixture.ts).
// Le fixture donne déjà à chaque test sa propre session ; un JWT long garantit
// en plus que le client ne déclenche AUCUN refresh pendant un test (donc aucune
// rotation de refresh token), éliminant les rares races d'auth résiduelles.
// Jamais défini en prod → 1h.
const jwtDurationMs = process.env.JWT_DURATION_MS
  ? Number(process.env.JWT_DURATION_MS)
  : undefined;

// « Rester connecté » 90 jours. Les créatrices ne viennent que quelques fois
// par semaine : une expiration à 30 j (défaut lib) les force à se reconnecter
// trop souvent. On porte à 90 j À LA FOIS la durée de vie ABSOLUE de la session
// (totalDurationMs) ET la fenêtre d'inactivité du refresh token
// (inactiveDurationMs) — les deux valent 30 j par défaut, la plus courte gagne.
//   • Convex Auth n'expose qu'une durée GLOBALE : pas de réglage par rôle → la
//     même durée s'applique au portail créateur ET à l'admin (constat mécanisme).
//   • Sécurité inchangée au-delà de la durée : le JWT d'accès reste court (1h
//     ci-dessus, jamais allongé en prod) → une révocation (suppression de la
//     session) reprend effet sous 1h ; les gardes serveur (authedQuery/Mutation,
//     rôles admin/créateur) sont contrôlées à CHAQUE requête, indépendamment de
//     la durée de session. signOut supprime session + refresh tokens (inchangé).
//   • Le cookie navigateur doit être rendu PERSISTANT en parallèle (proxy.ts,
//     cookieConfig.maxAge) — sinon c'est un cookie de session détruit à la
//     fermeture du navigateur, et 90 j côté serveur ne suffiraient pas.
const SESSION_DURATION_MS = 90 * 24 * 60 * 60 * 1000; // 90 jours

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  jwt: jwtDurationMs ? { durationMs: jwtDurationMs } : undefined,
  session: {
    totalDurationMs: SESSION_DURATION_MS,
    inactiveDurationMs: SESSION_DURATION_MS,
  },
  providers: [
    Password({
      profile(params) {
        const profile: Record<string, Value> & { email: string } = {
          email: params.email as string,
        };
        // P4 — transmis à createOrUpdateUser via profile, jamais stocké en
        // DB (l'insert ci-dessous ne reprend que email + role). Ajout
        // conditionnel : un Value ne peut pas contenir undefined explicite.
        if (typeof params.inviteToken === "string") {
          profile.inviteToken = params.inviteToken;
        }
        return profile;
      },
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      // Connexion d'un compte existant → no-op, on retourne l'utilisateur.
      if (args.existingUserId !== null) {
        return args.existingUserId;
      }

      const email = args.profile.email as string | undefined;

      // Fenêtre bootstrap : table users vide → premier compte = superadmin.
      const anyUser = await ctx.db.query("users").first();
      if (anyUser === null) {
        return await ctx.db.insert("users", {
          email,
          role: "superadmin",
        });
      }

      // P1 Créateurs — onboarding par lien d'invitation à token. Le token
      // arrive via profile.inviteToken (cf provider Password ci-dessus). Toute
      // la transaction (user + membership creator + liaison fiche + statut +
      // consommation du token) est atomique avec le signup : si une étape
      // échoue (ou le compte de connexion échoue ensuite), TOUT est rollback.
      const token = args.profile.inviteToken;
      if (typeof token !== "string" || token.length === 0) {
        throw new ConvexError(
          "Inscription fermée. Demande une invitation à un administrateur.",
        );
      }
      // Le ctx du callback Convex Auth est typé génériquement (ses index ne
      // connaissent pas le schéma applicatif) → on cast vers le db typé généré
      // pour interroger by_token et écrire dans nos tables.
      const db = ctx.db as unknown as MutationCtx["db"];
      const invitation = await db
        .query("invitations")
        .withIndex("by_token", (q) => q.eq("token", token))
        .first();
      const now = Date.now();
      // Message volontairement générique (no-leak) : invalide / utilisé /
      // expiré → même rejet, on ne révèle pas si le token a existé.
      if (
        !invitation ||
        invitation.usedAt !== undefined ||
        invitation.expiresAt < now
      ) {
        throw new ConvexError("Invitation invalide ou expirée.");
      }
      // L'email du formulaire est pré-rempli et non modifiable côté UI ; on le
      // re-vérifie serveur contre l'invitation (un appel forgé pourrait mentir).
      if (
        email === undefined ||
        email.toLowerCase() !== invitation.email.toLowerCase()
      ) {
        throw new ConvexError("Invitation invalide ou expirée.");
      }
      const creator = await db.get(invitation.creatorId);
      if (!creator || creator.status !== "invited") {
        throw new ConvexError("Invitation invalide ou expirée.");
      }

      // La langue de la fiche devient celle du COMPTE : `users.locale` fait foi
      // ensuite, et la lecture de repli sur `creators` (convex/i18n.getMyLocale)
      // n'a plus à s'exécuter à chaque rendu serveur. La fiche est déjà chargée
      // ci-dessus, c'est une recopie, pas une lecture de plus.
      const userId = await db.insert("users", {
        email,
        role: "member",
        locale: creator.locale,
      });
      // Le littéral de membership DÉRIVE de la population de la fiche
      // (creators.kind) — il n'est plus écrit en dur. La fiche est la source de
      // vérité : l'invitation ne porte aucun rôle, donc régénérer un lien ne peut
      // pas dériver du rôle réel. Fiche sans `kind` (toutes les existantes) →
      // "creator", soit exactement le comportement d'avant. Cf convex/roles.ts.
      await db.insert("memberships", {
        userId,
        projectId: invitation.projectId,
        role: roleForKind(creator.kind),
      });
      await db.patch(invitation.creatorId, {
        userId,
        status: "onboarding",
      });
      await db.patch(invitation._id, { usedAt: now });
      return userId;
    },
  },
});
