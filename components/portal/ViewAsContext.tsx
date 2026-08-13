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
