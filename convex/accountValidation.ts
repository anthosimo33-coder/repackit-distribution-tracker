/**
 * VALIDATION DES COMPTES — règle de publication du projet.
 *
 * Module PUR (aucun import `_generated`) → importable côté client ET testable
 * depuis `lib/`, comme `convex/fileDrop.ts`.
 *
 * Deux régimes (cf convex/warmup.isAccountAvailable) :
 *   - "strict"  : un compte ne reçoit de mission et ne publie que s'il est
 *                 « actif », c'est-à-dire VALIDÉ par l'admin. Un warmup terminé
 *                 ne suffit pas.
 *   - "lenient" : un warmup terminé suffit.
 *
 * POURQUOI CE MODULE EXISTE. Le régime se choisissait par `slug === "snytch"`,
 * lu à SEPT endroits (attribution, liste des comptes disponibles, publication,
 * portail, onboarding). Un client ne pouvait pas choisir sa règle, et chaque
 * endroit portait sa propre copie de la décision.
 *
 * ⚠️ L'INVARIANT À PROTÉGER. « Un compte non validé ne publie rien » n'est vrai
 * que si l'attribution ET la publication lisent le MÊME régime. Tous les
 * appelants passent donc par `accountValidationModeOf` — un test
 * (lib/account-validation.test.ts) échoue si l'un d'eux recompare le slug.
 */

export type AccountValidationMode = "strict" | "lenient";

/**
 * Slug du projet historiquement strict. 4e déclaration du littéral (ce module
 * doit rester PUR) : son accord avec les trois autres est verrouillé par
 * lib/account-validation.test.ts, sur le patron de lib/file-drop.test.ts.
 */
const LEGACY_STRICT_SLUG = "snytch";

/** La forme minimale d'un projet dont dépend la décision. */
export interface AccountValidationProject {
  slug: string;
  accountValidation?: AccountValidationMode;
}

/**
 * Régime du projet.
 *
 * REPLI EXACT SUR L'EXISTANT : champ absent ⇒ Snytch strict, tout autre projet
 * souple — 0 migration, rien ne bouge en prod au déploiement. Le champ posé
 * l'emporte dans les deux sens. Projet introuvable ⇒ souple, comme l'ancien
 * `isSnytchProject` (qui répondait false).
 */
export function accountValidationModeOf(
  project: AccountValidationProject | null | undefined,
): AccountValidationMode {
  if (project === null || project === undefined) return "lenient";
  return (
    project.accountValidation ??
    (project.slug === LEGACY_STRICT_SLUG ? "strict" : "lenient")
  );
}

export function isStrictAccountValidation(
  project: AccountValidationProject | null | undefined,
): boolean {
  return accountValidationModeOf(project) === "strict";
}
