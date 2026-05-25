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
  SmartphoneIcon,
} from "lucide-react";
import {
  ALLOWED_PLATFORMS_FOR_CAROUSEL,
  ALLOWED_PLATFORMS_FOR_SCREENRECORDER,
  ALLOWED_PLATFORMS_FOR_SHORT,
  type MediaType,
} from "./media-type";

export type Platform = "TikTok" | "Instagram" | "YouTube";

export const ALL_PLATFORMS = ["TikTok", "Instagram", "YouTube"] as const;

// Batch E — clé KPI unique côté UI. Mappée vers une valeur via getKpiValue
// dans les composants AnalyticsSection. Toutes les valeurs ne s'appliquent
// pas à tous les formats (ex: saveRateAvg carousel-only).
export type KpiKey =
  | "publishedCount"
  | "vuesTotal"
  | "saveRateAvg"
  | "winners"
  | "savesTotal"
  | "engagementRate"
  | "likesAvg"
  | "subsGainedTotal"
  | "ratioSubsViews"
  | "comments";

// Métriques sélectionnables dans MetricChart (chips). Un sous-ensemble est
// exposé par mediaType via FormatConfig.availableMetrics.
export type ChartMetric =
  | "views"
  | "likes"
  | "saves"
  | "subsGained"
  | "comments";

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
  /** Batch E — KPIs affichés dans AnalyticsSection.KpiGrid (6 par défaut). */
  kpiKeys: readonly KpiKey[];
  /** Batch E — métriques disponibles dans MetricChart pour ce format. */
  availableMetrics: readonly ChartMetric[];
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
    kpiKeys: [
      "publishedCount",
      "vuesTotal",
      "saveRateAvg",
      "winners",
      "savesTotal",
      "engagementRate",
    ],
    availableMetrics: ["views", "likes", "saves", "comments"],
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
    kpiKeys: [
      "publishedCount",
      "vuesTotal",
      "likesAvg",
      "subsGainedTotal",
      "ratioSubsViews",
      "comments",
    ],
    availableMetrics: ["views", "likes", "subsGained", "comments"],
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
    kpiKeys: [
      "publishedCount",
      "vuesTotal",
      "likesAvg",
      "subsGainedTotal",
      "ratioSubsViews",
      "comments",
    ],
    availableMetrics: ["views", "likes", "subsGained", "comments"],
  },
};

/**
 * Batch E — labels et formatters par KpiKey.
 *
 * Une même KpiKey peut avoir une formulation légèrement différente selon le
 * format (rare). Pour l'instant, libellés communs ; un override par format
 * sera ajouté si besoin.
 */
export const KPI_LABELS: Record<KpiKey, string> = {
  publishedCount: "Publiés",
  vuesTotal: "Vues totales",
  saveRateAvg: "Save rate moyen",
  winners: "Winners",
  savesTotal: "Saves totaux",
  engagementRate: "Engagement rate",
  likesAvg: "Likes moyens",
  subsGainedTotal: "Subs gagnés",
  ratioSubsViews: "Ratio subs/vues",
  comments: "Comments totaux",
};

export type KpiFormatter = "number" | "percent";

/** Le formatter (number vs percent) dépend de la nature mathématique du KPI,
 *  pas du mediaType. Centralisé pour qu'un futur ajout reste cohérent. */
export const KPI_FORMATTERS: Record<KpiKey, KpiFormatter> = {
  publishedCount: "number",
  vuesTotal: "number",
  saveRateAvg: "percent",
  winners: "number",
  savesTotal: "number",
  engagementRate: "percent",
  likesAvg: "number",
  subsGainedTotal: "number",
  ratioSubsViews: "percent",
  comments: "number",
};

/** Couleurs cohérentes par métrique pour MetricChart + MetricChipSelector.
 *  Palette tailwind compatible. */
export const METRIC_COLORS: Record<ChartMetric, string> = {
  views: "#3b82f6", // blue-500
  likes: "#ef4444", // red-500
  saves: "#10b981", // emerald-500
  subsGained: "#6366f1", // indigo-500
  comments: "#64748b", // slate-500
};

export const METRIC_LABELS: Record<ChartMetric, string> = {
  views: "Views",
  likes: "Likes",
  saves: "Saves",
  subsGained: "Subs",
  comments: "Comments",
};

// ─── Refinement ScreenRecorder — Appareil d'enregistrement ────────────────
// recordingDevice indique sur quel device la capture a été réalisée. Pilote
// l'affichage de l'icône dans la liste tracker + le filtre Appareil dans
// la barre filtres /screenrecorder. Distinct du concept "plateforme" qui
// reste TikTok/Instagram/YouTube.

/**
 * Refinement Shorts — label de la colonne "ID de contenu" du tracker,
 * contextuel au mediaType. "Carrousel" sur /carrousels, "Short" sur /shorts,
 * "SR" sur /screenrecorder (abrégé, distinct du singular "ScreenRecorder").
 */
export function getIdColumnLabel(mediaType: MediaType): string {
  switch (mediaType) {
    case "short":
      return "Short";
    case "screenrecorder":
      return "SR";
    default:
      return "Carrousel";
  }
}

export type RecordingDevice = "phone" | "desktop";

export const RECORDING_DEVICES = ["phone", "desktop"] as const;

export const RECORDING_DEVICE_LABELS: Record<RecordingDevice, string> = {
  phone: "Téléphone",
  desktop: "Ordinateur",
};

export const RECORDING_DEVICE_ICONS: Record<RecordingDevice, LucideIcon> = {
  phone: SmartphoneIcon,
  desktop: MonitorIcon,
};
