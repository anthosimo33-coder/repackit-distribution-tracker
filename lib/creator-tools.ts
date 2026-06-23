/**
 * Outils du portail créateur — config FIGÉE EN CODE, par slug de projet.
 *
 * Distinct de `project.sidebarLinks` (DB, configuré côté admin) : le portail
 * créateur fige ses outils ici, indépendamment du branding admin (HORS SCOPE :
 * gestion des outils depuis l'admin). Étendre = ajouter une entrée à la map.
 *
 * Un slug absent de la map (ex. e2e-test) → aucun outil → pas de section/onglet
 * « Outils » affiché pour ce projet (la nav ne montre jamais de section vide).
 *
 * `icon` est une clé résolue via resolveSidebarLinkIcon (lib/sidebar-link-icon),
 * comme les sidebarLinks admin — même rendu, mêmes icônes curatées.
 */
export type CreatorTool = {
  label: string;
  url: string;
  icon?: string;
};

// Sous-titres : outil commun à Snytch et RepackIt (même éditeur).
const SUBTITLES: CreatorTool = {
  label: "Sous-titres",
  url: "https://sous-titre-editeur.vercel.app/",
  icon: "subtitles",
};

const TOOLS_BY_SLUG: Record<string, readonly CreatorTool[]> = {
  snytch: [
    SUBTITLES,
    {
      label: "Carrousel Studio",
      url: "https://carrouselstudio.vercel.app/",
      icon: "carousel",
    },
  ],
  repackit: [SUBTITLES],
};

/**
 * Outils du projet `slug` (liste vide si le projet n'en a pas). Liste en lecture
 * seule : la config est figée, jamais mutée à l'exécution.
 */
export function getCreatorTools(slug: string): readonly CreatorTool[] {
  return TOOLS_BY_SLUG[slug] ?? [];
}
