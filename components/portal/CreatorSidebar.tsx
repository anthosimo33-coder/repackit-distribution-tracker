"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LogOutIcon } from "lucide-react";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { CreatorProjectSwitcher } from "@/components/portal/CreatorProjectSwitcher";
import { CREATOR_TAB_ICONS } from "@/components/portal/creator-tab-icons";
import { SidebarItem } from "@/components/layout/SidebarItem";
import { VersEspaceEquipe } from "@/components/layout/EspaceSwitch";
import { Button } from "@/components/ui/button";
import { activeCreatorTab, creatorTabsFor } from "@/lib/creator-nav";
import { getCreatorTools } from "@/lib/creator-tools";
import { resolveSidebarLinkIcon } from "@/lib/sidebar-link-icon";
import { portalHref } from "@/lib/view-as";
import { useTranslations } from "next-intl";
import { useLabel } from "@/lib/use-label";

/**
 * Sidebar DESKTOP du portail créateur (≥ md) — les MÊMES quatre onglets que la
 * barre mobile (cf `lib/creator-nav`), dans le même ordre et sous les mêmes mots.
 * Une créatrice qui passe du téléphone à l'ordinateur retrouve son espace.
 *
 * La catégorie « Outils » reste ici : sur desktop il y a la place, et un lien
 * externe utilisé souvent ne doit pas coûter deux clics. Sur mobile, les outils
 * sont sous « Moi ».
 */
export function CreatorSidebar({ onSignOut }: { onSignOut: () => void }) {
  const tLabel = useLabel();
  const t = useTranslations("portal");
  const pathname = usePathname();
  const { current } = useCreatorProject();
  const tools = getCreatorTools(current.slug);
  const sub = pathname.startsWith("/app") ? pathname.slice("/app".length) : pathname;
  const active = activeCreatorTab(sub);
  const actionable =
    useQuery(api.assignments.countMyActionable, { projectId: current.projectId }) ?? 0;
  const warmupDue =
    useQuery(api.comptes.countMyWarmupDue, { projectId: current.projectId }) ?? 0;
  const badgeCount = { actionable, warmupDue };

  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:sticky md:top-0 md:flex">
      <div className="flex h-14 shrink-0 items-center border-b border-slate-200 px-3">
        <CreatorProjectSwitcher />
      </div>

      <nav
        aria-label={t("sidebar.aria")}
        className="flex-1 space-y-6 overflow-y-auto px-3 py-4"
      >
        <div className="space-y-1">
          {creatorTabsFor({ argent: true }).map((tab) => (
            <SidebarItem
              key={tab.key}
              icon={CREATOR_TAB_ICONS[tab.key]}
              label={t(`tabs.${tab.key}`)}
              href={portalHref("/app", tab.sub)}
              isActive={active === tab.key}
              isCollapsed={false}
              badge={tab.badge ? badgeCount[tab.badge] : undefined}
            />
          ))}
        </div>

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

      <div className="space-y-1.5 border-t border-slate-200 p-2">
        <VersEspaceEquipe variant="carte" />
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
