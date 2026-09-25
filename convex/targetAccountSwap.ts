/**
 * CHANGER LE COMPTE d'une cible APRÈS l'assignation — la règle, en un seul
 * endroit, lue par la mutation (`setAssignmentTargetAccount`) ET par la query
 * qui construit le sélecteur (`listTargetAccountOptions`). Module PUR : aucun
 * accès base, testable sans Convex.
 *
 * `targets` était FIGÉ à la création (arbitrage B4). Il le reste pour tout ce
 * qui a déjà une existence publique : une cible publiée porte une URL, une
 * publication, des relevés de vues et une paie — tous rattachés au compte par
 * son HANDLE. Changer ce compte-là réécrirait l'historique ; c'est
 * `correctPublishedUrl` qui répare un post accroché au mauvais endroit.
 *
 * Tant que la cible n'est PAS publiée, le compte n'est qu'une consigne (« poste
 * ici ») : rien n'en dépend encore, on peut le changer autant que nécessaire.
 */

/**
 * Statuts où la vidéo est sortie : publiée, payée, et `validated` (legacy de
 * `published`, cf lib/assignment-status).
 */
const PUBLISHED_STATUSES = new Set(["published", "paid", "validated"]);

/**
 * Cible verrouillée ? Oui dès qu'elle porte un lien ou une publication, OU que
 * l'assignation est publiée/payée (lignes legacy dont la cible migrée n'a pas
 * toujours reçu son URL).
 */
export function isTargetAccountLocked(
  status: string,
  target: { publishedUrl?: string | null; publicationId?: unknown },
): boolean {
  if (PUBLISHED_STATUSES.has(status)) return true;
  return Boolean(target.publishedUrl) || target.publicationId != null;
}

/**
 * Pourquoi un compte ne peut PAS remplacer celui d'une cible (`null` = il peut).
 *
 *  - `unavailable` : même refus qu'à la création (`validateTargets` →
 *    `isAccountAvailable`) — en chauffe, non validé, shadowban.
 *  - `managedMismatch` : un compte géré par l'équipe ne remplace pas un compte
 *    de la créatrice, ni l'inverse. `managedByAdmin` est FIGÉ sur l'assignation
 *    et décide QUI publie (et le statut de départ) : le laisser diverger du
 *    compte ferait publier l'équipe sur le compte de la créatrice, ou l'inverse.
 */
export type TargetAccountRefusal = "unavailable" | "managedMismatch";

export function targetAccountRefusal(input: {
  available: boolean;
  accountManaged: boolean;
  assignmentManaged: boolean;
}): TargetAccountRefusal | null {
  if (!input.available) return "unavailable";
  if (input.accountManaged !== input.assignmentManaged) return "managedMismatch";
  return null;
}
