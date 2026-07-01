"use client";

import { usePathname } from "next/navigation";
import {
  AtSignIcon,
  FilesIcon,
  HelpCircleIcon,
  HomeIcon,
  LogOutIcon,
  UserIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { CreatorProjectSwitcher } from "@/components/portal/CreatorProjectSwitcher";
import { SidebarItem } from "@/components/layout/SidebarItem";
import { Button } from "@/components/ui/button";
import { getCreatorTools } from "@/lib/creator-tools";
import { isSnytchProject } from "@/lib/snytch-drive";
import { resolveSidebarLinkIcon } from "@/lib/sidebar-link-icon";

/**
 * Sidebar DESKTOP du portail créateur (≥ md), réplique du pattern admin :
 * branding du projet courant en haut (switcher), items de nav verticaux,
 * catégorie « Outils » (liens externes figés par projet), déconnexion en bas.
 * Sous md, c'est le header mobile + la bottom tab bar qui prennent le relais
 * (cf app/app/layout.tsx) → cette sidebar est masquée.
 *
 * Les LABELS sont identiques à l'ancienne nav du haut (« Mes comptes », « Mes
 * paiements », « Comment ça marche »…) : les liens restent ciblables par nom,
 * la navigation interne du portail est inchangée — seul l'agencement passe
 * d'horizontal à vertical.
 */
const NAV_ITEMS: {
  href: string;
  label: string;
  icon: LucideIcon;
  exact: boolean;
}[] = [
  { href: "/app", label: "Tableau de bord", icon: HomeIcon, exact: true },
  { href: "/app/comptes", label: "Mes comptes", icon: AtSignIcon, exact: false },
  {
    href: "/app/paiements",
    label: "Mes paiements",
    icon: WalletIcon,
    exact: false,
  },
  { href: "/app/profil", label: "Profil", icon: UserIcon, exact: false },
  {
    href: "/app/guide",
    label: "Comment ça marche",
    icon: HelpCircleIcon,
    exact: false,
  },
];

/** Dépôt de contenu — Snytch uniquement (cf lib/snytch-drive), inséré après comptes. */
const FICHIERS_ITEM = {
  href: "/app/fichiers",
  label: "Mes fichiers",
  icon: FilesIcon,
  exact: false,
} as const;

export function CreatorSidebar({ onSignOut }: { onSignOut: () => void }) {
  const pathname = usePathname();
  const { current } = useCreatorProject();
  // Outils figés du projet courant (vide → pas de section, cf creator-tools).
  const tools = getCreatorTools(current.slug);
  // « Mes fichiers » réservé à Snytch (les autres projets n'ont pas de Drive).
  const navItems = isSnytchProject(current.slug)
    ? [...NAV_ITEMS.slice(0, 2), FICHIERS_ITEM, ...NAV_ITEMS.slice(2)]
    : NAV_ITEMS;

  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:sticky md:top-0 md:flex">
      {/* Header : branding / switcher du projet courant */}
      <div className="flex h-14 shrink-0 items-center border-b border-slate-200 px-3">
        <CreatorProjectSwitcher />
      </div>

      {/* Nav : items existants (verticaux) + catégorie Outils */}
      <nav
        aria-label="Navigation créateur"
        className="flex-1 space-y-6 overflow-y-auto px-3 py-4"
      >
        <div className="space-y-1">
          {navItems.map((it) => (
            <SidebarItem
              key={it.href}
              icon={it.icon}
              label={it.label}
              href={it.href}
              isActive={
                it.exact
                  ? pathname === it.href
                  : pathname.startsWith(it.href)
              }
              isCollapsed={false}
            />
          ))}
        </div>

        {/* Outils — liens directs du projet, en nouvel onglet. Masqué si le
            projet n'a aucun outil (pas de section vide). */}
        {tools.length > 0 && (
          <div>
            <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Outils
            </div>
            <div className="space-y-1">
              {tools.map((tool) => (
                <SidebarItem
                  key={tool.url}
                  icon={resolveSidebarLinkIcon(tool.icon)}
                  label={tool.label}
                  href={tool.url}
                  isActive={false}
                  isCollapsed={false}
                  external
                />
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Footer : déconnexion */}
      <div className="border-t border-slate-200 p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSignOut}
          aria-label="Se déconnecter"
          className="w-full justify-start gap-2 text-slate-600 hover:text-slate-900"
        >
          <LogOutIcon className="size-4" />
          <span>Se déconnecter</span>
        </Button>
      </div>
    </aside>
  );
}
