/**
 * Assets — validation PURE des fichiers (type + taille), testée Vitest. IMAGES
 * (jpg/png/webp, ≤ 10 Mo) ET VIDÉOS courtes (mp4/mov/webm, ≤ 100 Mo). Réutilisé
 * côté client (uploader) et RÉPLIQUÉ côté serveur (convex/assets.ts) — règle A6
 * (convex/ ne peut pas importer lib/). Toute évolution ici doit l'être là-bas.
 */

export const ASSET_IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export const ASSET_VIDEO_TYPES: readonly string[] = [
  "video/mp4",
  "video/quicktime", // .mov
  "video/webm",
];

/** Tous les types acceptés (images + vidéos). */
export const ASSET_ACCEPTED_TYPES: readonly string[] = [
  ...ASSET_IMAGE_TYPES,
  ...ASSET_VIDEO_TYPES,
];

/** Limites de taille PAR TYPE : images légères, vidéos = clips courts. */
export const ASSET_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 Mo
export const ASSET_VIDEO_MAX_BYTES = 100 * 1024 * 1024; // 100 Mo

export type AssetKind = "image" | "video";

/** Catégorie d'un contentType, ou null si non supporté. */
export function assetKind(contentType: string): AssetKind | null {
  if (ASSET_IMAGE_TYPES.includes(contentType)) return "image";
  if (ASSET_VIDEO_TYPES.includes(contentType)) return "video";
  return null;
}

export function isAcceptedAssetType(contentType: string): boolean {
  return assetKind(contentType) !== null;
}

/** Taille max autorisée pour ce type, ou null si type non supporté. */
export function maxBytesForType(contentType: string): number | null {
  const kind = assetKind(contentType);
  if (kind === "image") return ASSET_IMAGE_MAX_BYTES;
  if (kind === "video") return ASSET_VIDEO_MAX_BYTES;
  return null;
}

export interface AssetValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Valide un fichier candidat : type accepté (image ou vidéo) ET taille ≤ max
 * SELON le type (image 10 Mo / vidéo 100 Mo). Message d'erreur lisible (FR) si
 * invalide. Tout type hors images/vidéos autorisées est rejeté.
 */
export function validateAssetFile(file: {
  contentType: string;
  size: number;
}): AssetValidationResult {
  const kind = assetKind(file.contentType);
  if (!kind) {
    return {
      ok: false,
      error:
        "Format non supporté. Images JPG/PNG/WebP ou vidéos MP4/MOV/WebM uniquement.",
    };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: "Fichier vide ou taille invalide." };
  }
  const max = kind === "image" ? ASSET_IMAGE_MAX_BYTES : ASSET_VIDEO_MAX_BYTES;
  if (file.size > max) {
    return {
      ok: false,
      error:
        kind === "image"
          ? "Image trop lourde (10 Mo max)."
          : "Vidéo trop lourde (100 Mo max).",
    };
  }
  return { ok: true };
}
