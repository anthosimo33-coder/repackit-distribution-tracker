"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FlameIcon, TrendingUpIcon, TrophyIcon, type LucideIcon } from "lucide-react";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import {
  useArgentObservable,
  useMyAssignments,
  useMyViewsPulse,
  useProjectLeaderboard,
} from "@/components/portal/creator-data";
import { usePortalBase } from "@/components/portal/ViewAsContext";
import { formatViews } from "@/lib/format-rate";
import { leaderboardWindow } from "@/lib/leaderboard-window";
import { onTimeStreak } from "@/lib/on-time-streak";
import { portalHref } from "@/lib/view-as";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * LES TROIS CHIFFRES QUI MOTIVENT, EN UNE LIGNE — accueil MOBILE.
 *
 * Sur desktop, série, vues d'hier et classement ont chacun leur carte dans la
 * colonne de droite. Sur mobile, cette colonne tombait SOUS tout le reste de
 * l'écran : les chiffres qui font revenir la créatrice n'étaient visibles qu'en
 * défilant jusqu'au bout. Ici ils tiennent en pastilles sous le salut — lus en
 * un coup d'œil, sans pousser la prochaine action vers le bas.
 *
 * Chaque pastille mène à l'écran qui la détaille. Une pastille sans donnée ne
 * s'affiche pas (série < 2, rien gagné hier, pas encore classée) ; sans aucune,
 * la ligne disparaît. Le classement reste derrière le droit d'argent.
 */
type Chip = {
  key: string;
  href: string;
  icon: LucideIcon;
  label: string;
  className: string;
  iconClassName?: string;
};

export function TodayStatChips() {
  const t = useTranslations("portal");
  const loc = useIntlLocale();
  const { current } = useCreatorProject();
  const base = usePortalBase();
  const argent = useArgentObservable();
  const assignments = useMyAssignments(current.projectId);
  const pulse = useMyViewsPulse(current.projectId);
  const board = useProjectLeaderboard(current.projectId);
  const [now] = useState(() => Date.now());
  const streak = useMemo(
    () => (assignments ? onTimeStreak(assignments, now).current : 0),
    [assignments, now],
  );
  const win = argent && board ? leaderboardWindow(board, 1) : null;

  const chips: Chip[] = [];
  if (streak >= 2) {
    chips.push({
      key: "streak",
      href: portalHref(base, "/missions"),
      icon: FlameIcon,
      label: t("home.chips.streak", { count: streak }),
      className: "border-amber-200 bg-amber-50 text-amber-800",
      iconClassName: "animate-flame text-amber-600",
    });
  }
  if (pulse) {
    chips.push({
      key: "pulse",
      href: portalHref(base, "/gains"),
      icon: TrendingUpIcon,
      label: t("pulse.perVideo", { views: formatViews(pulse.views, loc) }),
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
      iconClassName: "text-emerald-600",
    });
  }
  if (win) {
    chips.push({
      key: "rank",
      href: portalHref(base, "/gains"),
      icon: TrophyIcon,
      label: t("home.rank.place", { rank: win.me.rank, total: win.total }),
      className: "border-primary/25 bg-primary/5 text-primary",
    });
  }
  if (chips.length === 0) return null;

  return (
    <div
      data-testid="today-chips"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 motion-safe:animate-in motion-safe:fade-in [&::-webkit-scrollbar]:hidden"
    >
      {chips.map((c) => {
        const Icon = c.icon;
        return (
          <Link
            key={c.key}
            href={c.href}
            data-testid={`chip-${c.key}`}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold tabular-nums transition-opacity active:opacity-70",
              c.className,
            )}
          >
            <Icon className={cn("size-4", c.iconClassName)} />
            {c.label}
          </Link>
        );
      })}
    </div>
  );
}
