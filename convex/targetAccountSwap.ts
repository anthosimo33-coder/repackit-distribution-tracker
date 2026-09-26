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

import { COMBO_FREEING_STATUSES } from "./comboFreeing";

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
 * Le script de l'assignation est-il DÉJÀ pris par la créatrice sur `platform` ?
 *
 * Unicité à vie (combo × créatrice × plateforme) : ajouter une plateforme ne
 * doit pas faire reposter sur elle un script que la créatrice y a déjà (ou y
 * aura). Une assignation abandonnée ou refusée ne compte pas
 * (COMBO_FREEING_STATUSES).
 *
 * ⚠️ Une ligne à combo IMPOSÉ (rejeu, défi) COMPTE ici, alors que le tirage
 * (`usedComboKeysForPlatforms`) l'ignore : le tirage l'écarte pour ne pas
 * appauvrir la rotation, pas parce qu'un doublon serait acceptable — et cette
 * ligne va bel et bien publier ce script sur cette plateforme.
 *
 * L'appelant n'interroge PAS cette règle quand l'assignation elle-même est à
 * combo imposé : un rejeu est un doublon voulu, la création ne le contrôle pas
 * non plus.
 *
 * `sameCombo` = les assignations de la MÊME créatrice portant le MÊME comboKey
 * (index `by_creator_combo`). L'assignation elle-même est exclue.
 */
export function comboTakenOnPlatform(
  sameCombo: readonly {
    _id: string;
    status: string;
    targets?: readonly { platform: string }[];
  }[],
  input: { excludeId: string; platform: string },
): boolean {
  return sameCombo.some(
    (a) =>
      a._id !== input.excludeId &&
      !COMBO_FREEING_STATUSES.has(a.status) &&
      (a.targets ?? []).some((t) => t.platform === input.platform),
  );
}

/**
 * Pourquoi un compte ne peut PAS être AJOUTÉ comme cible (`null` = il peut).
 * Les refus du remplacement (`targetAccountRefusal`), plus :
 *  - `formatIncompatible` : le format de l'assignation ne se publie pas sur
 *    cette plateforme (même contrôle qu'à la création, `assignFormat`) ;
 *  - `comboUsed` : le script est déjà pris sur cette plateforme
 *    (`comboTakenOnPlatform`).
 */
export type TargetAddRefusal =
  | TargetAccountRefusal
  | "formatIncompatible"
  | "comboUsed";

export function targetAddRefusal(input: {
  available: boolean;
  accountManaged: boolean;
  assignmentManaged: boolean;
  formatAllowed: boolean;
  comboTaken: boolean;
}): TargetAddRefusal | null {
  const base = targetAccountRefusal(input);
  if (base !== null) return base;
  if (!input.formatAllowed) return "formatIncompatible";
  if (input.comboTaken) return "comboUsed";
  return null;
}
