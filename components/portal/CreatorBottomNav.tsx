"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  HomeIcon,
  ListChecksIcon,
  AtSignIcon,
  FilesIcon,
  FilmIcon,
  WalletIcon,
  UserIcon,
  HelpCircleIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

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
  /** CLÉ i18n (littérale) — t() n'accepte pas un `string` élargi. */
  labelKey: Parameters<ReturnType<typeof useTranslations<"portal">>>[0];
  icon: LucideIcon;
  exact: boolean;
  badgeKey?: BadgeKey;
};

// `as const` : cf CreatorSidebar — labelKey doit rester littéral pour t().
const BASE_TABS = [
  { href: "/app", labelKey: "bottomNav.home", icon: HomeIcon, exact: true, badgeKey: "actionable" },
  // « Missions » — la liste sans plafond. Le badge reste sur « Accueil » : c'est
  // le MÊME compteur (countMyActionable), le porter deux fois afficherait deux
  // fois le même nombre côte à côte.
  { href: "/app/missions", labelKey: "bottomNav.missions", icon: ListChecksIcon, exact: false },
  { href: "/app/comptes", labelKey: "bottomNav.comptes", icon: AtSignIcon, exact: false, badgeKey: "warmupDue" },
  { href: "/app/paiements", labelKey: "bottomNav.gains", icon: WalletIcon, exact: false },
  { href: "/app/profil", labelKey: "bottomNav.profil", icon: UserIcon, exact: false },
] as const;

const OUTILS_TAB = {
  href: "/app/outils",
  labelKey: "bottomNav.outils",
  icon: WrenchIcon,
  exact: false,
} as const;
const GUIDE_TAB = {
  href: "/app/guide",
  labelKey: "bottomNav.guide",
  icon: HelpCircleIcon,
  exact: false,
} as const;
// Dépôt de contenu — Snytch uniquement (cf lib/snytch-drive), inséré après Comptes.
const FICHIERS_TAB = {
  href: "/app/fichiers",
  labelKey: "bottomNav.fichiers",
  icon: FilesIcon,
  exact: false,
} as const;
// Suivi des vidéos publiées — Snytch uniquement, inséré après Fichiers.
const VIDEOS_TAB = {
  href: "/app/videos",
  labelKey: "bottomNav.videos",
  icon: FilmIcon,
  exact: false,
} as const;

export function CreatorBottomNav({
  projectId,
  hasTools,
  showFiles,
}: {
  projectId: Id<"projects"> | null;
  hasTools: boolean;
  showFiles: boolean;
}) {
  const t = useTranslations("portal");
  const pathname = usePathname();
  // Snytch → 8 onglets (Fichiers + Vidéos insérés après Comptes) ; sinon 6.
  // Découpage par NOM et non par index nu : l'assemblage listait BASE_TABS[0..3]
  // à la main, donc insérer un onglet en amont réordonnait la barre en silence.
  const lastTab = hasTools ? OUTILS_TAB : GUIDE_TAB;
  const afterComptes =
    BASE_TABS.findIndex((t) => t.href === "/app/comptes") + 1;
  const tabs: readonly Tab[] = showFiles
    ? [
        ...BASE_TABS.slice(0, afterComptes),
        FICHIERS_TAB,
        VIDEOS_TAB,
        ...BASE_TABS.slice(afterComptes),
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
      aria-label={t("bottomNav.aria")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur supports-backdrop-filter:bg-white/80 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul
        className={cn(
          "mx-auto grid max-w-lg",
          tabs.length === 8
            ? "grid-cols-8"
            : tabs.length === 7
              ? "grid-cols-7"
              : tabs.length === 6
                ? "grid-cols-6"
                : "grid-cols-5",
        )}
      >
        {tabs.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          const count = tab.badgeKey ? badgeCount[tab.badgeKey] : 0;
          const showBadge = count > 0;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 font-medium transition-colors",
                  // À 8 onglets (Snytch), 375 px ne laisse que ~47 px par colonne :
                  // sans réduction ni bornage, les libellés DÉBORDENT de leur
                  // cellule et se collent les uns aux autres (« MissionsComptes »).
                  tabs.length >= 8 ? "text-[10px]" : "text-[11px]",
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
                {/* Borné à la cellule : un libellé trop long est COUPÉ, jamais
                    étalé sur l'onglet voisin. */}
                <span className="w-full truncate px-0.5 text-center">
                  {t(tab.labelKey)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
