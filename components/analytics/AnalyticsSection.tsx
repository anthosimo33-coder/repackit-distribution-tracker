"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { KpiGrid } from "./KpiGrid";
import { MetricChart } from "./MetricChart";
import { TopHooksTable } from "./TopHooksTable";
import type { FormatKey } from "@/lib/format-config";

type Publication = Doc<"publications">;

/**
 * AnalyticsSection — bloc analytics rendu en bas des pages format.
 *
 * Layout : KpiGrid (6 cards) + MetricChart (chart configurable) +
 * TopHooksTable (10 rows). Pas filtrée par les filtres internes du
 * TrackerListSection — vue globale du format pour permettre le pilotage
 * stratégique. Si l'utilisateur veut zoomer, il a la liste filtrable
 * au-dessus pour ça.
 */
export function AnalyticsSection({
  publications,
  mediaType,
}: {
  publications: Publication[];
  mediaType: FormatKey;
}) {
  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold text-slate-900">Analytics</h2>
      <KpiGrid publications={publications} mediaType={mediaType} />
      <MetricChart publications={publications} mediaType={mediaType} />
      <TopHooksTable publications={publications} mediaType={mediaType} />
    </section>
  );
}
