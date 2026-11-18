"use client";

import { Component, type ReactNode } from "react";

/**
 * Un bloc dont la query échoue ne doit pas emporter l'écran.
 *
 * Une query Convex en échec LÈVE pendant le rendu, et l'espace créatrice n'a pas
 * de page d'erreur : sans barrière, tout s'efface. Le 18/11/2026, la progression
 * de la créatrice aux 569 publications tombait vers 15,5 s (« too many system
 * operations »). Or l'overlay de célébration la lit sur TOUS les écrans, et la
 * carte des gains de l'accueil aussi. Elle ne pouvait plus rien ouvrir.
 *
 * À réserver à un bloc ACCESSOIRE de son écran, dont l'absence se lit comme
 * celle d'un bloc vide (pas de palier, pas de célébration). Jamais pour cacher le
 * chiffre qu'un écran est venu montrer : un montant manquant passerait pour un
 * montant nul. `repli` = ce que le bloc rendrait sans ses données.
 */
export class SansBlocSiEchec extends Component<
  { nom: string; repli?: ReactNode; children: ReactNode },
  { echec: boolean }
> {
  state = { echec: false };

  static getDerivedStateFromError(): { echec: boolean } {
    return { echec: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[${this.props.nom}]`, error);
  }

  render() {
    return this.state.echec ? (this.props.repli ?? null) : this.props.children;
  }
}
