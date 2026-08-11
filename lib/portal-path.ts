import type { PortalRole } from "../convex/roles";

/**
 * Chemin du PORTAIL de chaque population — pendant front de `lib/project-path.ts`
 * (qui fait la même chose pour les routes admin scopées par slug).
 *
 * Table de décision UNIQUE de la redirection par rôle : `app/page.tsx` (résolveur
 * `/`), les layouts de portail (qui renvoient un rôle étranger chez lui) et
 * `ProjectProvider` (qui sort un non-admin de l'app interne) la lisent tous les
 * trois. Sans elle, la matrice de redirection se recopie à trois endroits et une
 * seule divergence envoie un talent sur le shell admin.
 */
export const PORTAL_PATH: Record<PortalRole, string> = {
  creator: "/app",
  talent: "/talent",
  clipper: "/clip",
};

/** Portail d'un rôle de membership, ou `null` si le rôle n'en ouvre aucun. */
export function portalPathForRole(role: string | null | undefined): string | null {
  if (role === "creator" || role === "talent" || role === "clipper") {
    return PORTAL_PATH[role];
  }
  return null;
}
