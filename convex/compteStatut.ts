/**
 * Statut EFFECTIF d'un compte — module PUR (aucun import serveur), partagé par
 * convex/comptes.ts (qui le ré-exporte), le Dashboard et l'outil MCP `dashboard`.
 */

export type CompteStatus = "warmup" | "actif" | "shadowban" | "archived";

// Coercion legacy → statut effectif. ⚠️ Dupliqué côté UI (lib/compte-status
// getEffectiveStatus) : un module Convex ne peut pas importer lib/ (cross-
// tsconfig, cf isFormatAllowedOnPlatform / normalizeSourceId). Toute évolution
// de cette règle doit être répliquée dans les deux fichiers. Rows sans `status`
// (pré-migrateComptesStatus) : actif === false → "archived", sinon "actif".
//
// EXPORTÉ (et non plus privé) pour que convex/notifications.ts s'en serve au
// lieu d'en écrire une TROISIÈME copie : la règle est déjà dédoublée par A6, une
// duplication de plus la rendrait ingérable.
export function effectiveStatus(c: {
  status?: CompteStatus;
  actif?: boolean;
}): CompteStatus {
  return c.status ?? (c.actif === false ? "archived" : "actif");
}
