import {
  ListChecksIcon,
  SunIcon,
  UserIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import type { CreatorTabKey } from "@/lib/creator-nav";

/**
 * Icône de chaque onglet — PARTAGÉE par la barre mobile, la sidebar desktop et la
 * coque d'observation. Séparée de `lib/creator-nav` pour garder ce module pur
 * (sans dépendance d'interface), mais tenue en UN endroit : deux navs aux
 * icônes différentes se liraient comme deux espaces différents.
 */
export const CREATOR_TAB_ICONS: Record<CreatorTabKey, LucideIcon> = {
  today: SunIcon,
  missions: ListChecksIcon,
  gains: WalletIcon,
  moi: UserIcon,
};
