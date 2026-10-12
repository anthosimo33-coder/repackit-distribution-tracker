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

// ─── Adresse (slug) ──────────────────────────────────────────────────────────

/**
 * Segments top-level de l'app (`/admin`, `/app`, `/login`, `/s/<token>`…) et
 * segment statique `/admin/voir` : un projet qui porterait l'un de ces noms
 * serait masqué par la route du même nom, ou la masquerait.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "app",
  "login",
  "api",
  "p",
  "s",
  "join",
  "oauth",
  "reset-password",
  "accueil",
  "voir",
  "_next",
  "dashboard",
  // Portails talent / clippeur (segments top-level, cf lib/portal-path.ts).
  "talent",
  "clip",
]);

/**
 * Projets dont le CODE nomme le slug (REPACKIT_SLUG, SNYTCH_SLUG et les replis
 * `LEGACY_*_SLUG = "snytch"`) : changer leur adresse ferait basculer en silence
 * le dépôt Drive, la validation stricte des comptes, les zones de script et la
 * vitrine publique. Leur adresse reste figée.
 */
export const LOCKED_SLUGS: ReadonlySet<string> = new Set(["repackit", "snytch"]);

/** Le code dépend-il de l'adresse de ce projet ? */
export function isSlugLocked(slug: string): boolean {
  return LOCKED_SLUGS.has(slug);
}

/**
 * Adresse normalisée (minuscules, chiffres, tirets internes), ou `null` si la
 * saisie n'en est pas une. Pas de « réparation » silencieuse des espaces ou des
 * accents : l'adresse s'affiche telle quelle dans les liens, on la veut tapée.
 */
export function normalizeProjectSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase();
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug) ? slug : null;
}

/**
 * Anciennes adresses du projet après un changement `ancien → nouveau` :
 * l'ancienne y entre (ses liens déjà partagés doivent mener à la nouvelle), la
 * nouvelle en sort (revenir à une adresse passée la reprend), sans doublon.
 */
export function previousSlugsAfterChange(
  previous: readonly string[] | undefined,
  oldSlug: string,
  newSlug: string,
): string[] {
  const out = (previous ?? []).filter((s) => s !== newSlug && s !== oldSlug);
  return oldSlug === newSlug ? out : [...out, oldSlug];
}

/**
 * Le chemin courant, réécrit pour la nouvelle adresse du projet : seul le
 * PREMIER segment égal à l'ancienne adresse change (`/admin/<slug>/…`,
 * `/admin/voir/<slug>/…`, `/<slug>/login`). Un segment plus loin qui porterait
 * le même texte (un id, un onglet) n'est pas touché.
 */
export function pathWithSlug(
  pathname: string,
  oldSlug: string,
  newSlug: string,
): string {
  const segments = pathname.split("/");
  const i = segments.indexOf(oldSlug);
  if (i === -1) return pathname;
  segments[i] = newSlug;
  return segments.join("/");
}
