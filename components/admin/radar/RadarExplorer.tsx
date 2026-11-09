"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { cn } from "@/lib/utils";
import { RadarSignals } from "@/components/admin/radar/RadarSignals";
import { RadarFormats } from "@/components/admin/radar/RadarFormats";
import { RadarAds } from "@/components/admin/radar/RadarAds";
import { useNow } from "@/components/admin/radar/radar-ui";
import { groupAds } from "@/convex/radarDisplay";
import { applyFilters, defaultFilters, listSince } from "@/convex/radarSignalFilters";

export type ExplorerVue = "videos" | "formats" | "pubs";

/**
 * RADAR — EXPLORER : tout ce que la veille a relevé, en vidéos, en formats
 * (textes et sons repris) ou en pubs (créas regroupées). Le choix vit dans
 * l'adresse (`vue=`).
 */
export function RadarExplorer({ vue, hrefFor }: { vue: ExplorerVue; hrefFor: (v: ExplorerVue) => string }) {
  const tr = useTranslations("admin.ops.RadarExplorer");
  const now = useNow();
  const signals = useProjectQuery(api.radarSignals.listSignals, { since: listSince(now) });
  const formats = useProjectQuery(api.radarNetworks.listFormats, {});
  const ads = useProjectQuery(api.radarSources.listAds, {});

  const counts: Record<ExplorerVue, string | null> = {
    videos: signals ? String(applyFilters(signals.signals, defaultFilters(), now).length) : null,
    formats: formats ? String(formats.filter((f) => f.hot).length) : null,
    pubs: ads ? tr("nPubsActives", { n: groupAds(ads).filter((g) => g.activeCount > 0).length }) : null,
  };
  const VUES: ExplorerVue[] = ["videos", "formats", "pubs"];

  return (
    <div className="space-y-5">
      <nav aria-label={tr("ceQuOnExplore")} className="inline-flex flex-wrap rounded-xl border border-slate-300 bg-white p-1">
        {VUES.map((v) => (
          <Link
            key={v}
            href={hrefFor(v)}
            prefetch={false}
            scroll={false}
            aria-current={vue === v ? "page" : undefined}
            className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold", vue === v ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900")}
          >
            {tr(v)}
            {counts[v] !== null && <span className={cn("font-medium", vue === v ? "text-slate-300" : "text-slate-500")}>· {counts[v]}</span>}
          </Link>
        ))}
      </nav>
      {vue === "videos" && <RadarSignals />}
      {vue === "formats" && <RadarFormats />}
      {vue === "pubs" && <RadarAds />}
    </div>
  );
}
