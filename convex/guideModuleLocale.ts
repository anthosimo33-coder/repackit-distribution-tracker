import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "./locales";

/**
 * QUEL JEU DE MODULES SERVIR — le cœur du guide « Comment ça marche » bilingue.
 *
 * Le contenu du guide est de la DONNÉE (table `guideModules`), pas des chaînes
 * extraites dans `messages/*.json` : la garde i18n ne peut donc rien en dire, et
 * un module ne peut pas être « à moitié traduit ». D'où le modèle retenu : UN
 * JEU DE MODULES PAR LANGUE (champ `locale`), choisi à la lecture, jamais des
 * champs bilingues par module. Deux jeux vivent côte à côte, chacun avec son
 * ordre, et l'admin en édite un sans jamais toucher à l'autre.
 *
 * REPLI TOUJOURS VERS LE FRANÇAIS, jamais l'inverse. Le français est le défaut
 * du produit : un lecteur anglais sans jeu anglais lit le français (avec un
 * bandeau qui le dit), un lecteur français ne se voit JAMAIS servir de l'anglais.
 *
 * Module PUR (aucune dépendance hors `convex/`, règle A6) : il est exécuté par
 * le runtime Convex et testé depuis `lib/guide-module-locale.test.ts`.
 */

/**
 * Langue d'un module. `locale` absente ⇒ français : c'est l'état des modules
 * écrits avant ce champ, et le défaut du produit. La valeur stockée n'est PAS
 * validée contre la liste des langues livrées (même parti pris que
 * `users.locale`, cf convex/i18n.ts) — une valeur inconnue retombe ici sur le
 * défaut plutôt que de casser une lecture.
 */
export function moduleLocale(m: { locale?: string }): Locale {
  return normalizeLocale(m.locale) ?? DEFAULT_LOCALE;
}

/**
 * Jeu servi à un lecteur, et la langue RÉELLEMENT servie.
 *
 * `servedLocale !== requested` est le seul signal du repli : c'est lui, et rien
 * d'autre, qui déclenche le bandeau côté écran. Il redevient faux tout seul dès
 * qu'un module existe dans la langue demandée — aucun drapeau à lever à la main
 * le jour où la traduction est écrite.
 *
 * Un jeu est réputé exister dès UN module : traduire le guide se fait module par
 * module, et un jeu partiel dans la bonne langue vaut mieux qu'un repli complet
 * dans l'autre.
 */
export function selectModulesForLocale<T extends { locale?: string }>(
  modules: readonly T[],
  requested: Locale,
): { modules: T[]; servedLocale: Locale } {
  const wanted = modules.filter((m) => moduleLocale(m) === requested);
  if (wanted.length > 0) return { modules: wanted, servedLocale: requested };
  // Repli : le jeu français. Si `requested` EST le français, c'est le même
  // filtre — un guide vide reste un guide vide, pas un repli.
  return {
    modules: modules.filter((m) => moduleLocale(m) === DEFAULT_LOCALE),
    servedLocale: DEFAULT_LOCALE,
  };
}
