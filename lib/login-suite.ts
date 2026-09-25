/**
 * RETOUR APRÈS CONNEXION — la page où renvoyer une personne qui a dû se
 * connecter en chemin.
 *
 * Un seul cas aujourd'hui : la page de consentement OAuth (`/oauth/authorize`),
 * où Claude envoie la personne pour autoriser le connecteur. Sans retour, elle
 * se connecterait puis atterrirait sur son tableau de bord, et la connexion
 * lancée depuis Claude resterait en plan.
 *
 * LISTE FERMÉE, PAS « TOUT CHEMIN RELATIF ». Un paramètre de retour générique
 * est une redirection ouverte en puissance (`//evil.com`, `/\evil.com`, un
 * chemin encodé…). N'accepter que le chemin EXACT de la page de consentement,
 * suivi de sa query, ferme la question plutôt que de la filtrer.
 */

export const SUITE_PARAM = "suite";

const PAGE_CONSENTEMENT = "/oauth/authorize";

/** Le retour demandé, s'il est permis ; sinon `null` (→ destination habituelle). */
export function suiteApresConnexion(brut: string | null | undefined): string | null {
  if (!brut || !brut.startsWith(PAGE_CONSENTEMENT)) return null;
  const reste = brut.slice(PAGE_CONSENTEMENT.length);
  if (reste !== "" && !reste.startsWith("?")) return null;
  // Rien dans la query ne peut changer d'origine, mais un antislash ou un saut de
  // ligne n'a rien à y faire : on refuse plutôt que d'interpréter.
  if (/[\\\r\n]/.test(brut)) return null;
  return brut;
}

/** `/login?suite=…` pour une page qui exige une session. */
export function loginAvecSuite(cheminEtQuery: string): string {
  const suite = suiteApresConnexion(cheminEtQuery);
  return suite ? `/login?${new URLSearchParams({ [SUITE_PARAM]: suite })}` : "/login";
}
