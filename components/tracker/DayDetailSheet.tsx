"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { formatNumber } from "@/lib/format";
import { isoCountryLabel } from "@/lib/country-name";
import type { TrackerQueryArgs } from "./TrackerDataView";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";

/**
 * CE QUI A FAIT LES VUES D'UN JOUR.
 *
 * La courbe dit « 540 000 vues le 1er septembre » ; ce panneau dit LESQUELLES.
 * Sans lui, un pic est un fait sans cause : on sait qu'il a eu lieu, pas ce
 * qu'il faut refaire.
 *
 * ⚠️ IL LIT LES MÊMES FILTRES QUE LA COURBE. Un détail calculé sur une autre
 * sélection afficherait un total différent du point qu'on vient de cliquer, et
 * l'écart se lirait comme un bug. La query, elle, rejoue la même répartition au
 * prorata (cf convex/viewsDaily) : le total du panneau EST le point du graphe.
 *
 * La query n'est lancée qu'à l'ouverture : recalculer le détail de chaque jour
 * d'avance coûterait un scan de snapshots par jour affiché.
 */
export function DayDetailSheet({
  day,
  queryArgs,
  onClose,
  onSelectPost,
}: {
  /** Jour « YYYY-MM-DD », ou `null` quand le panneau est fermé. */
  day: string | null;
  queryArgs: TrackerQueryArgs;
  onClose: () => void;
  onSelectPost: (id: Id<"publications">) => void;
}) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.dashboard.DayDetailSheet");
  const detail = useProjectQuery(
    api.trackerData.trackerViewsDayDetail,
    day === null ? "skip" : { filters: queryArgs, day },
  );

  return (
    <Sheet open={day !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg"
        data-testid="day-detail-sheet"
      >
        <SheetHeader className="border-b border-slate-100 p-4">
          <SheetTitle>{day === null ? "" : jourLisible(day)}</SheetTitle>
          <SheetDescription>
            {detail === undefined
              ? tr("chargement")
              : tr("vuesGagneesCeJourLa", { count: formatNumber(detail.total, loc), count2: detail.rows.length })}
          </SheetDescription>
        </SheetHeader>

        <div className="p-4">
          {detail === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : detail.rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              {tr("aucuneVueGagneeCeJour")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {detail.rows.map((r) => (
                <li key={r.publicationId as string}>
                  <button
                    type="button"
                    onClick={() => onSelectPost(r.publicationId)}
                    className="flex w-full items-start gap-3 py-2.5 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-900">
                        {r.titre?.trim() || tr("sansTitre")}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {[
                          r.compte,
                          r.creatorName,
                          r.market === null
                            ? tr("sansMarche")
                            : marcheLisible(r.market),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        {r.isWarmup ? ` ${tr("chauffe")}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 pt-0.5 text-right font-mono text-sm tabular-nums text-slate-900">
                      {formatNumber(r.value, loc)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-400">
            {tr("lesVuesDUnReleve")}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** « 2026-09-01 » → « mardi 1 septembre 2026 ». */
function jourLisible(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Un marché composé porte déjà son nom ; un code pays doit être traduit. On les
 * distingue par la longueur : les codes ISO font deux lettres.
 */
function marcheLisible(market: string): string {
  return market.length === 2 ? isoCountryLabel(market) : market;
}
