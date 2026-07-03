"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  HomeIcon,
  AtSignIcon,
  FilesIcon,
  FilmIcon,
  WalletIcon,
  UserIcon,
  HelpCircleIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * Barre d'onglets MOBILE du portail créateur (style app native, au pouce).
 * Visible < md uniquement (le desktop a la sidebar gauche). Onglet actif en
 * accent orange ; badges dérivés : « Accueil » = TOTAL des actions à traiter —
 * à produire + à publier + à refaire (countMyActionable, pour qu'une nouvelle
 * mission ou une vidéo refusée génère bien le badge) ; « Comptes » = warmups à
 * faire/rattraper aujourd'hui (countMyWarmupDue). Fixe en bas, safe-area iOS gérée.
 *
 * 5ᵉ onglet selon le projet :
 *   - projet AVEC outils → « Outils » (page /app/outils qui liste les outils) ;
 *     « Guide » est alors déplacé dans le header mobile (cf app/app/layout).
 *   - projet SANS outils → « Guide » reste ici (aucune réorganisation) : pas
 *     d'onglet Outils vide.
 */
type BadgeKey = "actionable" | "warmupDue";
type Tab = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact: boolean;
  badgeKey?: BadgeKey;
};

const BASE_TABS: Tab[] = [
  { href: "/app", label: "Accueil", icon: HomeIcon, exact: true, badgeKey: "actionable" },
  { href: "/app/comptes", label: "Comptes", icon: AtSignIcon, exact: false, badgeKey: "warmupDue" },
  { href: "/app/paiements", label: "Gains", icon: WalletIcon, exact: false },
  { href: "/app/profil", label: "Profil", icon: UserIcon, exact: false },
];

const OUTILS_TAB: Tab = {
  href: "/app/outils",
  label: "Outils",
  icon: WrenchIcon,
  exact: false,
};
const GUIDE_TAB: Tab = {
  href: "/app/guide",
  label: "Guide",
  icon: HelpCircleIcon,
  exact: false,
};
// Dépôt de contenu — Snytch uniquement (cf lib/snytch-drive), inséré après Comptes.
const FICHIERS_TAB: Tab = {
  href: "/app/fichiers",
  label: "Fichiers",
  icon: FilesIcon,
  exact: false,
};
// Suivi des vidéos publiées — Snytch uniquement, inséré après Fichiers.
const VIDEOS_TAB: Tab = {
  href: "/app/videos",
  label: "Vidéos",
  icon: FilmIcon,
  exact: false,
};

export function CreatorBottomNav({
  projectId,
  hasTools,
  showFiles,
}: {
  projectId: Id<"projects"> | null;
  hasTools: boolean;
  showFiles: boolean;
}) {
  const pathname = usePathname();
  // Snytch → 7 onglets (Fichiers + Vidéos insérés) ; sinon 5 (inchangé).
  const lastTab = hasTools ? OUTILS_TAB : GUIDE_TAB;
  const tabs: Tab[] = showFiles
    ? [
        BASE_TABS[0],
        BASE_TABS[1],
        FICHIERS_TAB,
        VIDEOS_TAB,
        BASE_TABS[2],
        BASE_TABS[3],
        lastTab,
      ]
    : [...BASE_TABS, lastTab];
  const actionable =
    useQuery(
      api.assignments.countMyActionable,
      projectId ? { projectId } : "skip",
    ) ?? 0;
  const warmupDue =
    useQuery(
      api.comptes.countMyWarmupDue,
      projectId ? { projectId } : "skip",
    ) ?? 0;
  const badgeCount: Record<BadgeKey, number> = {
    actionable,
    warmupDue,
  };

  return (
    <nav
      aria-label="Navigation portail"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur supports-backdrop-filter:bg-white/80 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul
        className={cn(
          "mx-auto grid max-w-lg",
          tabs.length === 7
            ? "grid-cols-7"
            : tabs.length === 6
              ? "grid-cols-6"
              : "grid-cols-5",
        )}
      >
        {tabs.map((t) => {
          const active = t.exact
            ? pathname === t.href
            : pathname.startsWith(t.href);
          const Icon = t.icon;
          const count = t.badgeKey ? badgeCount[t.badgeKey] : 0;
          const showBadge = count > 0;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-slate-500 hover:text-slate-900",
                )}
              >
                <span className="relative">
                  <Icon className="size-6" strokeWidth={active ? 2.4 : 2} />
                  {showBadge && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
                      {count}
                    </span>
                  )}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
