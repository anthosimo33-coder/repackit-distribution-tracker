"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { activeCreatorTab, creatorTabsFor } from "@/lib/creator-nav";
import { portalHref } from "@/lib/view-as";
import { CREATOR_TAB_ICONS } from "@/components/portal/creator-tab-icons";
import { useTranslations } from "next-intl";

/**
 * Barre d'onglets MOBILE du portail créateur — QUATRE onglets, au pouce.
 *
 * Aujourd'hui · Missions · Gains · Moi. Visible < md (le desktop a la sidebar).
 * Le découpage vit dans `lib/creator-nav` : les anciennes pages (comptes,
 * paiements, profil, guide…) sont des sous-pages d'un onglet, et c'est lui qui
 * reste allumé quand on y descend.
 *
 * ── CE QUI A DISPARU, ET POURQUOI ────────────────────────────────────────────
 * L'entrée « Plus » et sa feuille : elle n'existait que parce que la barre
 * débordait à huit colonnes sur Snytch. À quatre onglets, plus rien ne déborde —
 * Fichiers vit sous « Moi », Vidéos sous « Gains ».
 *
 * Badges : « Aujourd'hui » porte le total des actions (à produire + à publier +
 * à refaire), « Moi » les warmups dus aujourd'hui (c'est là que sont les comptes).
 */
export function CreatorBottomNav({
  projectId,
}: {
  projectId: Id<"projects"> | null;
}) {
  const t = useTranslations("portal");
  const pathname = usePathname();
  const sub = pathname.startsWith("/app") ? pathname.slice("/app".length) : pathname;
  const active = activeCreatorTab(sub);
  const actionable =
    useQuery(api.assignments.countMyActionable, projectId ? { projectId } : "skip") ?? 0;
  const warmupDue =
    useQuery(api.comptes.countMyWarmupDue, projectId ? { projectId } : "skip") ?? 0;
  const badgeCount = { actionable, warmupDue };

  return (
    <nav
      aria-label={t("bottomNav.aria")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur supports-backdrop-filter:bg-white/80 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {creatorTabsFor({ argent: true }).map((tab) => {
          const on = active === tab.key;
          const Icon = CREATOR_TAB_ICONS[tab.key];
          const count = tab.badge ? badgeCount[tab.badge] : 0;
          return (
            <li key={tab.key}>
              <Link
                href={portalHref("/app", tab.sub)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] transition-colors",
                  on
                    ? "font-semibold text-primary"
                    : "font-medium text-slate-500 hover:text-slate-900",
                )}
              >
                <span className="relative">
                  <Icon className="size-6" strokeWidth={on ? 2.4 : 2} />
                  {count > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
                      {count}
                    </span>
                  )}
                </span>
                <span className="w-full truncate px-0.5 text-center">
                  {t(`tabs.${tab.key}`)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
