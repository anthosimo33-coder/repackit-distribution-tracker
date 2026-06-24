/**
 * Admin « voir l'espace d'un créateur » (LECTURE SEULE) — helpers PURS de
 * construction de chemins. Le mode view-as RÉUTILISE les écrans du portail
 * créateur (mêmes composants) ; seul le base path des liens internes change :
 *   - créateur normal → "/app" ;
 *   - admin view-as   → viewAsBase(slug, creatorId) = "/admin/voir/<slug>/<id>".
 *
 * La route view-as vit sous "/admin/voir/…" (segment statique, sœur de
 * "/admin/[projectSlug]") : elle N'HÉRITE PAS du layout admin (sidebar interne),
 * ce qui permet de rendre le shell créateur (sa propre nav) avec le bandeau de
 * mode. Logique pure isolée ici (A6) → testée par lib/view-as.test.ts.
 */
export const VIEW_AS_ROOT = "/admin/voir";

/** Base path du mode view-as pour un projet (slug) + un créateur ciblé (id). */
export function viewAsBase(projectSlug: string, creatorId: string): string {
  return `${VIEW_AS_ROOT}/${projectSlug}/${creatorId}`;
}

/**
 * Href d'un écran portail à partir d'un base path et d'un sous-chemin portail.
 * Le sous-chemin est normalisé ; la racine ("" ou "/") renvoie le base nu (pas
 * de slash terminal → cohérent avec le matching d'onglet actif `=== base`).
 */
export function portalHref(base: string, sub: string): string {
  if (sub === "" || sub === "/") return base;
  const s = sub.startsWith("/") ? sub : `/${sub}`;
  return `${base}${s}`;
}
