/**
 * Politique d'exploration : QUI a le droit de venir chercher QUOI.
 *
 * Elle vit ici, et pas dans `app/robots.ts`, pour être exécutable par un test :
 * le vitest du dépôt ne scanne que `lib/` et `scripts/`. La route de métadonnées
 * ne fait plus qu'habiller ces deux listes.
 *
 * SÉMANTIQUE, celle de Google et non celle du fichier lu de haut en bas : la
 * règle la PLUS LONGUE qui matche gagne, et `Allow` l'emporte à longueur égale.
 * C'est ce qui permet d'écrire « tout est fermé sauf ces quatre entrées » sans
 * dépendre de l'ordre des lignes.
 */

/** Suffixe `$` : ancre de fin d'URL (extension Google), pas un préfixe. */
export const ROBOTS_ALLOW = ["/$", "/_next/", "/landing/", "/s/"] as const;

/** Tout le reste. 67 des 72 routes sont dynamiques : les ouvrir, c'est payer. */
export const ROBOTS_DISALLOW = "/" as const;

/** Longueur du motif s'il matche le chemin, sinon -1 (pas de match). */
function matchLength(pattern: string, path: string): number {
  if (pattern.endsWith("$")) {
    const exact = pattern.slice(0, -1);
    return path === exact ? pattern.length : -1;
  }
  return path.startsWith(pattern) ? pattern.length : -1;
}

/**
 * Un robot qui respecte robots.txt ira-t-il chercher ce chemin ?
 *
 * Sert de contrat au test : on vérifie un COMPORTEMENT (ce chemin est ouvert,
 * celui-là non), pas la recopie des deux listes ci-dessus.
 */
export function isCrawlable(path: string): boolean {
  const allow = Math.max(...ROBOTS_ALLOW.map((p) => matchLength(p, path)));
  const deny = matchLength(ROBOTS_DISALLOW, path);
  if (allow < 0) return deny < 0;
  return allow >= deny;
}
