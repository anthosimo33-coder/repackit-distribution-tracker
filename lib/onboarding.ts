/**
 * SNYTCH — dérivation de l'état d'ONBOARDING d'une créatrice à partir d'un
 * payload serveur COMPACT (cf convex/comptes.getMyOnboardingState). Logique de
 * PRÉSENTATION pure et testable (vitest lib-only) : le serveur ne fait que
 * scoper + compacter les comptes (statut, warmup, bio) ; ici on en tire les
 * étapes de la checklist + le drapeau `complete`.
 *
 * Étapes trackées (décision fondateur : PAS de pdp, PAS de comparaison à
 * handlesToCreate) :
 *   1. déclarer un compte   → existence d'au moins un compte du créateur
 *   2. warmup               → en cours (checks < N) / terminé
 *   3. bio (si fournie)     → à appliquer / appliquée / non applicable
 *   4. validation admin     → compte passé "actif" (= gate strict Partie 1)
 *
 * `complete` = ONBOARDING TERMINÉ = compte "actif" (⇒ déclaré + warmup terminé +
 * validé admin) ET aucune bio en attente. Aligné sur le gate strict : "actif"
 * est la ligne d'arrivée qui débloque les scripts. Hors Snytch (applicable
 * false) → toujours `complete` (dashboard inchangé). Créatrice « full gérée »
 * (0 compte propre, l'équipe tient tout) → `complete` aussi : rien à configurer,
 * le dashboard montre un message dédié au lieu de la checklist.
 */

export type OnboardingPlatform = "TikTok" | "Instagram" | "YouTube";
export type OnboardingCompteStatus =
  | "warmup"
  | "actif"
  | "shadowban"
  | "archived";
export type OnboardingBio = "none" | "to_apply" | "applied";

export type OnboardingAccount = {
  id: string;
  handle: string;
  plateforme: OnboardingPlatform;
  status: OnboardingCompteStatus;
  checksDone: number;
  targetDays: number;
  warmupDone: boolean;
  dueToday: boolean;
  bio: OnboardingBio;
};

export type OnboardingServerState = {
  applicable: boolean;
  /** Comptes PROPRES de la créatrice uniquement (les comptes gérés par l'équipe
   *  sont exclus côté serveur — elle n'a rien à y configurer). */
  accounts: OnboardingAccount[];
  /** Créatrice « full gérée » : AUCUN compte propre + au moins un compte géré par
   *  l'équipe. Pas d'onboarding à faire → le dashboard affiche un message dédié au
   *  lieu de la checklist (cf DashboardScreen). false hors Snytch. */
  fullyManaged: boolean;
};

/**
 * État d'une étape de checklist :
 *   done       = fait (vert)
 *   in_progress= en cours, actionnable (ambre)
 *   todo       = à faire maintenant, actionnable (ambre/primary)
 *   pending    = en attente d'un tiers (validation admin) — non actionnable
 *   upcoming   = étape future pas encore atteinte (grisée)
 *   na         = non applicable (masquée)
 */
export type StepState =
  | "done"
  | "in_progress"
  | "todo"
  | "pending"
  | "upcoming"
  | "na";

export type OnboardingDerived = {
  applicable: boolean;
  /** Full gérée (0 compte propre + ≥1 géré) : pas de checklist, message dédié. */
  fullyManaged: boolean;
  hasDeclaredAccount: boolean;
  hasActiveAccount: boolean;
  bioApplicable: boolean;
  bioPending: boolean;
  /** Compte le plus avancé du parcours (narre l'onboarding). null si aucun. */
  best: OnboardingAccount | null;
  steps: {
    declare: StepState;
    warmup: StepState;
    bio: StepState;
    validation: StepState;
  };
  complete: boolean;
};

/** Avancement d'un compte dans le parcours (actif > warmup terminé > warmup). */
function progressRank(a: OnboardingAccount): number {
  if (a.status === "actif") return 4;
  if (a.status === "warmup") return a.warmupDone ? 3 : 2;
  return 0; // shadowban / archived — hors parcours
}

export function deriveOnboarding(
  state: OnboardingServerState,
): OnboardingDerived {
  const accounts = state.accounts;
  const hasDeclaredAccount = accounts.length > 0;
  const hasActiveAccount = accounts.some((a) => a.status === "actif");
  const bioApplicable = accounts.some((a) => a.bio !== "none");
  const bioPending = accounts.some((a) => a.bio === "to_apply");

  // "best" = compte le plus avancé PARMI ceux du parcours (warmup/actif). On
  // ignore shadowban/archived pour ne pas narrer l'onboarding autour d'un
  // compte grillé/archivé.
  const journey = accounts.filter(
    (a) => a.status === "warmup" || a.status === "actif",
  );
  const best =
    journey.length > 0
      ? journey.reduce((a, b) => (progressRank(b) > progressRank(a) ? b : a))
      : null;

  const declare: StepState = hasDeclaredAccount ? "done" : "todo";

  let warmup: StepState;
  if (!best) warmup = "upcoming";
  else if (best.status === "actif" || best.warmupDone) warmup = "done";
  else warmup = "in_progress";

  let validation: StepState;
  if (!best) validation = "upcoming";
  else if (best.status === "actif") validation = "done";
  else if (best.warmupDone) validation = "pending";
  else validation = "upcoming";

  const bio: StepState = !bioApplicable ? "na" : bioPending ? "todo" : "done";

  // Full gérée (aucun compte propre, l'équipe tient tout) : RIEN à onboarder →
  // complete (pas de checklist ; le dashboard affiche un message dédié). Même
  // principe d'exclusion que #107 (comptes gérés hors surfaces actionnables).
  const complete =
    state.applicable && !state.fullyManaged
      ? hasActiveAccount && !bioPending
      : true;

  return {
    applicable: state.applicable,
    fullyManaged: state.fullyManaged,
    hasDeclaredAccount,
    hasActiveAccount,
    bioApplicable,
    bioPending,
    best,
    steps: { declare, warmup, bio, validation },
    complete,
  };
}
