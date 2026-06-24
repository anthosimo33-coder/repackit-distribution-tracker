"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AtSignIcon,
  EyeIcon,
  HelpCircleIcon,
  HomeIcon,
  LogOutIcon,
  UserIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { AccentStyle } from "@/components/project/AccentStyle";
import { SidebarItem } from "@/components/layout/SidebarItem";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { useViewAs } from "@/components/portal/ViewAsContext";
import { useActionable, useWarmupDue } from "@/components/portal/creator-data";
import { portalHref } from "@/lib/view-as";
import { cn } from "@/lib/utils";

/**
 * Admin « voir l'espace d'un créateur » (LECTURE SEULE) — SHELL du mode vue.
 *
 * Rend les écrans créateur RÉUTILISÉS dans une coque qui imite le portail
 * (sidebar desktop / bottom nav mobile, accent du projet) MAIS :
 *   - un BANDEAU PERSISTANT en tête de TOUS les écrans rend le mode visuellement
 *     évident — « Tu regardes l'espace de <créateur> (lecture seule) » + Quitter ;
 *   - aucune action de session (pas de déconnexion : l'admin reste lui-même, on
 *     ne prend jamais la session du créateur) ni de switcher de projet ;
 *   - les liens de nav pointent vers la base view-as (portalHref) et non /app.
 * Quitter ramène à la fiche admin du créateur.
 */
type NavItem = {
  sub: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  exact: boolean;
  badge?: "actionable" | "warmupDue";
};

const NAV: NavItem[] = [
  { sub: "/", label: "Tableau de bord", shortLabel: "Accueil", icon: HomeIcon, exact: true, badge: "actionable" },
  { sub: "/comptes", label: "Mes comptes", shortLabel: "Comptes", icon: AtSignIcon, exact: false, badge: "warmupDue" },
  { sub: "/paiements", label: "Mes paiements", shortLabel: "Gains", icon: WalletIcon, exact: false },
  { sub: "/profil", label: "Profil", shortLabel: "Profil", icon: UserIcon, exact: false },
  { sub: "/guide", label: "Comment ça marche", shortLabel: "Guide", icon: HelpCircleIcon, exact: false },
];

export function ViewAsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const projectPath = useProjectPath();
  const { current } = useCreatorProject();
  const viewAs = useViewAs();

  const accent = current.accentColor || "#FF5200";
  const accentVars = {
    "--primary": accent,
    "--ring": accent,
  } as React.CSSProperties;

  const base = viewAs?.basePath ?? "/app";
  const creatorName = viewAs?.creatorName ?? current.creatorName ?? "ce créateur";
  // Quitter → fiche admin du créateur (point d'entrée du mode vue).
  const exitHref = viewAs
    ? projectPath(`/createurs/${viewAs.creatorId}`)
    : projectPath("/createurs");

  const actionable = useActionable(current.projectId) ?? 0;
  const warmupDue = useWarmupDue(current.projectId) ?? 0;
  const badgeCount = { actionable, warmupDue };

  function isActive(item: NavItem) {
    const href = portalHref(base, item.sub);
    return item.exact ? pathname === href : pathname.startsWith(href);
  }

  return (
    <div className="min-h-screen bg-slate-50" style={accentVars}>
      <AccentStyle accent={accent} />

      {/* BANDEAU DE MODE — persistant, en tête de tous les écrans du mode vue. */}
      <div
        data-testid="view-as-banner"
        className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2.5 text-amber-900"
      >
        <div className="flex min-w-0 items-center gap-2">
          <EyeIcon className="size-4 shrink-0" />
          <p className="min-w-0 truncate text-sm">
            Tu regardes l&apos;espace de{" "}
            <span className="font-semibold">{creatorName}</span>{" "}
            <span className="font-medium text-amber-700">(lecture seule)</span>
          </p>
        </div>
        <Link
          href={exitHref}
          data-testid="view-as-exit"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-amber-900 px-3 text-sm font-medium text-amber-50 transition-opacity hover:opacity-90"
        >
          <LogOutIcon className="size-3.5" />
          Quitter
        </Link>
      </div>

      <div className="md:flex">
        {/* Sidebar DESKTOP (≥ md) — réplique read-only de CreatorSidebar. */}
        <aside className="hidden h-[calc(100vh-49px)] w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:sticky md:top-[49px] md:flex">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 px-4">
            <span className="truncate text-sm font-semibold text-slate-900">
              {current.name}
            </span>
          </div>
          <nav
            aria-label="Navigation vue créateur"
            className="flex-1 space-y-1 overflow-y-auto px-3 py-4"
          >
            {NAV.map((it) => (
              <SidebarItem
                key={it.sub}
                icon={it.icon}
                label={it.label}
                href={portalHref(base, it.sub)}
                isActive={isActive(it)}
                isCollapsed={false}
                badge={it.badge ? badgeCount[it.badge] : undefined}
              />
            ))}
          </nav>
        </aside>

        <main className="flex-1 overflow-x-hidden">
          <div className="container mx-auto px-4 py-6 pb-24 sm:px-6 sm:py-8 md:pb-8">
            {children}
          </div>
        </main>
      </div>

      {/* Bottom tab bar MOBILE (< md) — réplique read-only de CreatorBottomNav. */}
      <nav
        aria-label="Navigation vue créateur"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur supports-backdrop-filter:bg-white/80 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {NAV.map((it) => {
            const active = isActive(it);
            const Icon = it.icon;
            const count = it.badge ? badgeCount[it.badge] : 0;
            return (
              <li key={it.sub}>
                <Link
                  href={portalHref(base, it.sub)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                    active ? "text-primary" : "text-slate-500 hover:text-slate-900",
                  )}
                >
                  <span className="relative">
                    <Icon className="size-6" strokeWidth={active ? 2.4 : 2} />
                    {count > 0 && (
                      <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
                        {count}
                      </span>
                    )}
                  </span>
                  {it.shortLabel}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
