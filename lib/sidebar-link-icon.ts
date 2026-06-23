import {
  CaptionsIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  ImageIcon,
  LayoutTemplateIcon,
  LinkIcon,
  PlaySquareIcon,
  SparklesIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * Résolution du champ `sidebarLinks[].icon` (string libre, configuré par projet)
 * vers une icône lucide. Curaté volontairement : on n'expose pas tout lucide
 * (bundle + risque de nom invalide). Tout nom inconnu ⇒ fallback "lien externe".
 * Ajouter une entrée ici suffit pour rendre une nouvelle icône configurable —
 * aucun hardcode par projet.
 */
const ICONS: Record<string, LucideIcon> = {
  "external-link": ExternalLinkIcon,
  link: LinkIcon,
  subtitles: CaptionsIcon,
  captions: CaptionsIcon,
  carousel: LayoutTemplateIcon,
  template: LayoutTemplateIcon,
  image: ImageIcon,
  video: PlaySquareIcon,
  play: PlaySquareIcon,
  sparkles: SparklesIcon,
  studio: SparklesIcon,
  tool: WrenchIcon,
  wrench: WrenchIcon,
  course: GraduationCapIcon,
  graduation: GraduationCapIcon,
};

export function resolveSidebarLinkIcon(icon?: string): LucideIcon {
  if (!icon) return ExternalLinkIcon;
  return ICONS[icon.trim().toLowerCase()] ?? ExternalLinkIcon;
}
