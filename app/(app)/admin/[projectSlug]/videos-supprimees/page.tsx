"use client";

import { DeletedVideosScreen } from "@/components/admin/DeletedVideosScreen";
import { PermissionGate } from "@/components/project/PermissionGate";
import type { PermissionId } from "@/convex/permissions";

const BLOC: PermissionId = "assignments.manage"; // i18n-exempt: identifiant de droit, pas un texte

/**
 * « Vidéos supprimées » (Production) — garde d'écran : assignments.manage, le
 * bloc qui permet de supprimer une mission. Le menu ne propose pas cette page à
 * qui ne l'a pas ; l'URL répond quand même, d'où l'enveloppe.
 *
 * ⚠️ Ce n'est PAS la barrière : le serveur refuse déjà chaque appel.
 */
export default function DeletedVideosPage() {
  return (
    <PermissionGate bloc={BLOC}>
      <DeletedVideosScreen />
    </PermissionGate>
  );
}
