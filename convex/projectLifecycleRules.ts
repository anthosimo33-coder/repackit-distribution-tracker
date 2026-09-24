/**
 * RÈGLES PURES de l'édition et de la suppression d'un projet — sans import
 * serveur, pour être testées par Vitest (lib/project-lifecycle.test.ts) et
 * appliquées telles quelles par convex/projectLifecycle.ts.
 */

/** Longueur maximale d'un nom de projet (le switcher le tronque bien avant). */
export const PROJECT_NAME_MAX = 60;

/** Poids maximal d'un logo téléversé — un avatar de 28 px n'a pas besoin de plus. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Nom normalisé, ou `null` s'il est vide après nettoyage. */
export function normalizeProjectName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  return name === "" ? null : name;
}

/**
 * Couleur d'accent normalisée en `#rrggbb` minuscule, ou `null` si ce n'est pas
 * une couleur hexadécimale à 6 chiffres. La forme courte `#f52` est acceptée et
 * dépliée : c'est ce qu'on tape à la main.
 *
 * La couleur part telle quelle dans un `style` (pastille du switcher, variable
 * d'accent) : n'accepter QUE cette forme ferme la porte à toute valeur CSS
 * arbitraire.
 */
export function normalizeAccentColor(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  const long = /^#[0-9a-f]{6}$/;
  if (long.test(s)) return s;
  const court = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (court) return `#${court[1]}${court[1]}${court[2]}${court[2]}${court[3]}${court[3]}`;
  return null;
}

/** Le fichier téléversé est-il un logo acceptable ? Refus nommé, sinon `null`. */
export function logoRefusal(file: {
  contentType?: string | null;
  size: number;
}): "not_image" | "too_large" | null {
  if (!file.contentType || !file.contentType.startsWith("image/"))
    return "not_image";
  if (file.size > LOGO_MAX_BYTES) return "too_large";
  return null;
}

/**
 * La saisie de confirmation correspond-elle au nom du projet ? Comparaison
 * EXACTE aux espaces de bord près — pas d'insensibilité à la casse : taper le
 * nom tel qu'il s'affiche est précisément le geste qu'on demande.
 */
export function deletionConfirmed(projectName: string, typed: string): boolean {
  return typed.trim() === projectName.trim() && typed.trim() !== "";
}
