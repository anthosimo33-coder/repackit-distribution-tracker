"use client";

import { usePathname } from "next/navigation";
import {
  AtSignIcon,
  FilesIcon,
  FilmIcon,
  HelpCircleIcon,
  HomeIcon,
  ListChecksIcon,
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
import { useTranslations } from "next-intl";
import { useLabel } from "@/lib/use-label";

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
type NavItem = {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  exact: boolean;
};

// `as const` : `labelKey` doit garder son type LITTÉRAL, sinon t() le refuse —
// les clés de messages sont typées depuis messages/fr.json.
const NAV_ITEMS = [
  { href: "/app", labelKey: "sidebar.dashboard", icon: HomeIcon, exact: true },
  // « Mes missions » : la liste sans plafond, juste sous le tableau de bord (qui,
  // lui, n'en montre que les 5 premières par bloc).
  { href: "/app/missions", labelKey: "sidebar.missions", icon: ListChecksIcon, exact: false },
  { href: "/app/comptes", labelKey: "sidebar.comptes", icon: AtSignIcon, exact: false },
  {
    href: "/app/paiements",
    labelKey: "sidebar.paiements",
    icon: WalletIcon,
    exact: false,
  },
  { href: "/app/profil", labelKey: "sidebar.profil", icon: UserIcon, exact: false },
  {
    href: "/app/guide",
    labelKey: "sidebar.guide",
    icon: HelpCircleIcon,
    exact: false,
  },
] as const;

/** Dépôt de contenu — Snytch uniquement (cf lib/snytch-drive), inséré après comptes. */
const FICHIERS_ITEM = {
  href: "/app/fichiers",
  labelKey: "sidebar.fichiers",
  icon: FilesIcon,
  exact: false,
} as const;

/** Suivi des vidéos publiées — Snytch uniquement, inséré après « Mes fichiers ». */
const VIDEOS_ITEM = {
  href: "/app/videos",
  labelKey: "sidebar.videos",
  icon: FilmIcon,
  exact: false,
} as const;

export function CreatorSidebar({ onSignOut }: { onSignOut: () => void }) {
  const tLabel = useLabel();
  const t = useTranslations("portal");
  const pathname = usePathname();
  const { current } = useCreatorProject();
  // Outils figés du projet courant (vide → pas de section, cf creator-tools).
  const tools = getCreatorTools(current.slug);
  // « Mes fichiers » + « Mes vidéos » réservés à Snytch (les autres projets n'ont
  // ni Drive ni suivi vidéos exposé).
  // Découpage par NOM d'item et non par index nu : l'insertion Snytch se faisait
  // sur `slice(0, 2)` / `slice(2)`, si bien qu'ajouter une entrée en amont
  // envoyait « Mes fichiers » avant « Mes comptes » sans que rien ne le signale.
  const afterComptes =
    NAV_ITEMS.findIndex((it) => it.href === "/app/comptes") + 1;
  const navItems = isSnytchProject(current.slug)
    ? [
        ...NAV_ITEMS.slice(0, afterComptes),
        FICHIERS_ITEM,
        VIDEOS_ITEM,
        ...NAV_ITEMS.slice(afterComptes),
      ]
    : NAV_ITEMS;

  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:sticky md:top-0 md:flex">
      {/* Header : branding / switcher du projet courant */}
      <div className="flex h-14 shrink-0 items-center border-b border-slate-200 px-3">
        <CreatorProjectSwitcher />
      </div>

      {/* Nav : items existants (verticaux) + catégorie Outils */}
      <nav
        aria-label={t("sidebar.aria")}
        className="flex-1 space-y-6 overflow-y-auto px-3 py-4"
      >
        <div className="space-y-1">
          {navItems.map((it) => (
            <SidebarItem
              key={it.href}
              icon={it.icon}
              label={t(it.labelKey)}
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
              {t("tools.title")}
            </div>
            <div className="space-y-1">
              {tools.map((tool) => (
                <SidebarItem
                  key={tool.url}
                  icon={resolveSidebarLinkIcon(tool.icon)}
                  label={tLabel(tool.labelKey)}
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
          aria-label={t("sidebar.logout")}
          className="w-full justify-start gap-2 text-slate-600 hover:text-slate-900"
        >
          <LogOutIcon className="size-4" />
          <span>{t("sidebar.logout")}</span>
        </Button>
      </div>
    </aside>
  );
}
