"use client";

import { PermissionGate } from "@/components/project/PermissionGate";
import { ComptaPage } from "@/components/compta/ComptaPage";

/**
 * Onglet Compta — garde d'écran `business.read` (le compte d'exploitation).
 * Ce n'est PAS la barrière : chaque fonction de convex/compta.ts la porte déjà.
 */
export default function ComptaRoute() {
  return (
    // i18n-exempt: identifiant technique du bloc de droits, pas du texte
    <PermissionGate bloc="business.read">
      <ComptaPage />
    </PermissionGate>
  );
}
