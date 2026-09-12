"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Admin « voir l'espace d'un créateur » (LECTURE SEULE) — contexte de MODE.
 *
 * Présent UNIQUEMENT sous la route view-as (/admin/voir/…). Absent du portail
 * créateur normal → useViewAs() y renvoie null, et les écrans réutilisés se
 * comportent EXACTEMENT comme avant (chemin créateur inchangé). En mode view-as,
 * il porte le créateur ciblé + le base path des liens internes, et signale aux
 * composants d'action qu'ils doivent se rendre en lecture seule (useReadOnly).
 */
export type ViewAsValue = {
  creatorId: Id<"creators">;
  creatorName: string;
  /** Population de la personne observée — le mode view-as ne sait rendre que
   *  le portail PARTENAIRE, et doit le dire au lieu de rendre autre chose. */
  creatorKind: "partner" | "talent" | "clipper";
  /** Base path des liens internes du portail en mode view-as (viewAsBase). */
  basePath: string;
  /**
   * L'OBSERVATEUR A-T-IL LE DROIT DE VOIR L'ARGENT DE LA PERSONNE OBSERVÉE ?
   * (`payments.manage` — cf lib/view-as-access et `requireCreatorMoneyObservable`)
   *
   * Il vit ICI, et pas dans un `usePermissions()` appelé par les écrans, pour une
   * raison mécanique : les écrans du portail sont PARTAGÉS avec la créatrice, et
   * chez elle il n'y a pas de `ProjectProvider` — `usePermissions()` y lèverait.
   * Le provider de l'observation, lui, est monté dessous : il résout la question
   * une fois et la passe en contexte. Hors observation, `useViewAs()` rend null
   * et la question ne se pose pas (une créatrice lit SES gains par `creatorQuery`).
   *
   * Toujours CONNU quand les enfants rendent : le provider attend les droits
   * comme il attend déjà la fiche (cf ViewAsProvider) — pas de fenêtre où une
   * query d'argent partirait à l'aveugle.
   */
  argent: boolean;
};

const ViewAsContext = createContext<ViewAsValue | null>(null);

export function ViewAsContextProvider({
  value,
  children,
}: {
  value: ViewAsValue;
  children: ReactNode;
}) {
  return (
    <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>
  );
}

/** Le mode view-as courant, ou null dans le portail créateur normal. */
export function useViewAs(): ViewAsValue | null {
  return useContext(ViewAsContext);
}

/**
 * true quand l'écran est rendu en LECTURE SEULE (admin view-as) → les composants
 * masquent/désactivent toute action mutatrice. Garde-fou UX : la vraie barrière
 * est serveur (les creatorMutation refusent un admin, qui n'a pas de membership
 * creator), et AUCUNE mutation n'est exposée par le chemin view-as.
 */
export function useReadOnly(): boolean {
  return useContext(ViewAsContext) !== null;
}

/** Base path des liens internes du portail : "/app" en normal, view-as base sinon. */
export function usePortalBase(): string {
  return useContext(ViewAsContext)?.basePath ?? "/app";
}
