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
