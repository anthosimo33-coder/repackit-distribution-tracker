"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BarChart3Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { usePermissions } from "@/components/project/use-permissions";
import { Card, CardContent } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { VerdictScenario } from "@/components/scenarios/VerdictScenario";

const arrondi = (x: number | null) => (x === null ? null : Math.round(x));

/**
 * La PERFORMANCE d'un scénario à J+7, toutes campagnes confondues, avec le
 * détail par campagne (lien vers l'analytics de chacune). Bloc analytics : sans
 * lui, la carte n'apparaît pas.
 */
export function ScenarioPerformance({ scenarioId }: { scenarioId: Id<"scenarios"> }) {
  const tr = useTranslations("admin.scripts.ScenarioPerformance");
  const loc = useIntlLocale();
  const projectPath = useProjectPath();
  const { skipUnless } = usePermissions();
  const perf = useProjectQuery(api.scenarioAnalytics.perfParScenario, skipUnless("content.analytics", {}));
  if (!perf) return null;
  const moi = perf.scenarios.find((s) => s.scenarioId === scenarioId);

  return (
    <Card data-testid="scenario-performance">
      <CardContent className="space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <BarChart3Icon className="size-4" />
          {tr("titre")}
        </h2>
        {!moi ? (
          <p className="text-sm text-slate-500">{tr("aucunPost")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-slate-700">
                {tr("resume", { posts: moi.posts, vues: formatNumber(arrondi(moi.vuesMediane), loc) })}
              </p>
              <VerdictScenario verdict={moi.verdict} />
            </div>
            {moi.posts < perf.seuil && (
              <p className="text-xs text-slate-400">{tr("enTest", { posts: moi.posts, seuil: perf.seuil })}</p>
            )}
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {moi.campagnes.map((c) => (
                <li key={c.campaignId} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid="scenario-perf-campagne">
                  <Link
                    href={projectPath(`/scripts/${c.campaignId}/analytics`)}
                    prefetch={false}
                    className="min-w-0 flex-1 truncate text-slate-900 hover:underline"
                  >
                    {c.nom ?? tr("campagneSupprimee")}
                  </Link>
                  <span className="shrink-0 tabular-nums text-xs text-slate-500">
                    {tr("ligne", { posts: c.posts, vues: formatNumber(arrondi(c.vuesMediane), loc) })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
