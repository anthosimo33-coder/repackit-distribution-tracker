"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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
  EllipsisIcon,
  ChevronRightIcon,
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
 * Dernier onglet selon le projet :
 *   - projet AVEC outils → « Outils » (page /app/outils qui liste les outils) ;
 *     « Guide » est alors déplacé dans le header mobile (cf app/app/layout).
 *   - projet SANS outils → « Guide » reste ici (aucune réorganisation) : pas
 *     d'onglet Outils vide.
 *
 * ─── DÉBORDEMENT : « Plus » ──────────────────────────────────────────────────
 * Snytch a deux écrans de plus (Fichiers, Vidéos). Les poser en onglets portait
 * la barre à HUIT colonnes : 47 px chacune sur un écran de 375 px, et « Comptes »
 * — un onglet quotidien — se coupait en « Compt… ». Un libellé tronqué sur une
 * destination utilisée tous les jours est une régression, pas un compromis.
 *
 * Ces deux écrans passent donc derrière une entrée « Plus », qui ouvre une
 * feuille par le bas. La barre reste à SEPT colonnes au maximum, comme avant
 * l'ajout de « Missions » — un format déjà éprouvé sur ce projet.
 *
 * L'entrée « Plus » est ACTIVE quand on se trouve sur l'un des écrans qu'elle
 * contient : sinon la barre n'indiquerait plus où on est dès qu'on y navigue.
 */
/** Géométrie COMMUNE d'une cellule de la barre — onglet comme entrée « Plus ».
 *  Deux définitions feraient boiter la barre d'une cellule. */
const TAB_CLASS =
  "relative flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors";

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
// Écrans de DÉBORDEMENT — Snytch uniquement (cf lib/snytch-drive). Ils ne sont
// plus des onglets : ils vivent derrière « Plus » (cf l'en-tête de ce fichier).
const OVERFLOW_ITEMS = [
  {
    href: "/app/fichiers",
    labelKey: "bottomNav.fichiers",
    icon: FilesIcon,
  },
  {
    href: "/app/videos",
    labelKey: "bottomNav.videos",
    icon: FilmIcon,
  },
] as const;

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
  // 6 onglets partout ; 7 sur Snytch, où le 7ᵉ est « Plus » (Fichiers + Vidéos).
  const lastTab = hasTools ? OUTILS_TAB : GUIDE_TAB;
  const tabs: readonly Tab[] = [...BASE_TABS, lastTab];
  const overflow = showFiles ? OVERFLOW_ITEMS : [];
  const overflowActive = overflow.some((it) => pathname.startsWith(it.href));
  // Nombre de colonnes = onglets + l'entrée « Plus » si le projet en a besoin.
  // Table EXPLICITE : Tailwind ne peut pas générer `grid-cols-${n}` à la volée
  // (les classes sont extraites du source), et une classe absente ferait
  // silencieusement retomber la barre sur une seule colonne.
  const colCount = tabs.length + (overflow.length > 0 ? 1 : 0);
  const gridCols =
    colCount === 7
      ? "grid-cols-7"
      : colCount === 6
        ? "grid-cols-6"
        : "grid-cols-5";
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
        className={cn("mx-auto grid max-w-lg", gridCols)}
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
                  TAB_CLASS,
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
        {overflow.length > 0 && (
          <li>
            <Sheet>
              <SheetTrigger
                render={
                  <button
                    type="button"
                    data-testid="bottom-nav-more"
                    aria-current={overflowActive ? "page" : undefined}
                    className={cn(
                      TAB_CLASS,
                      overflowActive
                        ? "text-primary"
                        : "text-slate-500 hover:text-slate-900",
                    )}
                  />
                }
              >
                <span className="relative">
                  <EllipsisIcon
                    className="size-6"
                    strokeWidth={overflowActive ? 2.4 : 2}
                  />
                </span>
                <span className="w-full truncate px-0.5 text-center">
                  {t("bottomNav.more")}
                </span>
              </SheetTrigger>
              <SheetContent side="bottom" className="gap-0 p-0">
                <SheetHeader className="border-b border-slate-100 p-4">
                  <SheetTitle>{t("bottomNav.moreTitle")}</SheetTitle>
                </SheetHeader>
                <ul className="p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
                  {overflow.map((it) => {
                    const Icon = it.icon;
                    const active = pathname.startsWith(it.href);
                    return (
                      <li key={it.href}>
                        {/* SheetClose n'enveloppe pas le lien : la feuille se
                            ferme d'elle-même à la navigation (démontage), et
                            l'imbriquer ferait un bouton dans un lien. */}
                        <Link
                          href={it.href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex h-14 items-center gap-3 rounded-lg px-3 text-base font-medium transition-colors",
                            active
                              ? "bg-primary/5 text-primary"
                              : "text-slate-700 hover:bg-slate-50",
                          )}
                        >
                          <Icon className="size-5 shrink-0" />
                          <span className="flex-1">{t(it.labelKey)}</span>
                          <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </SheetContent>
            </Sheet>
          </li>
        )}
      </ul>
    </nav>
  );
}
