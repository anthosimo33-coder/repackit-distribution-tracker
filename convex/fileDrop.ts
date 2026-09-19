/**
 * DÉPÔT DE FICHIERS — est-il ouvert sur ce projet ?
 *
 * Module PUR (aucun import `_generated`) → importable côté client ET testable
 * depuis `lib/`, comme `convex/roles.ts` et `convex/rushStatus.ts`.
 *
 * POURQUOI CE MODULE EXISTE. Le dépôt Drive était gaté par `slug === "snytch"`
 * en dur (4 comparaisons dans convex/snytchDrive.ts). Un talent ne dépose donc
 * rien hors de Snytch — y compris dans le projet de TEST, dont le slug est
 * `e2e-test` : sans champ de projet, aucune spec e2e du dépôt ne peut passer.
 * C'est la vraie raison de ce dégatage, avant même le confort d'exploitation.
 *
 * ⚠️ LE PIÈGE À NE PAS ÉLARGIR (risque 8 du diagnostic). Le MÊME slug commande
 * aussi le RÉGIME STRICT de disponibilité des comptes — `isAccountAvailable({
 * strict })`, appelé par `validateTargets` ET par `confirmPublicationCore`. En
 * strict, seul un compte VALIDÉ par l'admin peut être ciblé ou publié ; hors
 * Snytch, un warmup terminé mais non validé suffit. Ce module ne dégate QUE le
 * chemin Drive : `convex/projects.isSnytchProject` reste intouché partout
 * ailleurs. Ne jamais fusionner les deux gates — l'invariant « un compte non
 * validé ne peut rien publier » cesserait silencieusement d'être vrai.
 */

/**
 * Slug du projet historiquement seul concerné. Déclaré ICI plutôt qu'importé de
 * `convex/projects.ts` : ce module doit rester PUR (l'importer tirerait tout le
 * graphe `_generated` dans le bundle client). C'est donc la 3e occurrence du
 * littéral, avec les deux autres (`lib/snytch-drive.SNYTCH_SLUG`,
 * `convex/projects.SNYTCH_SLUG`) — leur accord est verrouillé par un test qui
 * importe les trois (lib/file-drop.test.ts), sur le patron de lib/warmup-mode.
 */
const LEGACY_FILE_DROP_SLUG = "snytch";

/** La forme minimale d'un projet dont dépend la décision. */
export interface FileDropProject {
  slug: string;
  fileDropEnabled?: boolean;
  driveRootFolderId?: string;
}

/**
 * Le dépôt de fichiers est-il ouvert sur ce projet ?
 *
 * REPLI EXACT SUR L'EXISTANT : champ absent ⇒ on retombe sur le comportement
 * d'avant (Snytch, et lui seul). Snytch reste donc ouvert sans qu'on ait rien à
 * poser en base, et tout autre projet reste fermé par défaut. Un booléen
 * explicite l'emporte dans les deux sens — y compris `false` sur Snytch, ce qui
 * est le seul moyen de couper le dépôt sans déployer.
 */
export function isFileDropEnabled(
  project: FileDropProject | null | undefined,
): boolean {
  if (project === null || project === undefined) return false;
  return project.fileDropEnabled ?? project.slug === LEGACY_FILE_DROP_SLUG;
}

/**
 * DOSSIER RACINE Drive de CE projet — celui sous lequel sont créés les dossiers
 * de ses créatrices. null ⇒ aucun dossier ne peut être créé (dépôt non
 * configuré), et c'est voulu : il n'y a PAS de racine par défaut.
 *
 * POURQUOI. La racine était une variable d'env UNIQUE (`SNYTCH_DRIVE_ROOT_FOLDER_ID`)
 * lue pour tout projet. Ouvrir le dépôt ailleurs (interrupteur Rushes →
 * Réglages) créait donc les dossiers de SES créatrices dans le Drive de Snytch —
 * des fichiers livrés au mauvais client, et irrécupérables côté app une fois le
 * binaire parti.
 *
 * REPLI EXACT SUR L'EXISTANT : champ absent ⇒ Snytch garde la variable d'env
 * (0 migration), tout autre projet n'a PAS de racine. Le champ posé l'emporte,
 * y compris sur Snytch.
 *
 * `legacyEnvRoot` est passé par l'appelant (valeur de l'env) : ce module reste
 * pur et testable.
 */
export function resolveDriveRootFolder(
  project: FileDropProject | null | undefined,
  legacyEnvRoot: string | undefined,
): string | null {
  if (project === null || project === undefined) return null;
  const own = project.driveRootFolderId?.trim();
  if (own) return own;
  if (project.slug !== LEGACY_FILE_DROP_SLUG) return null;
  const legacy = legacyEnvRoot?.trim();
  return legacy ? legacy : null;
}

/** Forme d'un identifiant de dossier Drive (lettres, chiffres, `-`, `_`). */
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * Identifiant de dossier Drive à partir de ce qu'un admin colle : l'id nu, ou
 * l'URL du dossier telle que l'affiche Google Drive
 * (`https://drive.google.com/drive/folders/<id>?usp=…`, y compris `/u/0/`).
 * null ⇒ saisie illisible — l'appelant REFUSE plutôt que de stocker n'importe quoi.
 */
export function parseDriveFolderId(input: string): string | null {
  const raw = input.trim();
  if (raw.length === 0) return null;
  const fromUrl = raw.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1];
  const candidate = fromUrl ?? raw;
  return DRIVE_ID.test(candidate) ? candidate : null;
}
