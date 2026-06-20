"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  ArchiveIcon,
  BookmarkIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ClapperboardIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  CoinsIcon,
  GalleryHorizontalIcon,
  HelpCircleIcon,
  LayersIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MonitorIcon,
  PlaySquareIcon,
  UserPlusIcon,
  Users2Icon,
  WalletIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProject } from "@/components/project/ProjectProvider";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { resolveSidebarLinkIcon } from "@/lib/sidebar-link-icon";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SidebarItem } from "./SidebarItem";
import { NewButton } from "./NewButton";
import { ProjectSwitcher } from "@/components/project/ProjectSwitcher";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { cn } from "@/lib/utils";

type SidebarProps = {
  isCollapsed: boolean;
  onToggle: () => void;
  /** Optional callback fired après chaque clic d'un item — utilisé par le
   *  drawer mobile pour se refermer automatiquement. */
  onNavigate?: () => void;
  /** En mode drawer mobile : force expanded et masque le toggle footer. */
  isMobileDrawer?: boolean;
};

// Repli Archives — état mémorisé en localStorage (comme sidebar-collapsed).
const ARCHIVES_STORAGE_KEY = "sidebar-archives-open";

// P3 — items de nav scopés au projet courant (préfixe /admin/<slug>). Les hrefs
// sont construits via useProjectPath ; l'état actif compare le pathname scopé.
//
// Nav regroupée par fréquence d'usage (refonte) : PILOTAGE (quotidien) /
// CRÉATEURS / CONTENU, puis un repli « Archives » (fermé par défaut) pour les
// 4 vues legacy du tracker interne, et « Comment ça marche » (config) en bas.
// Les ROUTES sont inchangées — seul l'affichage est réorganisé.
export function Sidebar({
  isCollapsed,
  onToggle,
  onNavigate,
  isMobileDrawer,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const projectPath = useProjectPath();
  const { project } = useProject();
  const me = useQuery(api.projects.getMe, {});
  // Badge file de validation = nb de vidéos en attente de revue (video_submitted).
  const submittedCount = useProjectQuery(api.assignments.countVideoSubmitted, {});
  const collapsed = isMobileDrawer ? false : isCollapsed;

  // Repli Archives : fermé par défaut, hydraté depuis localStorage post-mount
  // (même pattern que sidebar-collapsed dans SidebarLayout). Indépendant du
  // repli global de la sidebar (collapsed) : les deux ne se chevauchent pas.
  const [archivesOpen, setArchivesOpen] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ARCHIVES_STORAGE_KEY);
      // Hydratation post-mount depuis localStorage (même pattern que
      // sidebar-collapsed dans SidebarLayout) — flicker bref accepté.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "true") setArchivesOpen(true);
    } catch {
      // localStorage indispo → garde le défaut (fermé).
    }
  }, []);

  function toggleArchives() {
    setArchivesOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(ARCHIVES_STORAGE_KEY, String(next));
      } catch {
        // Best-effort.
      }
      return next;
    });
  }

  // Remédiation sécurité — déconnexion Convex Auth. push /login explicite :
  // le proxy redirigerait de toute façon à la prochaine navigation, mais on
  // évite l'état Unauthenticated transitoire (loader plein écran d'AppShell).
  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  const item = (href: string) => ({
    href,
    isActive: pathname.startsWith(href),
  });

  // PILOTAGE — le quotidien : piloter validations, assignations et paie.
  const pilotageItems = [
    {
      icon: LayoutDashboardIcon,
      label: "Dashboard",
      ...item(projectPath("/dashboard")),
    },
    {
      icon: ClipboardCheckIcon,
      label: "Validation",
      // badge = nb d'assignments soumis en attente de validation (P8).
      badge: submittedCount,
      ...item(projectPath("/validation")),
    },
    {
      icon: ClipboardListIcon,
      label: "Assignments",
      ...item(projectPath("/assignments")),
    },
    {
      icon: CoinsIcon,
      label: "Pricings",
      ...item(projectPath("/pricings")),
    },
    {
      icon: WalletIcon,
      label: "Paiements",
      ...item(projectPath("/paiements")),
    },
  ];

  // CRÉATEURS — gestion des créateurs et de leurs comptes.
  const creatorsItems = [
    {
      icon: UserPlusIcon,
      label: "Créateurs",
      ...item(projectPath("/createurs")),
    },
    {
      icon: Users2Icon,
      label: "Comptes",
      ...item(projectPath("/comptes")),
    },
  ];

  // CONTENU — ressources de production.
  const contenuItems = [
    {
      icon: ClapperboardIcon,
      label: "Scripts",
      ...item(projectPath("/scripts")),
    },
    {
      icon: LayersIcon,
      label: "Formats",
      ...item(projectPath("/formats")),
    },
    {
      icon: BookmarkIcon,
      label: "Inspirations",
      ...item(projectPath("/inspirations")),
    },
  ];

  // ARCHIVES — vues legacy du tracker interne, rangées (replié par défaut).
  const archiveItems = [
    {
      icon: GalleryHorizontalIcon,
      label: "Carrousels",
      ...item(projectPath("/carrousels")),
    },
    {
      icon: PlaySquareIcon,
      label: "Shorts",
      ...item(projectPath("/shorts")),
    },
    {
      icon: MonitorIcon,
      label: "ScreenRecorder",
      ...item(projectPath("/screenrecorder")),
    },
    {
      icon: BookOpenIcon,
      label: "Biblio Hooks",
      ...item(projectPath("/biblio-hooks")),
    },
  ];

  const guideItem = {
    icon: HelpCircleIcon,
    label: "Comment ça marche",
    ...item(projectPath("/guide")),
  };

  // OUTILS — liens externes configurés PAR PROJET (project.sidebarLinks). Vide
  // pour les projets qui n'en ont pas (ex. RepackIt) → la section ne s'affiche
  // pas. Chaque lien ouvre son URL dans un nouvel onglet. href = URL externe
  // (clé de rendu = url, stable). icon résolu depuis le nom lucide configuré.
  const externalLinkItems = (project.sidebarLinks ?? []).map((link) => ({
    icon: resolveSidebarLinkIcon(link.icon),
    label: link.label,
    href: link.url,
    isActive: false,
    external: true as const,
  }));

  // Si l'utilisateur est sur une route archivée, on déplie pour que l'item
  // actif reste visible (évite « où suis-je ? » quand Archives est replié).
  const anyArchiveActive = archiveItems.some((it) => it.isActive);
  const showArchiveItems = archivesOpen || anyArchiveActive;

  const renderItem = (it: (typeof pilotageItems)[number]) => (
    <SidebarItem
      key={it.href}
      {...it}
      isCollapsed={collapsed}
      onNavigate={onNavigate}
    />
  );

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-slate-200 bg-white",
        "transition-[width] duration-200 ease-in-out",
        isMobileDrawer ? "w-60" : collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Header : switcher de projet */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-slate-200",
          collapsed ? "justify-center px-2" : "px-3",
        )}
      >
        <ProjectSwitcher isCollapsed={collapsed} onNavigate={onNavigate} />
      </div>

      {/* Bouton + Nouveau */}
      <div className={cn("p-3", collapsed && "px-2")}>
        <NewButton isCollapsed={collapsed} onNavigate={onNavigate} />
      </div>

      {/* Sections nav */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-3">
        <SidebarSection collapsed={collapsed} label="Pilotage">
          {pilotageItems.map(renderItem)}
        </SidebarSection>
        <SidebarSection collapsed={collapsed} label="Créateurs">
          {creatorsItems.map(renderItem)}
        </SidebarSection>
        <SidebarSection collapsed={collapsed} label="Contenu">
          {contenuItems.map(renderItem)}
        </SidebarSection>

        {/* Outils — liens externes propres au projet (configurable). Masqué
            quand le projet n'en a aucun. */}
        {externalLinkItems.length > 0 && (
          <SidebarSection collapsed={collapsed} label="Outils">
            {externalLinkItems.map((it) => (
              <SidebarItem
                key={it.href}
                {...it}
                isCollapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </SidebarSection>
        )}

        {/* Archives — repli en mode expanded ; en mode collapsed, les items
            s'affichent en icônes (séparateur en tête), le repli n'a pas de
            sens sans label. */}
        {collapsed ? (
          <div className="space-y-1 border-t border-slate-200 pt-4">
            {archiveItems.map(renderItem)}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={toggleArchives}
              aria-expanded={showArchiveItems}
              className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-600"
            >
              <span className="flex items-center gap-1.5">
                <ArchiveIcon className="size-3.5" />
                Archives
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-3.5 transition-transform",
                  showArchiveItems ? "" : "-rotate-90",
                )}
              />
            </button>
            {showArchiveItems && (
              <div className="space-y-1">{archiveItems.map(renderItem)}</div>
            )}
          </div>
        )}

        {/* Comment ça marche — config, en bas de la nav. */}
        <div className={cn(!collapsed && "border-t border-slate-200 pt-4")}>
          {renderItem(guideItem)}
        </div>
      </nav>

      {/* Footer : email user + déconnexion + toggle collapse (desktop) */}
      <div className="space-y-1 border-t border-slate-200 p-2">
        {!collapsed && me?.email && (
          <div
            className="truncate px-2 py-1 text-xs text-slate-400"
            title={me.email}
          >
            {me.email}
          </div>
        )}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSignOut}
                  className="w-full justify-center px-0 text-slate-600 hover:text-slate-900"
                  aria-label="Se déconnecter"
                >
                  <LogOutIcon className="size-4" />
                </Button>
              }
            />
            <TooltipContent side="right" sideOffset={8}>
              Se déconnecter
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="w-full justify-start gap-2 text-slate-600 hover:text-slate-900"
            aria-label="Se déconnecter"
          >
            <LogOutIcon className="size-4" />
            <span>Se déconnecter</span>
          </Button>
        )}
        {!isMobileDrawer && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggle}
            className="w-full"
            aria-label={collapsed ? "Étendre la sidebar" : "Réduire la sidebar"}
          >
            {collapsed ? (
              <ChevronsRightIcon className="size-4" />
            ) : (
              <ChevronsLeftIcon className="size-4" />
            )}
          </Button>
        )}
      </div>
    </aside>
  );
}

function SidebarSection({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {!collapsed && (
        <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </div>
      )}
      <div className="space-y-1">{children}</div>
    </div>
  );
}
