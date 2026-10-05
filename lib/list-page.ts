/**
 * Découpage d'une liste déjà filtrée et triée en PAGES — la vue Liste des
 * missions (787 lignes sur Snytch, ~70 000 nœuds DOM d'un bloc : ~0,9 s pour
 * l'afficher, ~0,5 s pour revenir à « tout » après une recherche).
 *
 * Pur : la page DEMANDÉE est ramenée dans les bornes ici, pas à l'écran. Une
 * suppression qui vide la dernière page, ou une écriture qui raccourcit la
 * liste, retombe sur la dernière page existante au lieu d'afficher une page
 * vide.
 */

/** Lignes par page. ~100 lignes ≈ 9 000 nœuds : un affichage sous 150 ms. */
export const LIST_PAGE_SIZE = 100;

export type ListPage<T> = {
  /** Les lignes de la page affichée. */
  items: T[];
  /** Page AFFICHÉE (0 = première), ramenée dans les bornes. */
  page: number;
  /** Nombre de pages — au moins 1, même pour une liste vide. */
  pageCount: number;
  /** Rang (à partir de 1) de la première ligne affichée ; 0 si vide. */
  from: number;
  /** Rang de la dernière ligne affichée ; 0 si vide. */
  to: number;
  total: number;
};

export function listPage<T>(
  rows: readonly T[],
  requestedPage: number,
  size: number = LIST_PAGE_SIZE,
): ListPage<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.min(
    Math.max(0, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0),
    pageCount - 1,
  );
  const start = page * size;
  const items = rows.slice(start, start + size);
  return {
    items,
    page,
    pageCount,
    from: items.length === 0 ? 0 : start + 1,
    to: start + items.length,
    total,
  };
}
