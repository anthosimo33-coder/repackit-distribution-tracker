/**
 * Assets — validation PURE des images (type + taille), testée Vitest. IMAGES
 * UNIQUEMENT (jpg/png/webp), pas de vidéo. Réutilisé côté client (uploader) et
 * RÉPLIQUÉ côté serveur (convex/assets.ts) — règle A6 (convex/ ne peut pas
 * importer lib/). Toute évolution ici doit l'être là-bas.
 */

export const ASSET_ACCEPTED_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/** Taille max par image (10 Mo) — léger, ce sont des images. */
export const ASSET_MAX_SIZE_BYTES = 10 * 1024 * 1024;

export function isAcceptedAssetType(contentType: string): boolean {
  return ASSET_ACCEPTED_TYPES.includes(contentType);
}

export interface AssetValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Valide un fichier image candidat : type accepté ET taille ≤ max. Renvoie un
 * message d'erreur lisible (FR) si invalide. Une vidéo (ou tout non-image) est
 * rejetée.
 */
export function validateAssetFile(file: {
  contentType: string;
  size: number;
}): AssetValidationResult {
  if (!isAcceptedAssetType(file.contentType)) {
    return { ok: false, error: "Format invalide. Images JPG, PNG ou WebP uniquement." };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: "Fichier vide ou taille invalide." };
  }
  if (file.size > ASSET_MAX_SIZE_BYTES) {
    return { ok: false, error: "Image trop lourde (10 Mo max)." };
  }
  return { ok: true };
}
