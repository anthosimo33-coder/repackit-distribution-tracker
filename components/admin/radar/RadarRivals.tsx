"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLinkIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProject } from "@/components/project/ProjectProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatCount, formatOutlierRatio } from "@/components/admin/radar/radar-format";
import { ACCENT_LINK, SignalCard, useFormatLabel, useNow, useSignalStatus } from "@/components/admin/radar/radar-ui";
import { RadarViewer, type ViewerQueue } from "@/components/admin/radar/RadarViewer";
import { AccountsTable, NetworkSearchBlock, type AppRow } from "@/components/admin/radar/RadarNetworks";
import { AdGroupCard } from "@/components/admin/radar/RadarAds";
import type { RadarGo } from "@/components/admin/radar/RadarToday";
import { appWeek, groupAds, scoreOf } from "@/convex/radarDisplay";
import { listSince } from "@/convex/radarSignalFilters";

/** Autres apps montrées avant « Voir toutes » ; vidéos, formats et pubs d'une fiche. */
const OTHERS_SHOWN = 8;
const VIDEOS_SHOWN = 8;
const FORMATS_SHOWN = 6;
const ADS_SHOWN = 6;

/**
 * RADAR — CONCURRENTS : une fiche par app suivie (concurrentes du projet d'abord)
 * qui réunit tout ce que la veille sait d'elle : ses vidéos qui cartonnent, ses
 * formats, ses pubs, ses comptes, et la recherche de nouveaux comptes.
 */
export function RadarRivals({ selected, hrefFor, go }: { selected: string | null; hrefFor: (slug: string) => string; go: RadarGo }) {
  const tr = useTranslations("admin.ops.RadarRivals");
  const loc = useIntlLocale();
  const { project } = useProject();
  const now = useNow();
  const networks = useProjectQuery(api.radarNetworks.listNetworks, {});
  const data = useProjectQuery(api.radarSignals.listSignals, { since: listSince(now) });
  const formats = useProjectQuery(api.radarNetworks.listFormats, {});
  const ads = useProjectQuery(api.radarSources.listAds, {});
  const setStatus = useSignalStatus();
  const formatLabel = useFormatLabel();
  const [allOthers, setAllOthers] = useState(false);
  const [viewer, setViewer] = useState<ViewerQueue | null>(null);

  if (networks === undefined || data === undefined) return <Skeleton className="h-[600px] w-full" />;
  const signals = data.signals;
  const rows = networks.apps.map((a) => ({ a, w: appWeek(a.name, signals, ads ?? [], now) }));
  const byHits = (x: (typeof rows)[number], y: (typeof rows)[number]) => y.w.hits.length - x.w.hits.length || y.a.accounts - x.a.accounts || x.a.name.localeCompare(y.a.name);
  const rivals = rows.filter((r) => r.a.group === "rival").sort(byHits);
  const others = rows.filter((r) => r.a.group !== "rival").sort(byHits);
  const current = rows.find((r) => r.a.slug === selected) ?? rivals[0] ?? others[0];

  if (!current) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
        <p className="font-semibold text-slate-900">{tr("aucuneApp")}</p>
        <p className="mt-1 text-sm text-slate-500">{tr("aucuneAppAide")}</p>
      </div>
    );
  }

  const { a: app, w } = current;
  const hits = w.hits;
  const appFormats = (formats ?? []).filter((f) => f.apps.some((x) => x.name === app.name));
  const appAds = groupAds((ads ?? []).filter((x) => x.app === app.name));

  const appLink = (r: (typeof rows)[number]) => (
    <Link
      key={r.a.id}
      href={hrefFor(r.a.slug)}
      prefetch={false}
      scroll={false}
      aria-current={r.a.id === app.id ? "page" : undefined}
      className={cn(
        "flex min-h-10 items-center justify-between gap-2 rounded-lg px-2.5 text-sm",
        r.a.id === app.id ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-700 hover:bg-slate-50",
        r.a.status === "paused" && "text-slate-400",
      )}
    >
      <span className="truncate">{r.a.name}</span>
      <span className="text-xs tabular-nums text-slate-500">{r.w.hits.length}</span>
    </Link>
  );

  return (
    <div className="flex flex-wrap items-start gap-8">
      <aside aria-label={tr("apps")} className="flex w-full flex-col gap-5 md:w-[230px] md:shrink-0">
        <div className="flex flex-col gap-0.5">
          <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{tr("concurrentsDe", { projet: project.name })}</h2>
          {rivals.length === 0 ? <p className="px-2.5 text-sm text-slate-500">{tr("aucunConcurrent")}</p> : rivals.map(appLink)}
        </div>
        {others.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{tr("autresApps")}</h2>
            {(allOthers ? others : others.slice(0, OTHERS_SHOWN)).map(appLink)}
            {others.length > OTHERS_SHOWN && (
              <button type="button" onClick={() => setAllOthers((x) => !x)} className={cn("px-2.5 py-1.5 text-left text-[13px]", ACCENT_LINK)}>
                {allOthers ? tr("moins") : tr("voirToutes", { n: others.length })}
              </button>
            )}
          </div>
        )}
        <p className="px-2.5 text-xs leading-relaxed text-slate-500">{tr("legendeListe")}</p>
      </aside>

      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-8" data-testid="radar-fiche-app">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-2xl font-semibold tracking-tight">{app.name}</h2>
              <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", app.group === "rival" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700")}>
                {app.group === "rival" ? tr("concurrentDe", { projet: project.name }) : app.group === "otherRival" ? tr("concurrentAilleurs") : tr("autreApp")}
              </span>
              {app.status === "paused" && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{tr("enPause")}</span>}
            </div>
            <p className="mt-1.5 text-sm text-slate-500">{tr("recherches", { recherches: app.searches.join(", ") })}</p>
          </div>
          <NetworkSearchBlock app={app as AppRow} now={now} />
        </div>

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
          <Kpi label={tr("kpiCartonnent")} value={String(hits.length)} sub={tr("septJours")} testId="radar-kpi-cartonnent" />
          {/* Sa meilleure vidéo QUI LA CITE, pas la meilleure de ses comptes (qui publient aussi autre chose). */}
          <Kpi
            label={tr("kpiMeilleure")}
            value={hits[0] ? formatCount(hits[0].views, loc) : "—"}
            sub={hits[0] ? tr("meilleureSous", { x: formatOutlierRatio(scoreOf(hits[0]).value, loc), handle: hits[0].handle }) : tr("rienCetteSemaine")}
          />
          <Kpi label={tr("kpiPubs")} value={String(w.activeAds)} sub={tr("tiktokEtMeta")} testId="radar-kpi-pubs" />
          <Kpi label={tr("kpiComptes")} value={String(app.accounts)} sub={tr("comptesSous", { posts: app.posts7d })} />
        </div>

        <section aria-labelledby="radar-fiche-videos" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="radar-fiche-videos" className="text-[17px] font-semibold">
              {tr("sesVideos")}
            </h3>
            {hits.length > 0 && (
              <button type="button" onClick={() => go("explorer", { a: app.name })} className={cn("text-sm", ACCENT_LINK)}>
                {tr("toutesDansExplorer", { n: hits.length })}
              </button>
            )}
          </div>
          {hits.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 px-5 py-6 text-sm text-slate-500">{tr("aucuneVideo")}</p>
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
              {hits.slice(0, VIDEOS_SHOWN).map((s, i) => (
                <SignalCard key={s.id} s={s} now={now} onOpen={() => setViewer({ ids: hits.map((x) => x.id), index: i })} onStatus={(st) => void setStatus(s, st)} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="radar-fiche-formats" className="space-y-3">
          <h3 id="radar-fiche-formats" className="text-[17px] font-semibold">
            {tr("sesFormats")}
          </h3>
          {appFormats.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 px-5 py-6 text-sm text-slate-500">{tr("aucunFormat")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {appFormats.slice(0, FORMATS_SHOWN).map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5">
                  <div className="min-w-0 flex-[1_1_360px]">
                    <p className="break-words text-sm font-semibold leading-snug text-slate-900">{formatLabel(f)}</p>
                    <p className="mt-1 text-[13px] text-slate-500">
                      {tr(f.kind === "hook" ? "memeTexte" : "memeSon")} ·{" "}
                      {tr("formatMeta", { comptes: f.accountCount, apps: f.apps.map((x) => x.name).join(", "), vues: formatCount(f.maxViews, loc) })}
                    </p>
                  </div>
                  {f.members[0] && (
                    <a href={f.members[0].url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-700 hover:underline">
                      {tr("laMeilleure")}
                      <ExternalLinkIcon className="size-3.5" aria-hidden />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="radar-fiche-pubs" className="space-y-3">
          <h3 id="radar-fiche-pubs" className="text-[17px] font-semibold">
            {tr("sesPubs")}
          </h3>
          {appAds.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-5 py-6 text-center">
              <p className="text-sm font-semibold text-slate-900">{tr("aucunePub", { app: app.name })}</p>
              <p className="mt-1 text-[13px] text-slate-500">{tr("aucunePubAide")}</p>
            </div>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {appAds.slice(0, ADS_SHOWN).map((g) => (
                <AdGroupCard key={g.key} g={g} />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="radar-fiche-comptes" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="radar-fiche-comptes" className="text-[17px] font-semibold">
              {tr("sesComptes")}
            </h3>
            <span className="text-[13px] text-slate-500">{tr("comptesAide", { n: app.accounts, actifs: app.activeAccounts })}</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <AccountsTable appId={app.id} appName={app.name} />
          </div>
        </section>
      </div>

      <RadarViewer queue={viewer} signals={signals} now={now} onChange={setViewer} />
    </div>
  );
}

function Kpi({ label, value, sub, testId }: { label: string; value: string; sub: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200 px-4 py-3.5">
      <span className="text-[13px] text-slate-500">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums" data-testid={testId}>
        {value}
      </span>
      <span className="truncate text-xs text-slate-500">{sub}</span>
    </div>
  );
}
