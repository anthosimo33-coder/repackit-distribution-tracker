"use client";

import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  BookmarkIcon,
  BookOpenIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  GalleryHorizontalIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MonitorIcon,
  PlaySquareIcon,
  Users2Icon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
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

// P3 — items de nav scopés au projet courant (préfixe /admin/<slug>). Les hrefs
// sont construits via useProjectPath ; l'état actif compare le pathname scopé.
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
  const me = useQuery(api.projects.getMe, {});
  const collapsed = isMobileDrawer ? false : isCollapsed;

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

  const generalItems = [
    {
      icon: LayoutDashboardIcon,
      label: "Dashboard",
      ...item(projectPath("/dashboard")),
    },
    {
      icon: Users2Icon,
      label: "Comptes",
      ...item(projectPath("/comptes")),
    },
  ];

  // Batch D — ScreenRecorder activé. Position entre Shorts et Biblio Hooks
  // pour respecter l'ordre formats puis ressources.
  const contenuItems = [
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

  // Batch F — pilier VEILLE / Inspirations.
  const veilleItems = [
    {
      icon: BookmarkIcon,
      label: "Inspirations",
      ...item(projectPath("/inspirations")),
    },
  ];

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
        <SidebarSection collapsed={collapsed} label="Général">
          {generalItems.map((it) => (
            <SidebarItem
              key={it.href}
              {...it}
              isCollapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarSection>
        <SidebarSection collapsed={collapsed} label="Contenu">
          {contenuItems.map((it) => (
            <SidebarItem
              key={it.href}
              {...it}
              isCollapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarSection>
        <SidebarSection collapsed={collapsed} label="Veille">
          {veilleItems.map((it) => (
            <SidebarItem
              key={it.href}
              {...it}
              isCollapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarSection>
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
