"use client";

import Link from "next/link";
import { ArrowRightIcon, TrophyIcon } from "lucide-react";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import {
  useArgentObservable,
  useProjectLeaderboard,
} from "@/components/portal/creator-data";
import { usePortalBase } from "@/components/portal/ViewAsContext";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format-rate";
import { leaderboardWindow } from "@/lib/leaderboard-window";
import { portalHref } from "@/lib/view-as";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * CLASSEMENT DU CYCLE — deux formes, une seule carte.
 *
 *   - `window` (accueil) : ta place, la voisine du dessus et celle du dessous,
 *     et ce qui te sépare de la place du dessus. Voir qu'on est à 23 $ du podium
 *     donne envie de publier ; voir la liste entière, souvent l'inverse.
 *   - `full` (Gains) : tout le classement, ta ligne surlignée.
 *
 * Données : `useProjectLeaderboard` (triées, rankées, `isMe` posé côté serveur).
 * Masquée à l'observateur sans le droit « Paiements » : il y lirait les gains de
 * toute l'équipe — et la query view-as n'est de toute façon pas lancée.
 */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function RankCard({ variant }: { variant: "window" | "full" }) {
  const t = useTranslations("portal");
  const tlb = useTranslations("leaderboard");
  const loc = useIntlLocale();
  const { current } = useCreatorProject();
  const base = usePortalBase();
  const argent = useArgentObservable();
  const data = useProjectLeaderboard(current.projectId);

  if (!argent) return null;
  if (data === undefined) return <Skeleton className="h-56 w-full rounded-xl" />;
  if (data.length === 0) return null;

  const w = leaderboardWindow(data, 1);
  const rows = variant === "full" ? data : (w?.rows ?? []);

  return (
    <section
      data-testid="rank-card"
      className="rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <TrophyIcon className="size-[18px] text-primary" />
          {variant === "full" ? t("gains.rankingTitle") : t("home.rank.title")}
        </h2>
        {w && (
          <span
            data-testid="rank-place"
            className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary"
          >
            {t("home.rank.place", { rank: w.me.rank, total: w.total })}
          </span>
        )}
      </div>

      {w ? (
        <p className="mt-2 text-sm text-slate-600">
          {w.gapToAhead === null
            ? t("home.rank.first")
            : t("home.rank.gap", {
                amount: formatMoney(w.gapToAhead, current.payCurrency, loc),
              })}
        </p>
      ) : (
        // Pas encore classée : aucune place inventée, une invitation à publier.
        <p className="mt-2 text-sm text-slate-600">{tlb("publishFirst")}</p>
      )}

      {rows.length > 0 && (
        <ul className="-mx-2 mt-3 space-y-0.5">
          {rows.map((e) => (
            <li
              key={e.creatorId}
              data-testid="rank-row"
              data-me={e.isMe ? "true" : undefined}
              className={cn(
                "flex h-11 items-center gap-2.5 rounded-lg px-2",
                e.isMe && "bg-primary/5 ring-1 ring-inset ring-primary/20",
              )}
            >
              <span
                className={cn(
                  "w-5 text-sm font-bold tabular-nums",
                  e.rank <= 3 ? "text-slate-900" : "text-slate-400",
                )}
              >
                {e.rank}
              </span>
              <span
                aria-hidden
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  e.isMe ? "bg-primary text-primary-foreground" : "bg-slate-100 text-slate-600",
                )}
              >
                {initialsOf(e.name)}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  e.isMe ? "font-semibold text-slate-900" : "font-medium text-slate-700",
                )}
              >
                {e.isMe ? tlb("me") : e.name}
              </span>
              <span
                className={cn(
                  "shrink-0 text-sm font-semibold tabular-nums",
                  e.isMe ? "text-primary" : "text-slate-900",
                )}
              >
                {formatMoney(e.totalDue, current.payCurrency, loc)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {variant === "window" && (
        <Link
          href={portalHref(base, "/gains")}
          className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          {t("home.rank.seeAll")}
          <ArrowRightIcon className="size-3.5" />
        </Link>
      )}
    </section>
  );
}
