"use client";

import { useSyncExternalStore } from "react";

/**
 * Point de rupture COMPACT partagé par l'onglet Assignments. Aligné sur le `md`
 * de Tailwind (48rem) : au-dessus, l'écran a la place d'une grille de mois
 * détaillée et d'un tableau à huit colonnes ; en dessous, il ne l'a pas.
 */
export const COMPACT_QUERY = "(max-width: 767px)";

const noopSubscribe = () => () => {};

/**
 * `matchMedia` branché sur React, en LECTURE.
 *
 * Pourquoi un hook et pas des classes `md:hidden` : les deux rendus de la vue
 * liste (tableau desktop / cartes mobile) sont des ARBRES DIFFÉRENTS, pas la
 * même chose habillée autrement. Les afficher tous les deux en cachant l'un par
 * CSS doublerait le rendu de ~480 lignes à chaque frappe de filtre, et
 * dupliquerait chaque libellé dans le DOM — ce qui casserait au passage les
 * sélecteurs e2e (« strict mode violation » sur un texte présent deux fois).
 *
 * `useSyncExternalStore` plutôt qu'un `useEffect` + `setState` : le snapshot
 * SERVEUR est explicite (`false` = on rend le desktop), donc pas d'écart
 * d'hydratation ni de `set-state-in-effect` à désactiver. Le premier paint mobile
 * est corrigé au commit suivant, avant que les données Convex ne soient là (la
 * page affiche un Skeleton pendant ce temps) : aucun saut visible.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      // Navigateur sans matchMedia (jsdom nu en test unitaire) : on ne s'abonne
      // à rien et on reste sur le rendu large.
      if (typeof window === "undefined" || !window.matchMedia) {
        return noopSubscribe();
      }
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(query).matches
        : false,
    () => false,
  );
}

/** Vrai sous le point de rupture compact (téléphone en portrait). */
export function useIsCompact(): boolean {
  return useMediaQuery(COMPACT_QUERY);
}
