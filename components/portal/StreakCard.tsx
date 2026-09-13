"use client";

import { useMemo, useState } from "react";
import { FlameIcon } from "lucide-react";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { useMyAssignments } from "@/components/portal/creator-data";
import { AnimatedNumber } from "@/components/portal/AnimatedNumber";
import { onTimeStreak } from "@/lib/on-time-streak";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * LA SÉRIE — « 6 publications à l'heure d'affilée ».
 *
 * Calculée sur SES missions (`lib/on-time-streak`, verdict du calendrier), donc
 * juste en observation comme dans son espace : ce n'est pas de l'argent.
 *
 * Rendue à partir de 2 : une série d'une publication n'en est pas une, et une
 * carte « 0 » accueillerait chaque nouvelle créatrice par un échec. Série cassée
 * mais record ≥ 2 : on rappelle le record, pour donner envie de repartir.
 */
export function StreakCard() {
  const t = useTranslations("portal.streak");
  const { current } = useCreatorProject();
  const assignments = useMyAssignments(current.projectId);
  const [now] = useState(() => Date.now());
  const streak = useMemo(
    () => (assignments ? onTimeStreak(assignments, now) : null),
    [assignments, now],
  );
  if (!streak || (streak.current < 2 && streak.best < 2)) return null;
  const live = streak.current >= 2;

  return (
    <section
      data-testid="streak-card"
      data-count={streak.current}
      className="flex items-center gap-4 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white p-4"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
        <FlameIcon className={cn("size-6", live && "animate-flame")} />
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
          {t("label")}
        </p>
        {live ? (
          <p className="flex flex-wrap items-baseline gap-x-1.5">
            <AnimatedNumber
              value={streak.current}
              format={(n) => String(Math.round(n))}
              className="text-2xl font-bold tabular-nums text-slate-900"
            />
            <span className="text-sm text-slate-600">
              {t("inARow", { count: streak.current })}
            </span>
          </p>
        ) : (
          <p className="text-sm text-slate-600">{t("restart", { count: streak.best })}</p>
        )}
        {live && streak.best > streak.current && (
          <p className="text-xs text-slate-500">{t("best", { count: streak.best })}</p>
        )}
      </div>
    </section>
  );
}
