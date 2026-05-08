import type { Doc } from "@/convex/_generated/dataModel";

/**
 * Source unique de vérité pour le mediaType d'une publication.
 *
 * Convention "Option A" : `mediaType` est `v.optional` au schéma. Les rows
 * pré-Shorts (créées avant l'ajout de ce champ) ont `mediaType` undefined ;
 * elles sont toutes des carrousels par construction. Le helper coerce
 * undefined → "carousel".
 *
 * NE PAS recoder cette coercion ailleurs — toujours importer ce helper.
 */
export type MediaType = "carousel" | "short";

export function getMediaType(p: Doc<"publications">): MediaType {
  return p.mediaType ?? "carousel";
}

/**
 * Plateformes éligibles selon le mediaType. Les Carrousels ne sont pas
 * autorisés sur YouTube (pas de format carrousel natif). Les Shorts couvrent
 * les 3 plateformes (TikTok, Reels Instagram, YouTube Shorts).
 *
 * Defense in depth : ces constantes pilotent l'UI (filtrage des dropdowns
 * plateforme cible) ET la validation serveur (cf isFormatAllowedOnPlatform
 * appliqué dans createPublication / updateDraft / duplicateCarousel).
 */
export const ALLOWED_PLATFORMS_FOR_CAROUSEL = ["TikTok", "Instagram"] as const;
export const ALLOWED_PLATFORMS_FOR_SHORT = [
  "TikTok",
  "Instagram",
  "YouTube",
] as const;

export function isFormatAllowedOnPlatform(
  mediaType: MediaType,
  plateforme: string,
): boolean {
  if (mediaType === "carousel") {
    return (ALLOWED_PLATFORMS_FOR_CAROUSEL as readonly string[]).includes(
      plateforme,
    );
  }
  return (ALLOWED_PLATFORMS_FOR_SHORT as readonly string[]).includes(
    plateforme,
  );
}
