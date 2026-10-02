/**
 * « Mot de passe oublié » en libre-service — la DÉCISION, sans I/O.
 *
 * La mutation publique (passwordReset.requestPasswordReset) lit les faits et
 * applique le plan ; la règle vit ici pour être testée (lib/
 * password-reset-request.test.ts). Quoi qu'il arrive, la réponse au visiteur est
 * la MÊME : il ne doit pas pouvoir apprendre qu'un email a un compte.
 */

/** Validité d'un lien ENVOYÉ PAR EMAIL. Plus court que le lien admin (48 h,
 *  transmis à la main) : une boîte mail se fait relire, une conversation moins. */
export const RESET_EMAIL_TTL_MS = 60 * 60 * 1000;

/** Délai minimal entre deux liens pour un même compte : sans lui, quiconque
 *  connaît un email peut en remplir la boîte en cliquant. */
export const RESET_EMAIL_COOLDOWN_MS = 2 * 60 * 1000;

export type ResetRequestFacts = {
  /** User derrière le compte mot de passe de cet email ; null = aucun compte. */
  user: { role?: string } | null;
  /** Projet qui porte le lien (fiche créatrice, sinon membership) ; null = aucun. */
  projectId: string | null;
  /** Création du dernier lien de ce user, quelle que soit sa source. */
  lastTokenCreatedAt: number | null;
  now: number;
};

export type ResetRequestPlan = "send" | "throttled" | "ignore";

export function planResetRequest(f: ResetRequestFacts): ResetRequestPlan {
  if (f.user === null) return "ignore";
  // Même refus que le lien admin (generatePasswordResetLink) et la
  // consommation du token : un superadmin ne se réinitialise pas par ce biais.
  if (f.user.role === "superadmin") return "ignore";
  if (f.projectId === null) return "ignore";
  if (
    f.lastTokenCreatedAt !== null &&
    f.now - f.lastTokenCreatedAt < RESET_EMAIL_COOLDOWN_MS
  ) {
    return "throttled";
  }
  return "send";
}
