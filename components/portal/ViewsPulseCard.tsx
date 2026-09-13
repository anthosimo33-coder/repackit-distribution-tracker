"use client";

import { TrendingUpIcon } from "lucide-react";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { useMyViewsPulse } from "@/components/portal/creator-data";
import { AnimatedNumber } from "@/components/portal/AnimatedNumber";
import { formatViews } from "@/lib/format-rate";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useTranslations } from "next-intl";

/**
 * « HIER : +4 200 VUES SUR TES VIDÉOS » — ses vidéos vivent pendant qu'elle dort.
 *
 * Le chiffre vient des relevés de vues quotidiens (`getMyViewsPulse`, même
 * répartition que le Tracker). Rien gagné hier, ou rien en ligne : la carte ne
 * s'affiche pas — on ne montre jamais « +0 ».
 *
 * Quand un relevé a manqué, la valeur est une estimation au prorata : on le dit
 * en une ligne plutôt que de la présenter comme une mesure.
 */
export function ViewsPulseCard() {
  const t = useTranslations("portal.pulse");
  const loc = useIntlLocale();
  const { current } = useCreatorProject();
  const pulse = useMyViewsPulse(current.projectId);
  if (!pulse) return null;

  return (
    <section
      data-testid="views-pulse"
      className="animate-pop flex items-center gap-3 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-4"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
        <TrendingUpIcon className="size-5" />
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
          {t("yesterday")}
        </p>
        <AnimatedNumber
          value={pulse.views}
          format={(n) => t("views", { views: formatViews(Math.round(n), loc) })}
          className="block text-base font-semibold tabular-nums text-emerald-950"
        />
        {pulse.estimated && (
          <p className="text-xs text-emerald-700/80">{t("estimated")}</p>
        )}
      </div>
    </section>
  );
}
