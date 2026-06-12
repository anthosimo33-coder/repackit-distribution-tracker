import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError, type Value } from "convex/values";

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

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  jwt: jwtDurationMs ? { durationMs: jwtDurationMs } : undefined,
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

      // P4 — point de branchement invitations : valider args.profile
      // .inviteToken contre une future table invitations, puis insérer avec
      // role "member". Aucun token n'existe aujourd'hui → rejet systématique.
      throw new ConvexError(
        "Inscription fermée. Demande une invitation à un administrateur.",
      );
    },
  },
});
