/**
 * Deux valeurs SÉRIALISABLES ont-elles le même contenu ?
 *
 * Sert aux lignes mémoïsées d'une liste réactive Convex : chaque nouvelle
 * version d'une query arrive en objets NEUFS (JSON reparsé), y compris pour les
 * lignes qui n'ont pas bougé. Comparer les références re-rendrait toute la
 * liste à chaque écriture ; comparer le contenu ne re-rend que la ligne
 * modifiée.
 *
 * Valeurs JSON uniquement — ce que renvoie une query : ni `bigint`, ni `Date`,
 * ni fonction. Une clé absente et une clé `undefined` se valent, ce qui est
 * aussi ce que l'écran en affiche.
 */
export function sameContent(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
