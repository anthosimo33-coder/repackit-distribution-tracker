"use client";

import { useSyncExternalStore } from "react";

/**
 * L'ÉCRAN EST-IL UN ÉCRAN D'ORDINATEUR ? — même seuil que la grille `lg:` (1024 px).
 *
 * Pourquoi un hook plutôt que `hidden lg:block` : l'accueil ne met pas les MÊMES
 * blocs aux mêmes endroits sur mobile et sur desktop. Les monter deux fois et en
 * cacher un doublerait leurs `data-testid` (`dashboard-due` existerait deux fois
 * dans la page) et leurs abonnements. On rend donc l'une OU l'autre disposition.
 *
 * Côté serveur, et au tout premier rendu, la réponse est « non » : le portail est
 * mobile d'abord.
 */
const QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
