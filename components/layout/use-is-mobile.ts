"use client";

import { useSyncExternalStore } from "react";

/**
 * L'ÉCRAN EST-IL UN TÉLÉPHONE ? — même seuil que `md:` (768 px).
 *
 * Sert aux listes de l'espace d'équipe qui passent de TABLEAU (≥ md) à CARTES
 * (< md). Pourquoi un hook plutôt que `hidden md:block` + `md:hidden` : les deux
 * dispositions montées en même temps doubleraient chaque texte de la page — un
 * handle, un nom de créatrice existeraient deux fois — et les specs qui les
 * cherchent (`getByText`, `row.getByText`) tomberaient en violation de mode
 * strict, même sur la copie cachée. On rend l'une OU l'autre.
 *
 * Réponse côté serveur et au premier rendu : « non » — l'espace d'équipe est
 * d'abord un outil de bureau, et c'est le tableau que la suite e2e (Desktop
 * Chrome) doit trouver sans attendre. Cf. son pendant `use-is-desktop` du
 * portail créatrice, mobile d'abord.
 */
const QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
