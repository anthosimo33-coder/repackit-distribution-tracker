"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AtSignIcon,
  EyeIcon,
  FilmIcon,
  HelpCircleIcon,
  HomeIcon,
  LogOutIcon,
  UserIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { isSnytchProject } from "@/lib/snytch-drive";
import { AccentStyle } from "@/components/project/AccentStyle";
import { SidebarItem } from "@/components/layout/SidebarItem";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { useViewAs } from "@/components/portal/ViewAsContext";
import { useActionable, useWarmupDue } from "@/components/portal/creator-data";
import { TalentProjectProvider } from "@/components/talent/TalentProjectProvider";
import { ClipperProjectProvider } from "@/components/clip/ClipperProjectProvider";
import { portalHref } from "@/lib/view-as";
import { ViewAsLocale } from "@/components/portal/ViewAsLocale";
import { useTranslations } from "next-intl";
import type { AbstractIntlMessages } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * Admin « voir l'espace d'un créateur » (LECTURE SEULE) — SHELL du mode vue.
 *
 * Rend les écrans du portail RÉUTILISÉS dans une coque qui imite celle de la
 * personne observée, MAIS :
 *   - un BANDEAU PERSISTANT en tête de TOUS les écrans rend le mode visuellement
 *     évident — « Tu regardes l'espace de <créateur> (lecture seule) » + Quitter ;
 *   - aucune action de session (pas de déconnexion : l'admin reste lui-même, on
 *     ne prend jamais la session du créateur) ni de switcher de projet ;
 *   - les liens de nav pointent vers la base view-as (portalHref) et non /app.
 * Quitter ramène à la fiche admin du créateur.
 *
 * TROIS COQUES, une par population, parce que les trois portails RÉELS n'ont pas
 * la même forme : le partenaire a une nav (5 à 6 entrées), le talent et le
 * clippeur n'en ont aucune — leur espace tient sur une page qui défile. Rendre la
 * nav partenaire autour de l'écran d'un talent recréerait exactement ce que #45 a
 * corrigé : une coque qui annonce des écrans qui n'existent pas chez lui.
 *
 * Chaque coque déclare AUSSI les sous-chemins qui existent dans son espace, à
 * côté de sa nav — les deux listes disent la même chose et ne peuvent donc pas
 * diverger. Une URL hors de cette liste (tapée, mise en favori) rend un panneau
 * qui le dit, jamais l'écran d'une autre population.
 */
type NavItem = {
  sub: string;
  /**
   * Clés du portail RÉEL, réutilisées telles quelles : cette nav est la réplique
   * read-only de `CreatorSidebar` / `CreatorBottomNav`, c'est le MÊME élément
   * d'interface. Ce n'est pas la réutilisation opportuniste que la doctrine
   * interdit — les deux navs ne peuvent pas diverger sans que la preview cesse
   * de montrer ce qu'elle prétend montrer.
   */
  labelKey: string;
  shortLabelKey: string;
  icon: LucideIcon;
  exact: boolean;
  badge?: "actionable" | "warmupDue";
};

const NAV: NavItem[] = [
  { sub: "/", labelKey: "sidebar.dashboard", shortLabelKey: "bottomNav.home", icon: HomeIcon, exact: true, badge: "actionable" },
  { sub: "/comptes", labelKey: "sidebar.comptes", shortLabelKey: "bottomNav.comptes", icon: AtSignIcon, exact: false, badge: "warmupDue" },
  { sub: "/paiements", labelKey: "sidebar.paiements", shortLabelKey: "bottomNav.gains", icon: WalletIcon, exact: false },
  { sub: "/profil", labelKey: "sidebar.profil", shortLabelKey: "bottomNav.profil", icon: UserIcon, exact: false },
  { sub: "/guide", labelKey: "sidebar.guide", shortLabelKey: "bottomNav.guide", icon: HelpCircleIcon, exact: false },
];

/** Suivi vidéos — Snytch uniquement, inséré après « Mes paiements » (lecture seule). */
const VIDEOS_NAV: NavItem = {
  sub: "/videos",
  labelKey: "sidebar.videos",
  shortLabelKey: "bottomNav.videos",
  icon: FilmIcon,
  exact: false,
};

/** Aiguillage sur la population observée. Hors mode vue → coque partenaire. */
type ShellProps = {
  children: React.ReactNode;
  /** Langue de la personne OBSERVÉE, résolue côté serveur (cf le layout). */
  locale: Locale;
  /** Catalogue correspondant, monté autour de la nav et du contenu. */
  messages: AbstractIntlMessages;
};

export function ViewAsShell({ children, locale, messages }: ShellProps) {
  const viewAs = useViewAs();
  const inner = { locale, messages };
  switch (viewAs?.creatorKind) {
    case "talent":
      return <TalentViewShell {...inner}>{children}</TalentViewShell>;
    case "clipper":
      return <ClipperViewShell {...inner}>{children}</ClipperViewShell>;
    default:
      return <PartnerViewShell {...inner}>{children}</PartnerViewShell>;
  }
}

/**
 * Bandeau de mode — commun aux trois coques. C'est le seul élément qui doit être
 * rendu quoi qu'il arrive, y compris sur un écran hors périmètre : un admin qui
 * ne voit plus le bandeau ne sait plus qu'il observe.
 */
function ViewAsBanner() {
  const viewAs = useViewAs();
  const projectPath = useProjectPath();
  const { current } = useCreatorProject();
  const creatorName = viewAs?.creatorName ?? current.creatorName ?? "ce créateur";
  // Quitter → fiche admin du créateur (point d'entrée du mode vue).
  const exitHref = viewAs
    ? projectPath(`/createurs/${viewAs.creatorId}`)
    : projectPath("/createurs");

  return (
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
  );
}

/**
 * Écran demandé qui n'existe PAS dans l'espace de la personne observée.
 *
 * On le DIT, on ne redirige pas : une redirection efface l'information et se lit
 * comme un bug de navigation. Même principe que l'abstention de #45, à la maille
 * de l'écran plutôt que du mode.
 */
function ScreenOutsideSpace({ base }: { base: string }) {
  const viewAs = useViewAs();
  return (
    <div className="mx-auto max-w-md space-y-3 py-12 text-center">
      <p className="text-sm font-medium text-slate-900">
        Cet écran n&apos;existe pas dans son espace.
      </p>
      <p className="text-sm text-slate-500">
        {viewAs?.creatorName ?? "Cette personne"} n&apos;a pas cette page — son
        espace n&apos;a pas la même forme que celui d&apos;un créateur
        partenaire.
      </p>
      <Link
        href={base}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        Revenir à son espace
      </Link>
    </div>
  );
}

/** Coque nue des espaces TALENT et CLIPPEUR : bandeau + conteneur, aucune nav —
 *  c'est exactement la forme de leurs portails réels (/talent, /clip). */
function BarePortalShell({
  accent,
  locale,
  messages,
  children,
}: {
  accent: string;
  locale: Locale;
  messages: AbstractIntlMessages;
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-screen bg-slate-50"
      style={{ "--primary": accent, "--ring": accent } as React.CSSProperties}
    >
      <AccentStyle accent={accent} />
      {/* Bandeau HORS du provider : il s'adresse à l'admin qui observe. */}
      <ViewAsBanner />
      <ViewAsLocale locale={locale} messages={messages}>
        <main className="overflow-x-hidden">
          <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
            {children}
          </div>
        </main>
      </ViewAsLocale>
    </div>
  );
}

/** Sous-chemin courant relatif à la base d'observation ("" à la racine). */
function useSubPath(base: string): string {
  const pathname = usePathname();
  if (!pathname.startsWith(base)) return "";
  const sub = pathname.slice(base.length);
  return sub === "/" ? "" : sub;
}

/**
 * TALENT — un seul écran, comme /talent. Tout autre sous-chemin est hors de son
 * espace (il n'a ni comptes, ni paiements, ni progression).
 */
function TalentViewShell({ children, locale, messages }: ShellProps) {
  const { current } = useCreatorProject();
  const viewAs = useViewAs();
  const base = viewAs?.basePath ?? "/app";
  const sub = useSubPath(base);
  const accent = current.accentColor || "#FF5200";

  return (
    <BarePortalShell accent={accent} locale={locale} messages={messages}>
      {sub === "" ? (
        <TalentProjectProvider projectId={current.projectId}>
          {children}
        </TalentProjectProvider>
      ) : (
        <ScreenOutsideSpace base={base} />
      )}
    </BarePortalShell>
  );
}

/**
 * CLIPPEUR — l'espace (racine) et la fiche d'un clip, comme /clip et
 * /clip/clips/[id]. Rien d'autre.
 */
function ClipperViewShell({ children, locale, messages }: ShellProps) {
  const { current } = useCreatorProject();
  const viewAs = useViewAs();
  const base = viewAs?.basePath ?? "/app";
  const sub = useSubPath(base);
  const accent = current.accentColor || "#FF5200";
  const known = sub === "" || sub.startsWith("/clips/");

  return (
    <BarePortalShell accent={accent} locale={locale} messages={messages}>
      {known ? (
        <ClipperProjectProvider projectId={current.projectId}>
          {children}
        </ClipperProjectProvider>
      ) : (
        <ScreenOutsideSpace base={base} />
      )}
    </BarePortalShell>
  );
}

/**
 * Les deux navs vivent dans des composants SÉPARÉS, et ce n'est pas cosmétique :
 * `useTranslations` rend la langue du provider le plus proche AU MOMENT où le
 * hook s'exécute. Appelé dans le corps de `PartnerViewShell`, il serait au-dessus
 * de `ViewAsLocale` et rendrait donc la langue de l'ADMIN — exactement le défaut
 * qu'on corrige. Monté dessous, il rend celle de la personne observée.
 */
type NavRenderProps = {
  items: NavItem[];
  base: string;
  isActive: (item: NavItem) => boolean;
  badgeCount: { actionable: number; warmupDue: number };
};

function SideNav({ items, base, isActive, badgeCount }: NavRenderProps) {
  const t = useTranslations("portal");
  // Les clés de la table sont des `string` : une table de données ne peut pas se
  // typer contre le catalogue sans importer next-intl. Même compromis, documenté,
  // que `lib/use-label` — une clé fautive se voit à l'exécution, pas à la compilation.
  const k = (key: string) => t(key as Parameters<typeof t>[0]);
  return (
    <nav
      aria-label={t("sidebar.aria")}
      className="flex-1 space-y-1 overflow-y-auto px-3 py-4"
    >
      {items.map((it) => (
        <SidebarItem
          key={it.sub}
          icon={it.icon}
          label={k(it.labelKey)}
          href={portalHref(base, it.sub)}
          isActive={isActive(it)}
          isCollapsed={false}
          badge={it.badge ? badgeCount[it.badge] : undefined}
        />
      ))}
    </nav>
  );
}

function BottomNav({ items, base, isActive, badgeCount }: NavRenderProps) {
  const t = useTranslations("portal");
  const k = (key: string) => t(key as Parameters<typeof t>[0]);
  return (
    <nav
      aria-label={t("bottomNav.aria")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur supports-backdrop-filter:bg-white/80 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul
        className={cn(
          "mx-auto grid max-w-lg",
          items.length === 6 ? "grid-cols-6" : "grid-cols-5",
        )}
      >
        {items.map((it) => {
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
                {k(it.shortLabelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** PARTENAIRE — la coque historique (sidebar desktop / bottom nav mobile). */
function PartnerViewShell({ children, locale, messages }: ShellProps) {
  const pathname = usePathname();
  const { current } = useCreatorProject();
  const viewAs = useViewAs();

  const accent = current.accentColor || "#FF5200";
  const accentVars = {
    "--primary": accent,
    "--ring": accent,
  } as React.CSSProperties;

  const base = viewAs?.basePath ?? "/app";

  const actionable = useActionable(current.projectId) ?? 0;
  const warmupDue = useWarmupDue(current.projectId) ?? 0;
  const badgeCount = { actionable, warmupDue };
  // « Mes vidéos » réservé à Snytch (comme dans le portail créateur normal).
  const navItems = isSnytchProject(current.slug)
    ? [...NAV.slice(0, 3), VIDEOS_NAV, ...NAV.slice(3)]
    : NAV;

  function isActive(item: NavItem) {
    const href = portalHref(base, item.sub);
    return item.exact ? pathname === href : pathname.startsWith(href);
  }

  return (
    <div className="min-h-screen bg-slate-50" style={accentVars}>
      <AccentStyle accent={accent} />

      {/* BANDEAU DE MODE — persistant, et HORS du provider de langue : il
          s'adresse à l'admin qui observe, pas à la personne observée. */}
      <ViewAsBanner />

      <ViewAsLocale locale={locale} messages={messages}>
      <div className="md:flex">
        {/* Sidebar DESKTOP (≥ md) — réplique read-only de CreatorSidebar. */}
        <aside className="hidden h-[calc(100vh-49px)] w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:sticky md:top-[49px] md:flex">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 px-4">
            <span className="truncate text-sm font-semibold text-slate-900">
              {current.name}
            </span>
          </div>
          <SideNav
            items={navItems}
            base={base}
            isActive={isActive}
            badgeCount={badgeCount}
          />
        </aside>

        <main className="flex-1 overflow-x-hidden">
          <div className="container mx-auto px-4 py-6 pb-24 sm:px-6 sm:py-8 md:pb-8">
            {children}
          </div>
        </main>
      </div>

      {/* Bottom tab bar MOBILE (< md) — réplique read-only de CreatorBottomNav. */}
      <BottomNav
        items={navItems}
        base={base}
        isActive={isActive}
        badgeCount={badgeCount}
      />
      </ViewAsLocale>
    </div>
  );
}
