import { teamLocaleOf, type Locale } from "./locales";

/**
 * CATALOGUES — le socle, plus l'espace d'équipe découpé par zone.
 *
 * `messages/<langue>.json` porte tout ce qu'une créatrice lit (portails,
 * pré-session, e-mails côté client). L'espace d'équipe (`/admin/...`), traduit
 * depuis septembre 2026, vit sous `messages/admin/<langue>/<zone>.json` et se
 * lit `t("admin.<zone>.…")`.
 *
 * POURQUOI DES FICHIERS PAR ZONE. ~4 000 libellés d'équipe dans le fichier du
 * socle l'auraient quadruplé, et chaque PR de traduction aurait ajouté ses clés
 * au même endroit que la précédente : un conflit garanti par lot. Une zone = un
 * fichier = une PR qui ne touche que lui.
 *
 * ⚠️ AJOUTER UNE ZONE = trois endroits : la liste ci-dessous, les deux dossiers
 * de langue, et le type de `global.d.ts`. `scripts/check-i18n.mjs` refuse un
 * dossier qui ne contient pas exactement ces fichiers.
 */
export const ADMIN_AREAS = [
  "common",
  "dashboard",
  "analytics",
  "validation",
  "assignments",
  "challenges",
  "creators",
  "accounts",
  "scripts",
  "library",
  "money",
  "ops",
  "legacy",
  "viewAs",
  "errors",
] as const;

export type AdminArea = (typeof ADMIN_AREAS)[number];

/** Le socle seul : ce qu'un portail créatrice a besoin d'envoyer au navigateur. */
export async function loadBaseMessages(locale: Locale) {
  return (await import(`../messages/${locale}.json`)).default;
}

/**
 * Le socle + l'espace d'équipe. L'espace d'équipe n'existe qu'en FR/EN : une
 * langue créatrice seule (`es`, `pt`) le reçoit en anglais (`teamLocaleOf`).
 */
export async function loadMessages(locale: Locale) {
  const base = await loadBaseMessages(locale);
  const team = teamLocaleOf(locale);
  const entries = await Promise.all(
    ADMIN_AREAS.map(
      async (area) =>
        [area, (await import(`../messages/admin/${team}/${area}.json`)).default] as const,
    ),
  );
  return { ...base, admin: Object.fromEntries(entries) };
}

/**
 * Retire l'espace d'équipe d'un jeu de messages : le layout racine l'envoie à
 * TOUS les navigateurs, créatrices comprises, qui n'en lisent pas une ligne.
 * Le layout `/admin` remonte le jeu complet (cf app/admin/layout.tsx).
 */
// i18n-exempt: générique TypeScript (`> = Omit<`), pas du texte
type WithoutAdmin<T> = Omit<T, "admin">;

export function withoutAdmin<T extends object>(
  messages: T,
): WithoutAdmin<T> {
  const rest: T & { admin?: unknown } = { ...messages };
  delete rest.admin;
  return rest;
}
