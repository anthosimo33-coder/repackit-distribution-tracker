"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatPublished } from "@/components/admin/radar/radar-format";
import { groupAds, type AdGroup } from "@/convex/radarDisplay";

type Ad = FunctionReturnType<typeof api.radarSources.listAds>[number];
type PlatformFilter = "all" | Ad["platform"];

const PLATFORMS: PlatformFilter[] = ["all", "meta", "tiktok"];

/**
 * RADAR — les pubs des apps suivies (bibliothèques TikTok et Meta), une ligne
 * par CRÉA : les annonces d'une même créa (même app, annonceur et texte) sont
 * regroupées (radarDisplay.groupAds). Une pub qui tourne depuis longtemps est un
 * format que l'app paie pour pousser : concurrentes d'abord, actives d'abord.
 */
export function RadarAds() {
  const tr = useTranslations("admin.ops.RadarAds");
  const key = (k: string) => k as Parameters<typeof tr>[0];
  const ads = useProjectQuery(api.radarSources.listAds, {});
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [rivalOnly, setRivalOnly] = useState(false);

  if (ads === undefined) return <Skeleton className="h-96 w-full" />;
  const shown = groupAds(ads.filter((a) => (platform === "all" || a.platform === platform) && (!activeOnly || a.active) && (!rivalOnly || a.rival)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label={tr("plateforme")}>
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={platform === p}
              onClick={() => setPlatform(p)}
              className={cn("min-h-9 rounded-md px-3 text-sm font-medium", platform === p ? "bg-slate-900 text-white" : "text-slate-700")}
            >
              {tr(key(`plateformes.${p}`))}
            </button>
          ))}
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={activeOnly} onChange={() => setActiveOnly((x) => !x)} className="size-4 accent-slate-900" />
          {tr("activesSeulement")}
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={rivalOnly} onChange={() => setRivalOnly((x) => !x)} className="size-4 accent-slate-900" />
          {tr("concurrentsSeulement")}
        </label>
      </div>
      <p className="text-sm text-slate-600" data-testid="radar-pubs-compte">
        {tr("compte", { n: shown.length })}
      </p>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
          <p className="font-semibold text-slate-900">{ads.length === 0 ? tr("aucuneTitre") : tr("aucuneFiltreTitre")}</p>
          <p className="mt-1 text-sm text-slate-500">{tr("aucuneTexte")}</p>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {shown.map((g) => (
            <AdGroupCard key={g.key} g={g} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Une créa : son app, depuis quand elle tourne, son texte, combien d'annonces la portent. */
export function AdGroupCard({ g }: { g: AdGroup<Ad> }) {
  const tr = useTranslations("admin.ops.RadarAds");
  const key = (k: string) => k as Parameters<typeof tr>[0];
  const loc = useIntlLocale();
  const a = g.lead;
  const active = g.activeCount > 0;
  return (
    <li className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-4" data-testid="radar-pub">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">{tr(key(`plateformes.${a.platform}`))}</span>
        {a.app && <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", a.rival ? "bg-orange-500 text-slate-950" : "bg-slate-900 text-white")}>{a.app}</span>}
        <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500")}>
          {active ? tr("active") : tr("arretee")}
        </span>
        <span className="truncate text-slate-500">{a.advertiser}</span>
      </div>
      <p className="text-sm font-semibold text-slate-900">
        {g.runDays !== null ? tr("tourneDepuis", { n: g.runDays }) : tr("dureeInconnue")}
        {g.firstShownAt !== null && <span className="font-normal text-slate-500"> · {tr("depuisLe", { date: formatPublished(g.firstShownAt, loc) })}</span>}
      </p>
      {g.text ? <p className="line-clamp-4 break-words text-sm text-slate-700">{g.text}</p> : <p className="text-sm italic text-slate-500">{tr("texteDeCatalogue")}</p>}
      <p className="text-xs text-slate-500">
        {[
          g.ads.length > 1 ? tr("annonces", { n: g.ads.length, actives: g.activeCount }) : null,
          a.variants !== null ? tr("variantes", { n: a.variants }) : null,
          a.audience ? tr("audience", { n: a.audience }) : null,
          a.platforms.length ? a.platforms.join(", ") : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="flex flex-wrap gap-3 text-sm">
        <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">
          {tr("voirDansLaBibliotheque")}
          <ExternalLinkIcon className="size-3.5 text-slate-500" aria-hidden />
        </a>
        {a.videoUrl && (
          <a href={a.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">
            <PlayIcon className="size-3.5 text-slate-500" aria-hidden />
            {tr("laVideo")}
          </a>
        )}
      </div>
    </li>
  );
}
