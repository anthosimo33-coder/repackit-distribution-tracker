"use client";

import { usePathname, useRouter } from "next/navigation";
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
import { Button } from "@/components/ui/button";
import { SidebarItem } from "./SidebarItem";
import { NewButton } from "./NewButton";
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

// Batch B — split routes par format. Carrousels et Shorts ont chacun leur
// propre page → plus besoin de useSearchParams pour les départager. Le
// Suspense wrapper du Batch A est retiré (plus de hook qui suspend).
export function Sidebar({
  isCollapsed,
  onToggle,
  onNavigate,
  isMobileDrawer,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const collapsed = isMobileDrawer ? false : isCollapsed;

  // Remédiation sécurité — déconnexion Convex Auth. push /login explicite :
  // le proxy redirigerait de toute façon à la prochaine navigation, mais on
  // évite l'état Unauthenticated transitoire (loader plein écran d'AppShell).
  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  const generalItems = [
    {
      icon: LayoutDashboardIcon,
      label: "Dashboard",
      href: "/dashboard",
      isActive: pathname.startsWith("/dashboard"),
    },
    {
      icon: Users2Icon,
      label: "Comptes",
      href: "/comptes",
      isActive: pathname.startsWith("/comptes"),
    },
  ];

  // Batch D — ScreenRecorder activé (mediaType union étendu côté schéma
  // Convex + Convex storage en place). Position entre Shorts et Biblio
  // Hooks pour respecter l'ordre formats puis ressources.
  const contenuItems = [
    {
      icon: GalleryHorizontalIcon,
      label: "Carrousels",
      href: "/carrousels",
      isActive: pathname.startsWith("/carrousels"),
    },
    {
      icon: PlaySquareIcon,
      label: "Shorts",
      href: "/shorts",
      isActive: pathname.startsWith("/shorts"),
    },
    {
      icon: MonitorIcon,
      label: "ScreenRecorder",
      href: "/screenrecorder",
      isActive: pathname.startsWith("/screenrecorder"),
    },
    {
      icon: BookOpenIcon,
      label: "Biblio Hooks",
      href: "/biblio-hooks",
      isActive: pathname.startsWith("/biblio-hooks"),
    },
  ];

  // Batch F — pilier VEILLE / Inspirations. Bibliothèque manuelle d'URLs
  // (vidéos + comptes) cross-plateforme. Indépendant du tracker (publications).
  const veilleItems = [
    {
      icon: BookmarkIcon,
      label: "Inspirations",
      href: "/inspirations",
      isActive: pathname.startsWith("/inspirations"),
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
      {/* Header : logo + brand */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-slate-200",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white",
          )}
        >
          R
        </span>
        {!collapsed && (
          <span className="ml-2 truncate text-sm font-semibold text-slate-900">
            RepackIt Distribution
          </span>
        )}
      </div>

      {/* Bouton + Nouveau */}
      <div className={cn("p-3", collapsed && "px-2")}>
        <NewButton isCollapsed={collapsed} onNavigate={onNavigate} />
      </div>

      {/* Sections nav */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-3">
        <SidebarSection collapsed={collapsed} label="Général">
          {generalItems.map((item) => (
            <SidebarItem
              key={item.href}
              {...item}
              isCollapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarSection>
        <SidebarSection collapsed={collapsed} label="Contenu">
          {contenuItems.map((item) => (
            <SidebarItem
              key={item.href}
              {...item}
              isCollapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarSection>
        <SidebarSection collapsed={collapsed} label="Veille">
          {veilleItems.map((item) => (
            <SidebarItem
              key={item.href}
              {...item}
              isCollapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </SidebarSection>
      </nav>

      {/* Footer : déconnexion + toggle collapse (desktop uniquement) */}
      <div className="space-y-1 border-t border-slate-200 p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className={cn(
            "w-full text-slate-600 hover:text-slate-900",
            collapsed ? "justify-center px-0" : "justify-start gap-2",
          )}
          aria-label="Se déconnecter"
        >
          <LogOutIcon className="size-4" />
          {!collapsed && <span>Se déconnecter</span>}
        </Button>
        {!isMobileDrawer && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggle}
            className="w-full"
            aria-label={
              collapsed ? "Étendre la sidebar" : "Réduire la sidebar"
            }
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
