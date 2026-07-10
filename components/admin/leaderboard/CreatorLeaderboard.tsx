"use client";

import { CrownIcon, TrophyIcon } from "lucide-react";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatEuros } from "@/lib/format-rate";
import { formatCycleRange } from "@/lib/pay-cycle";

/**
 * Leaderboard admin des créateurs d'un projet — podium top 3 + liste (rang 4+),
 * classés sur les gains (`totalDue`) de LEUR cycle J+30 EN COURS. Source :
 * `api.payments.leaderboard` (déjà trié desc). Cycles désynchronisés (chacun
 * ancré sur son 1er post) → la fenêtre de cycle est affichée sous chaque nom.
 *
 * Accent : token `primary` (piloté par projet via AccentStyle) — JAMAIS de hex
 * en dur. Les médailles or/argent/bronze (amber/slate/orange) sont des couleurs
 * FIXES, indépendantes de l'accent projet. Theme-aware (light + dark).
 */

type Entry = {
  creatorId: Id<"creators">;
  name: string;
  totalDue: number;
  cycleStart: number;
  cycleEnd: number;
};
type Ranked = Entry & { rank: number };

/** Médailles FIXES (hors accent projet) — or / argent / bronze. */
const MEDAL: Record<
  1 | 2 | 3,
  { ring: string; badge: string; pedestal: string; label: string }
> = {
  1: {
    ring: "ring-amber-400",
    badge: "bg-amber-500",
    pedestal: "bg-amber-400",
    label: "1er",
  },
  2: {
    ring: "ring-slate-400",
    badge: "bg-slate-500",
    pedestal: "bg-slate-400",
    label: "2e",
  },
  3: {
    ring: "ring-orange-600",
    badge: "bg-orange-700",
    pedestal: "bg-orange-600",
    label: "3e",
  },
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (
    parts[0].charAt(0) + parts[parts.length - 1].charAt(0)
  ).toUpperCase();
}

/** Avatar initiales sur fond d'accent projet (`primary`). Recopié de ProjectAvatar. */
function CreatorAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

export function CreatorLeaderboard() {
  const data = useProjectQuery(api.payments.leaderboard, {});

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Classement du cycle
        </h2>
        <p className="text-sm text-muted-foreground">
          Gains du cycle en cours de chaque créateur (fenêtre J+30 personnelle,
          ancrée sur son premier post).
        </p>
      </div>
      {data === undefined ? (
        <LeaderboardSkeleton />
      ) : data.length === 0 ? (
        <EmptyLeaderboard />
      ) : (
        <LeaderboardContent entries={data} />
      )}
    </section>
  );
}

function LeaderboardContent({ entries }: { entries: Entry[] }) {
  const ranked: Ranked[] = entries.map((e, i) => ({ ...e, rank: i + 1 }));
  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  // Ordre à l'écran : 2e à gauche, 1er au centre, 3e à droite. filter(Boolean)
  // gère < 3 créateurs sans trou cassé.
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(
    Boolean,
  ) as Ranked[];

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex items-end justify-center gap-3 pt-2 sm:gap-8">
          {podiumOrder.map((e) => (
            <PodiumSpot key={e.creatorId} entry={e} />
          ))}
        </CardContent>
      </Card>

      {rest.length > 0 && (
        <Card>
          <CardContent className="p-2">
            <ul className="divide-y divide-border">
              {rest.map((e) => (
                <ListRow key={e.creatorId} entry={e} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PodiumSpot({ entry }: { entry: Ranked }) {
  const m = MEDAL[entry.rank as 1 | 2 | 3];
  // Pédestal décroissant 1 > 2 > 3 ; items-end aligne les bases → le 1er culmine.
  const pedestalH =
    entry.rank === 1 ? "h-24" : entry.rank === 2 ? "h-16" : "h-12";

  return (
    <div className="flex w-24 flex-col items-center sm:w-28">
      {/* Couronne (1er only) — hauteur réservée pour tous → avatars alignés. */}
      <div className="flex h-6 items-end">
        {entry.rank === 1 && (
          <CrownIcon className="size-6 fill-amber-400 text-amber-400" />
        )}
      </div>

      {/* Avatar + anneau médaille + badge de rang chevauchant le bas. */}
      <div className="relative mt-1">
        <CreatorAvatar
          name={entry.name}
          className={cn(
            "size-16 text-lg ring-2 ring-offset-2 ring-offset-background",
            m.ring,
          )}
        />
        <span
          className={cn(
            "absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-sm",
            m.badge,
          )}
        >
          {m.label}
        </span>
      </div>

      <p className="mt-4 line-clamp-1 text-center text-sm font-semibold text-foreground">
        {entry.name}
      </p>
      <p className="text-sm font-bold tabular-nums text-foreground">
        {formatEuros(entry.totalDue)}
      </p>
      {/* Fenêtre de cycle — obligatoire (mitigation de la désynchro). */}
      <p className="mt-0.5 line-clamp-1 text-center text-[11px] text-muted-foreground">
        {formatCycleRange(entry.cycleStart, entry.cycleEnd)}
      </p>

      {/* Pédestal — gros numéro de rang. */}
      <div
        className={cn(
          "mt-3 flex w-full items-start justify-center rounded-t-lg pt-2 text-2xl font-black text-white/90",
          pedestalH,
          m.pedestal,
        )}
      >
        {entry.rank}
      </div>
    </div>
  );
}

function ListRow({ entry }: { entry: Ranked }) {
  return (
    <li className="flex items-center gap-3 p-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
        {entry.rank}
      </span>
      <CreatorAvatar name={entry.name} className="size-9 text-xs" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {entry.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatCycleRange(entry.cycleStart, entry.cycleEnd)}
        </p>
      </div>
      <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
        {formatEuros(entry.totalDue)}
      </span>
    </li>
  );
}

function EmptyLeaderboard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <TrophyIcon
          className="size-12 text-muted-foreground/40"
          strokeWidth={1.5}
        />
        <p className="text-sm text-muted-foreground">
          Aucune créatrice n&apos;a encore publié ce cycle.
        </p>
      </CardContent>
    </Card>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex items-end justify-center gap-3 pt-2 sm:gap-8">
          {[
            { w: "h-16" as const, order: 0 },
            { w: "h-24" as const, order: 1 },
            { w: "h-12" as const, order: 2 },
          ].map((s) => (
            <div
              key={s.order}
              className="flex w-24 flex-col items-center gap-2 sm:w-28"
            >
              <Skeleton className="mt-7 size-16 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className={cn("w-full rounded-t-lg", s.w)} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
