"use client";

import { useEffect } from "react";

/**
 * P10 branding — propage l'accent du projet (projects.accentColor, défaut
 * orange RepackIt #FF5200) sur `document.documentElement`, donc à TOUT l'arbre
 * y compris le contenu rendu en portal (Dialog / Popover / Tooltip / Select de
 * Base UI, montés sur <body> hors du wrapper du shell). Le wrapper du shell
 * (SidebarLayout / portail) porte déjà ces variables en inline pour un rendu
 * SSR sans flash ; ce composant complète la couverture pour les portals.
 *
 * Cleanup au démontage : on retire la surcharge → retour au défaut #FF5200 de
 * globals.css. Comme un seul shell (admin OU portail) est monté à la fois, la
 * navigation admin↔portail ou le switch de projet réapplique proprement.
 */
export function AccentStyle({ accent }: { accent: string }) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--primary", accent);
    root.style.setProperty("--ring", accent);
    root.style.setProperty("--sidebar-primary", accent);
    root.style.setProperty("--sidebar-ring", accent);
    return () => {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--ring");
      root.style.removeProperty("--sidebar-primary");
      root.style.removeProperty("--sidebar-ring");
    };
  }, [accent]);

  return null;
}
