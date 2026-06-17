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
  WalletIcon,
  UserIcon,
  HelpCircleIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * Barre d'onglets MOBILE du portail créateur (style app native, au pouce).
 * Visible < md uniquement (le desktop garde la nav du header). Onglet actif en
 * accent orange ; badge sur « Accueil » = nb de vidéos « à publier » (to_publish,
 * réutilise countMyToPublish). Fixe en bas, safe-area iOS gérée.
 */
const TABS: { href: string; label: string; icon: LucideIcon; exact: boolean; badge?: boolean }[] = [
  { href: "/app", label: "Accueil", icon: HomeIcon, exact: true, badge: true },
  { href: "/app/comptes", label: "Comptes", icon: AtSignIcon, exact: false },
  { href: "/app/paiements", label: "Gains", icon: WalletIcon, exact: false },
  { href: "/app/profil", label: "Profil", icon: UserIcon, exact: false },
  { href: "/app/guide", label: "Guide", icon: HelpCircleIcon, exact: false },
];

export function CreatorBottomNav({
  projectId,
}: {
  projectId: Id<"projects"> | null;
}) {
  const pathname = usePathname();
  const toPublish =
    useQuery(
      api.assignments.countMyToPublish,
      projectId ? { projectId } : "skip",
    ) ?? 0;

  return (
    <nav
      aria-label="Navigation portail"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur supports-backdrop-filter:bg-white/80 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map((t) => {
          const active = t.exact
            ? pathname === t.href
            : pathname.startsWith(t.href);
          const Icon = t.icon;
          const showBadge = t.badge && toPublish > 0;
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
                      {toPublish}
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
