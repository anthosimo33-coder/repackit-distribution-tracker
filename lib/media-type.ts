import type { Doc } from "@/convex/_generated/dataModel";
import { PLATEFORMES } from "../convex/platforms";

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
// Batch D — extension "screenrecorder" (capture d'écran + titre + image).
export type MediaType = "carousel" | "short" | "screenrecorder";

export function getMediaType(p: Doc<"publications">): MediaType {
  return p.mediaType ?? "carousel";
}

/**
 * Plateformes éligibles selon le mediaType. Les Carrousels ne sont pas
 * autorisés que sur TikTok et Instagram (ni YouTube, ni Facebook, ni Snapchat
 * n'en ont un format natif). Les Shorts et les ScreenRecorders couvrent toutes
 * les plateformes.
 *
 * Defense in depth : ces constantes pilotent l'UI (filtrage des dropdowns
 * plateforme cible) ET la validation serveur (cf isFormatAllowedOnPlatform
 * appliqué dans createPublication / updateDraft / duplicateCarousel).
 */
export const ALLOWED_PLATFORMS_FOR_CAROUSEL = ["TikTok", "Instagram"] as const;
export const ALLOWED_PLATFORMS_FOR_SHORT = PLATEFORMES;
export const ALLOWED_PLATFORMS_FOR_SCREENRECORDER = PLATEFORMES;

export function isFormatAllowedOnPlatform(
  mediaType: MediaType,
  plateforme: string,
): boolean {
  if (mediaType === "carousel") {
    return (ALLOWED_PLATFORMS_FOR_CAROUSEL as readonly string[]).includes(
      plateforme,
    );
  }
  if (mediaType === "screenrecorder") {
    return (
      ALLOWED_PLATFORMS_FOR_SCREENRECORDER as readonly string[]
    ).includes(plateforme);
  }
  return (ALLOWED_PLATFORMS_FOR_SHORT as readonly string[]).includes(
    plateforme,
  );
}
