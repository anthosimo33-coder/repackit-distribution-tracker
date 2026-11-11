/**
 * CHANGER LE COMPTE d'une cible, ou AJOUTER une cible, APRÈS l'assignation — la
 * règle, en un seul endroit, lue par les mutations (`setAssignmentTargetAccount`,
 * `addAssignmentTarget`) ET par la query qui construit le sélecteur
 * (`listTargetAccountOptions`). Module PUR : aucun accès base, testable sans
 * Convex.
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

import { parisDayIndex } from "./calendarStatus";

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

/**
 * Peut-on AJOUTER une cible (une plateforme de plus) ? Tant que la vidéo n'est
 * pas sortie : la publication exige les liens de TOUTES les cibles d'un coup
 * (confirmPublicationCore), donc une cible ajoutée après ne serait jamais
 * publiée. Une assignation abandonnée (`cancelled`) ne sortira plus : rien à
 * ajouter non plus.
 */
export function canAddTarget(status: string): boolean {
  return !PUBLISHED_STATUSES.has(status) && status !== "cancelled";
}

/**
 * Peut-on ajouter une cible DÉJÀ PUBLIÉE — un compte ET le lien de son post —
 * à une vidéo SORTIE ? Le complément de `canAddTarget` : la créatrice a aussi
 * posté la vidéo sur un compte qu'on n'avait pas coché (Kelly, TikTok coché,
 * reel posté sur Instagram). La cible n'est pas une consigne mais un fait : elle
 * arrive avec son lien et sa publication, comme si elle avait été cochée.
 *
 * `paid` exclu : le montant de la vidéo est versé, une publication de plus
 * ajouterait des vues à un montant gelé.
 */
export function canAddPublishedTarget(status: string): boolean {
  return status === "published" || status === "validated";
}

/**
 * Date de publication d'une cible ajoutée APRÈS la sortie. Deux bornes :
 *  - `future` : une date à venir n'a pas pu être publiée ;
 *  - `beforeRelease` : un JOUR antérieur à la sortie de la vidéo. La date d'une
 *    vidéo EST la plus ancienne de ses cibles (`assignmentPublishedAt`) : elle
 *    la place dans son cycle de paie. Une cible plus ancienne déplacerait la
 *    vidéo dans un autre cycle, peut-être déjà payé.
 *
 * Le JOUR de la sortie, une heure antérieure est recalée sur la sortie au lieu
 * d'être refusée : l'admin choisit un jour (l'écran envoie midi), pas une
 * heure — un TikTok sorti à 18 h et un reel posté le même jour ne sont pas une
 * erreur de saisie. Jour de Paris, comme l'écran.
 */
export type PublishedTargetDateRefusal = "future" | "beforeRelease";

export function resolvePublishedTargetDate(
  at: number,
  bounds: { releasedAt: number; now: number },
): { at: number } | { refusal: PublishedTargetDateRefusal } {
  if (at > bounds.now) return { refusal: "future" };
  if (at >= bounds.releasedAt) return { at };
  if (parisDayIndex(at) === parisDayIndex(bounds.releasedAt)) {
    return { at: bounds.releasedAt };
  }
  return { refusal: "beforeRelease" };
}

/**
 * Pourquoi un compte ne peut PAS être AJOUTÉ comme cible (`null` = il peut).
 * Les refus du remplacement (`targetAccountRefusal`), plus :
 *  - `formatIncompatible` : le format de l'assignation ne se publie pas sur
 *    cette plateforme (même contrôle qu'à la création, `assignFormat`).
 * Un script que la créatrice a déjà sur cette plateforme n'est plus un refus :
 * depuis le 11/11/2026, un script peut revenir chez la même créatrice.
 */
export type TargetAddRefusal = TargetAccountRefusal | "formatIncompatible";

export function targetAddRefusal(input: {
  available: boolean;
  accountManaged: boolean;
  assignmentManaged: boolean;
  formatAllowed: boolean;
}): TargetAddRefusal | null {
  const base = targetAccountRefusal(input);
  if (base !== null) return base;
  if (!input.formatAllowed) return "formatIncompatible";
  return null;
}
