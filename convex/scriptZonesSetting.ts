/**
 * SCRIPT EN DEUX ZONES — est-il activé sur ce projet ?
 *
 * Module PUR (aucun import `_generated`) → importable côté client ET testable
 * depuis `lib/`, comme `convex/fileDrop.ts` et `convex/accountValidation.ts`.
 *
 * Activé : le script monté est rendu en deux zones de DESTINATION — 🎬 dans la
 * vidéo (hook + flux, chaque bloc avec son mode dire/afficher) et 📝 en
 * description (cta, à copier) — et l'éditeur de brique propose le mode.
 * Désactivé : un seul bloc « Vidéo à tourner ».
 *
 * POURQUOI CE MODULE EXISTE. Le choix se faisait par `slug === "snytch"`, côté
 * serveur (assignments.splitScriptZones) ET côté admin (éditeur + aperçu). Deux
 * copies de la décision, c'est un aperçu admin qui ne montre plus ce que verra
 * la créatrice le jour où l'une bouge sans l'autre. Les deux lisent donc ICI —
 * le serveur directement, l'admin via `projectForClient`, qui sert la décision
 * résolue. Garde : lib/script-zones-setting.test.ts.
 *
 * AFFICHAGE SEULEMENT : le texte figé de la mission (`assembledScript`) reste la
 * source de vérité et n'est jamais réécrit ; le découpage est recalculé à la
 * lecture. Basculer ce réglage change donc aussi l'affichage des missions déjà
 * attribuées — sans rien perdre, et dans les deux sens.
 */

/**
 * Slug du projet historiquement concerné. Déclaré ici (module PUR) ; son accord
 * avec `lib/snytch-drive.SNYTCH_SLUG` est verrouillé par le test.
 */
const LEGACY_SCRIPT_ZONES_SLUG = "snytch";

export interface ScriptZonesProject {
  slug: string;
  scriptZonesEnabled?: boolean;
}

/**
 * REPLI EXACT SUR L'EXISTANT : champ absent ⇒ Snytch en deux zones, tout autre
 * projet en bloc unique (0 migration). Le booléen posé l'emporte dans les deux
 * sens. Projet introuvable ⇒ bloc unique.
 */
export function isScriptZonesEnabled(
  project: ScriptZonesProject | null | undefined,
): boolean {
  if (project === null || project === undefined) return false;
  return project.scriptZonesEnabled ?? project.slug === LEGACY_SCRIPT_ZONES_SLUG;
}
