"use client";

import { createContext, useContext, useMemo } from "react";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Contexte du portail CLIPPEUR — porte le `projectId` résolu par la garde de
 * rôle du layout (`usePortalGate`), pour que les écrans ne le redemandent pas.
 *
 * Calque de `TalentProjectProvider`, et pour la même raison : `usePortalGate` ne
 * fait pas que lire, il REDIRIGE. L'appeler dans chaque écran ferait partir
 * plusieurs redirections concurrentes pour une seule décision. Le layout décide
 * une fois, les écrans consomment.
 *
 * Deux écrans ici (l'espace et la fiche d'un clip), donc un contexte plutôt
 * qu'une prop : la fiche est une route à part, elle ne peut pas recevoir le
 * projectId de sa liste.
 */

type ClipperProjectValue = { projectId: Id<"projects"> };

const ClipperProjectContext = createContext<ClipperProjectValue | null>(null);

export function ClipperProjectProvider({
  projectId,
  children,
}: {
  projectId: Id<"projects">;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ projectId }), [projectId]);
  return (
    <ClipperProjectContext.Provider value={value}>
      {children}
    </ClipperProjectContext.Provider>
  );
}

export function useClipperProject(): ClipperProjectValue {
  const value = useContext(ClipperProjectContext);
  if (value === null) {
    throw new Error(
      // i18n-exempt: erreur de DÉVELOPPEMENT (contrat de montage React), jamais rendue à un utilisateur
      "useClipperProject doit être appelé sous <ClipperProjectProvider> (layout /clip).",
    );
  }
  return value;
}
