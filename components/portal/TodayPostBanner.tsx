"use client";

import Link from "next/link";
import { formatPostWindow } from "@/convex/postWindow";
import { ArrowRightIcon, CalendarCheckIcon, SendIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Id } from "@/convex/_generated/dataModel";
import { portalHref } from "@/lib/view-as";
import {
  calendarStatus,
  isSameLocalDay,
  representativePostedAt,
} from "@/lib/calendar-status";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";

type BannerRow = {
  _id: Id<"assignments">;
  formatName: string;
  postDate?: number;
  postWindow?: { startMin: number; endMin: number };
  managedByAdmin?: boolean;
  targets: { platform: string; publishedAt?: number | null }[];
  publishedAt?: number | null;
};

function longDate(ts: number, locale: string): string {
  return new Date(ts).toLocaleDateString(locale, {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

/**
 * Bandeau « Aujourd'hui tu postes : [format] » en tête du dashboard créatrice —
 * LA réponse à « je poste quoi aujourd'hui ? ». Ne concerne que SES posts (non
 * gérés par l'équipe) planifiés AUJOURD'HUI et pas encore publiés. Sinon état vide
 * clair (« rien à poster aujourd'hui » + prochain post). Rendu null si aucune
 * publication n'est planifiée du tout. Statut via lib/calendar-status (identique
 * au pilotage admin). Clic → brief de la mission.
 */
export function TodayPostBanner({
  list,
  now,
  base,
}: {
  list: BannerRow[];
  now: number;
  base: string;
}) {
  const loc = useIntlLocale();
  const t = useTranslations("portal");
  const mine = list.filter((a) => !a.managedByAdmin && a.postDate != null);
  if (mine.length === 0) return null;

  const isScheduled = (a: BannerRow) =>
    calendarStatus({
      postDate: a.postDate,
      postedAt: representativePostedAt(a),
      now,
    }) === "scheduled";

  const today = mine.filter(
    (a) => isScheduled(a) && isSameLocalDay(a.postDate!, now),
  );
  const next = mine
    .filter((a) => isScheduled(a) && !isSameLocalDay(a.postDate!, now))
    .sort((x, y) => x.postDate! - y.postDate!)[0];

  if (today.length > 0) {
    return (
      <Card className="border-primary/40 bg-primary/5" data-testid="today-post-banner">
        <CardContent className="p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
            <SendIcon className="size-4" />
            Aujourd&apos;hui tu postes
          </div>
          <ul className="space-y-1.5">
            {today.map((a) => (
              <li key={a._id}>
                <Link
                  href={portalHref(base, `/assignments/${a._id}`)}
                  className="flex items-center gap-3 rounded-lg border border-primary/20 bg-white px-3 py-2 transition-colors hover:border-primary/40"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900">
                    {a.formatName}
                    {/* Plage horaire : rendue SEULEMENT si elle existe. Sans elle
                        (cas des assignations d'avant le champ), la ligne reste
                        strictement identique à avant — pas de tiret orphelin. */}
                    {formatPostWindow(a.postWindow) !== null && (
                      <span className="ml-2 font-normal text-primary">
                        entre {formatPostWindow(a.postWindow)!.replace("-", " et ")}
                      </span>
                    )}
                  </span>
                  {a.targets.length > 0 && (
                    <span className="shrink-0 font-mono text-xs text-slate-400">
                      {a.targets.map((t) => t.platform).join(" · ")}
                    </span>
                  )}
                  <ArrowRightIcon className="size-4 shrink-0 text-primary" />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="today-post-banner">
      <CardContent className="flex items-center gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
          <CalendarCheckIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-slate-900">
            Rien à poster aujourd&apos;hui.
          </p>
          {next ? (
            <p className="text-slate-500">
              Prochain post{" "}
              <span className="font-medium capitalize">
                {longDate(next.postDate!, loc)}
              </span>{" "}
              {formatPostWindow(next.postWindow) !== null
                ? ` entre ${formatPostWindow(next.postWindow)!.replace("-", " et ")}`
                : ""}{" "}
              : {next.formatName}.
            </p>
          ) : (
            <p className="text-slate-500">{t("todayPost.empty")}</p>
          )}
        </div>
        {next && (
          <Link
            href={portalHref(base, `/assignments/${next._id}`)}
            aria-label={t("todayPost.seeNext")}
            className="shrink-0 text-primary"
          >
            <ArrowRightIcon className="size-4" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
