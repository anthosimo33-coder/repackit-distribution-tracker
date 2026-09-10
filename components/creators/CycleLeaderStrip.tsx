"use client";

import { useState } from "react";
import { ChevronDownIcon, TrophyIcon } from "lucide-react";
import {
  LeaderboardSection,
  type LeaderboardEntry,
} from "@/components/admin/leaderboard/CreatorLeaderboard";
import { formatMoney } from "@/lib/format-rate";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * TÊTE DU CYCLE — le podium replié en une ligne.
 *
 * ─── POURQUOI REPLIER ────────────────────────────────────────────────────────
 * Le podium occupait ~470 px avant la première ligne de la liste : sur l'écran
 * d'un projet de dix-sept créatrices, on ouvrait « Créateurs » et on ne voyait
 * aucune créatrice. Pire, il rendait DEUX FOIS les mêmes personnes — podium plus
 * rang 4+, puis le tableau juste dessous, dans un autre ordre et un autre
 * langage visuel.
 *
 * Le classement n'est pas supprimé pour autant : il est ici en une ligne (les
 * trois de tête, l'information qu'on regarde vraiment en passant), et le
 * podium complet reste à un clic. Les GAINS, eux, redescendent dans le tableau
 * en tant que colonne — c'est là qu'ils se comparent ligne à ligne.
 *
 * ─── UNE SEULE LECTURE POUR DEUX USAGES ──────────────────────────────────────
 * `data` est fournie par l'appelant (`CreatorsDirectory`), qui s'en sert aussi
 * pour la colonne « Gains du cycle ». Refaire `useProjectQuery` ici lancerait la
 * même query deux fois sur le même écran.
 */
export function CycleLeaderStrip({
  data,
  currency,
}: {
  data: LeaderboardEntry[] | undefined;
  /** Devise de la PAIE créatrices (dollars). Absente ⇒ montant sans symbole. */
  currency?: string | null;
}) {
  const [ouvert, setOuvert] = useState(false);

  if (data === undefined) {
    return <Skeleton className="h-12 w-full rounded-xl" />;
  }
  // Aucun classement (personne n'a encore publié) : pas de bandeau vide. La
  // liste en dessous dit déjà tout ce qu'il y a à dire.
  if (data.length === 0) return null;

  const top = data.slice(0, 3);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white">
      <div className="flex items-stretch">
        <div className="flex shrink-0 items-center gap-2 border-r border-slate-200 px-3.5 py-2.5 text-xs font-semibold text-slate-600">
          <TrophyIcon className="size-3.5 text-amber-500" />
          <span className="hidden sm:inline">Tête du cycle</span>
        </div>
        <ul className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto px-4 py-2">
          {top.map((e) => (
            <li
              key={e.creatorId}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap"
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white tabular-nums",
                  // Médailles FIXES (or/argent/bronze), indépendantes de
                  // l'accent projet — même convention que le podium.
                  e.rank === 1
                    ? "bg-amber-500"
                    : e.rank === 2
                      ? "bg-slate-400"
                      : "bg-orange-700",
                )}
              >
                {e.rank}
              </span>
              <span className="text-sm font-medium text-slate-800">
                {e.name}
              </span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">
                {formatMoney(e.totalDue, currency)}
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setOuvert((o) => !o)}
          aria-expanded={ouvert}
          className="flex shrink-0 items-center gap-1.5 border-l border-slate-200 px-3.5 py-2.5 text-xs font-medium text-primary transition-colors hover:bg-slate-50"
        >
          {ouvert ? "Replier" : "Classement complet"}
          <ChevronDownIcon
            className={cn(
              "size-3.5 transition-transform",
              ouvert && "rotate-180",
            )}
          />
        </button>
      </div>
      {ouvert && (
        <div className="border-t border-slate-200 bg-white p-4">
          <LeaderboardSection data={data} currency={currency} />
        </div>
      )}
    </div>
  );
}
