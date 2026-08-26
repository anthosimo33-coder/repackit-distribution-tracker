"use client";

import { createContext, useContext, useMemo } from "react";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Contexte du portail TALENT — porte le `projectId` résolu par la garde de rôle
 * du layout (`usePortalGate`), pour que l'écran ne le redemande pas.
 *
 * Pourquoi un contexte plutôt qu'un second `usePortalGate` dans la page : ce hook
 * ne fait pas que lire, il REDIRIGE (router.replace quand le rôle ne correspond
 * pas). L'appeler deux fois ferait partir deux redirections concurrentes pour une
 * seule décision. Le layout décide une fois, l'écran consomme.
 *
 * Volontairement minuscule : l'espace talent tient en un écran, il n'y a rien à
 * partager d'autre. Ce n'est pas un `CreatorProjectProvider` en réduction — le
 * talent n'a ni sélecteur de projet, ni navigation, ni mode « voir comme ».
 */

type TalentProjectValue = { projectId: Id<"projects"> };

const TalentProjectContext = createContext<TalentProjectValue | null>(null);

export function TalentProjectProvider({
  projectId,
  children,
}: {
  projectId: Id<"projects">;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ projectId }), [projectId]);
  return (
    <TalentProjectContext.Provider value={value}>
      {children}
    </TalentProjectContext.Provider>
  );
}

export function useTalentProject(): TalentProjectValue {
  const value = useContext(TalentProjectContext);
  if (value === null) {
    throw new Error(
      // i18n-exempt: erreur de DÉVELOPPEMENT (contrat de montage React), jamais rendue à un utilisateur
      "useTalentProject doit être appelé sous <TalentProjectProvider> (layout /talent).",
    );
  }
  return value;
}
