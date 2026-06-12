/**
 * P3 Multi-tenant — l'app interne vit sous `/admin/[projectSlug]/…`. Toute
 * navigation interne est préfixée par le slug du projet actif (dérivé de l'URL,
 * source de vérité). Ce helper centralise la construction du préfixe pour ne
 * pas disperser des littéraux `/admin/${slug}` dans le code.
 *
 * `path` doit commencer par "/" (ex: "/carrousels", "/comptes?view=icps") ou
 * être omis pour viser la base du projet.
 */
export function projectPath(slug: string, path = ""): string {
  return `/admin/${slug}${path}`;
}
