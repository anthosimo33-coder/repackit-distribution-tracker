/**
 * Configuration centralisée par mediaType (Batch C).
 *
 * Adresse TD-008 (PLATEFORMES dupliquées) : avant ce fichier, la const
 * ["TikTok","Instagram","YouTube"] était dupliquée dans plusieurs callsites
 * (app/comptes, app/nouveau, app/tracker, PublicationDetailDialog). Le split
 * de routes (Batch B) a déjà éliminé 2 dupes ; ce module centralise les
 * dernières et fournit aussi labels + icônes utilisables par le modal
 * Nouveau et tout futur composant qui doit boucler sur les 3 formats.
 *
 * Single source of truth :
 *   - lib/media-type.ts garde ALLOWED_PLATFORMS_FOR_* (utilisés par les
 *     validators côté serveur duplicate-aware Convex). FORMAT_CONFIGS
 *     RÉFÉRENCE ces constantes — ne pas re-déclarer ici.
 *   - Les labels singular/plural et l'icône lucide vivent ici.
 */

import type { LucideIcon } from "lucide-react";
import {
  GalleryHorizontalIcon,
  MonitorIcon,
  PlaySquareIcon,
} from "lucide-react";
import {
  ALLOWED_PLATFORMS_FOR_CAROUSEL,
  ALLOWED_PLATFORMS_FOR_SCREENRECORDER,
  ALLOWED_PLATFORMS_FOR_SHORT,
  type MediaType,
} from "./media-type";

export type Platform = "TikTok" | "Instagram" | "YouTube";

export const ALL_PLATFORMS = ["TikTok", "Instagram", "YouTube"] as const;

export type FormatConfig = {
  mediaType: MediaType;
  singular: string;
  plural: string;
  newButtonLabel: string;
  allowedPlatforms: readonly Platform[];
  icon: LucideIcon;
  cardDescription: string;
  /** route dédiée à la liste de ce format (Batch B). */
  route: string;
  /** true si la création est encore désactivée (ScreenRecorder en attente
   *  du Batch D — schema mediaType union étendu + Convex storage). */
  disabled?: boolean;
};

// ScreenRecorder n'est pas encore dans le union MediaType (lib/media-type.ts).
// On le déclare ici en tant que clé conditionnelle pour préparer la card de
// l'étape 1 du modal — la sélection est bloquée tant que disabled=true.
// Annotation explicite Record<...> (pas de `as const`) pour que `disabled`
// soit accessible uniformément sur les 3 entrées sans précision de literal.
export type FormatKey = "carousel" | "short" | "screenrecorder";
export const FORMAT_CONFIGS: Record<FormatKey, FormatConfig> = {
  carousel: {
    mediaType: "carousel" as MediaType,
    singular: "Carrousel",
    plural: "Carrousels",
    newButtonLabel: "Nouveau Carrousel",
    allowedPlatforms: ALLOWED_PLATFORMS_FOR_CAROUSEL,
    icon: GalleryHorizontalIcon,
    cardDescription:
      "5 à 8 slides texte pour TikTok et Instagram. Format historique RepackIt.",
    route: "/carrousels",
  },
  short: {
    mediaType: "short" as MediaType,
    singular: "Short",
    plural: "Shorts",
    newButtonLabel: "Nouveau Short",
    allowedPlatforms: ALLOWED_PLATFORMS_FOR_SHORT,
    icon: PlaySquareIcon,
    cardDescription:
      "Vidéo verticale courte (TikTok, Reels, YouTube Shorts). Script continu.",
    route: "/shorts",
  },
  // Batch D — ScreenRecorder activé (mediaType union étendu côté schema +
  // helpers). Capture d'écran avec titre + image d'accompagnement, 3
  // plateformes (cohérent Shorts).
  screenrecorder: {
    mediaType: "screenrecorder",
    singular: "ScreenRecorder",
    plural: "ScreenRecorders",
    newButtonLabel: "Nouveau ScreenRecorder",
    allowedPlatforms: ALLOWED_PLATFORMS_FOR_SCREENRECORDER,
    icon: MonitorIcon,
    cardDescription:
      "Capture d'écran avec titre et image d'accompagnement (3 plateformes).",
    route: "/screenrecorder",
  },
};
