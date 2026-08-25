"use client";

import Link from "next/link";
import { AlertTriangleIcon, ArrowRightIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { portalHref } from "@/lib/view-as";
import { formatDate } from "@/lib/format";
import { isToCatchUp, sortBySchedule } from "@/lib/creator-schedule";
import { formatPostWindow } from "@/convex/postWindow";
import { representativePostedAt } from "@/lib/calendar-status";
import { useIntlLocale } from "@/lib/use-intl-locale";

/**
 * « À RATTRAPER » — les publications dont la date est passée sans que rien ne
 * soit sorti.
 *
 * Placée AU-DESSUS de « Aujourd'hui tu postes » : un retard qu'on découvre sous
 * la tâche du jour est un retard qui reste en retard. L'ordre est strict et le
 * plus ancien vient en premier — celui qu'on a le plus laissé filer.
 *
 * ⚠️ Le mot compte. « À rattraper » et non « En retard » : ce dernier est DÉJÀ
 * pris par l'échéance de PRODUCTION (badge rose, lib/assignment-status). Ici on
 * parle de PUBLICATION. Une vidéo peut être tournée à temps et pas postée.
 *
 * AUCUNE re-planification : la date d'origine reste affichée telle quelle. Si
 * l'admin veut replanifier, il le fait au drag depuis son calendrier — l'espace
 * créatrice ne réécrit jamais une date.
 */
/** MÊME forme que BannerRow (TodayPostBanner) : les deux lisent la même liste. */
export type CatchUpRow = {
  _id: string;
  formatName: string;
  managedByAdmin?: boolean;
  postDate?: number;
  postWindow?: { startMin: number; endMin: number };
  publishedAt?: number | null;
  targets: { platform: string; publishedAt?: number | null }[];
};

export function CatchUpBanner({
  list,
  now,
  base,
}: {
  list: CatchUpRow[];
  now: number;
  base: string;
}) {
  const loc = useIntlLocale();
  // Comptes gérés exclus : la créatrice n'y publie pas, l'équipe s'en charge —
  // lui réclamer un rattrapage qu'elle ne peut pas faire serait absurde.
  const retards = sortBySchedule(
    list
      .filter((a) => !a.managedByAdmin)
      .filter((a) =>
        isToCatchUp(
          {
            postDate: a.postDate,
            postWindow: a.postWindow,
            publishedAt: representativePostedAt(a),
          },
          now,
        ),
      ),
    now,
  );

  if (retards.length === 0) return null;

  return (
    <Card
      className="border-rose-300 bg-rose-50/60"
      data-testid="catch-up-banner"
    >
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-700">
          <AlertTriangleIcon className="size-4" />À rattraper
          <span className="rounded-full border border-rose-300 bg-rose-100 px-1.5 text-xs font-medium">
            {retards.length}
          </span>
        </div>
        <ul className="space-y-1.5">
          {retards.map((a) => {
            const plage = formatPostWindow(a.postWindow);
            return (
              <li key={a._id}>
                <Link
                  href={portalHref(base, `/assignments/${a._id}`)}
                  className="flex items-center gap-3 rounded-lg border border-rose-200 bg-white px-3 py-2 transition-colors hover:border-rose-400"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">
                      {a.formatName}
                    </span>
                    {/* La date d'ORIGINE, jamais une date recalculée : elle dit
                        depuis quand ça traîne. La plage n'est rendue que si elle
                        existe (assignations d'avant le champ : rien d'affiché). */}
                    <span className="block text-xs text-rose-700">
                      Prévu le {formatDate(a.postDate!, loc)}
                      {plage !== null ? ` (${plage})` : ""} — à publier dès que
                      possible
                    </span>
                  </span>
                  <ArrowRightIcon className="size-4 shrink-0 text-rose-600" />
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
