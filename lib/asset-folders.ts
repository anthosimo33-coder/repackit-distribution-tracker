/**
 * Assets — résolution PURE des dossiers liés à un assignment, migration
 * single→array. `assetFolderIds` (nouveau, multi) prime ; sinon fallback sur le
 * legacy `assetFolderId` (single). Source de vérité de la lecture DUAL : un
 * assignment lié AVANT la migration (legacy single) reste résolu correctement.
 *
 * ⚠️ Règle A6 — RÉPLIQUÉ côté serveur (convex/assignments.ts
 * `effectiveAssetFolderIds`). Toute évolution ici doit l'être là-bas.
 */
export function resolveLinkedFolderIds(a: {
  assetFolderIds?: readonly string[];
  assetFolderId?: string | null;
}): string[] {
  if (a.assetFolderIds !== undefined) return [...a.assetFolderIds];
  return a.assetFolderId ? [a.assetFolderId] : [];
}
