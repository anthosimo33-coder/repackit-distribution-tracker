"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRightIcon, MusicIcon, TypeIcon } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProject } from "@/components/project/ProjectProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatCount } from "@/components/admin/radar/radar-format";
import { ACCENT_LINK, AccentTag, ScoreBadge, SignalCard, useFormatLabel, useNow, useSignalStatus } from "@/components/admin/radar/radar-ui";
import { RadarViewer, type ViewerQueue } from "@/components/admin/radar/RadarViewer";
import { appWeek, handledToday, todayQueue } from "@/convex/radarDisplay";
import { applyFilters, defaultFilters, listSince } from "@/convex/radarSignalFilters";

type Format = FunctionReturnType<typeof api.radarNetworks.listFormats>[number];
export type RadarGo = (onglet: "explorer" | "concurrents", params?: Record<string, string>) => void;

/** Formats montrés sur Aujourd'hui ; concurrents dans le tableau de la semaine. */
const FORMATS_SHOWN = 4;
const RIVALS_SHOWN = 6;

/**
 * RADAR — AUJOURD'HUI : ce qu'il faut voir, sans rien régler. Les 12 vidéos les
 * plus fortes que l'équipe n'a pas encore traitées (radarDisplay.todayQueue), à
 * regarder une par une ; les formats qui circulent ; les concurrents de la
 * semaine. Le reste attend dans Explorer.
 */
export function RadarToday({ go }: { go: RadarGo }) {
  const tr = useTranslations("admin.ops.RadarToday");
  const loc = useIntlLocale();
  const { project } = useProject();
  const now = useNow();
  const data = useProjectQuery(api.radarSignals.listSignals, { since: listSince(now) });
  const formats = useProjectQuery(api.radarNetworks.listFormats, {});
  const networks = useProjectQuery(api.radarNetworks.listNetworks, {});
  const ads = useProjectQuery(api.radarSources.listAds, {});
  const setStatus = useSignalStatus();
  const formatLabel = useFormatLabel();
  const [viewer, setViewer] = useState<ViewerQueue | null>(null);

  if (data === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const signals = data.signals;
  const queue = todayQueue(signals, now);
  const week = applyFilters(signals, defaultFilters(), now);
  const handled = handledToday(signals, now);
  const open = (index: number) => setViewer({ ids: queue.map((s) => s.id), index });

  const hot = (formats ?? []).filter((f) => f.hot);
  const rivals = (networks?.apps ?? [])
    .filter((a) => a.group === "rival")
    .map((a) => ({ a, w: appWeek(a.name, signals, ads ?? [], now) }))
    .sort((x, y) => y.w.hits.length - x.w.hits.length || y.a.accounts - x.a.accounts);

  return (
    <div className="space-y-9">
      <section className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5" aria-labelledby="radar-aujourdhui-titre">
        <div className="min-w-0 flex-[1_1_480px]">
          <h2 id="radar-aujourdhui-titre" className="text-xl font-semibold tracking-tight text-slate-900" data-testid="radar-a-regarder">
            {queue.length ? tr("aRegarder", { n: queue.length }) : tr("toutEstVu")}
          </h2>
          <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">
            {queue.length
              ? tr("aRegarderAide", { total: week.length, concurrents: week.filter((s) => s.competitor).length })
              : tr("toutEstVuAide")}
            {handled > 0 && <span className="font-medium text-slate-900"> {tr("traiteesAujourdhui", { n: handled })}</span>}
          </p>
        </div>
        {queue.length > 0 ? (
          <button type="button" onClick={() => open(0)} className="inline-flex min-h-12 items-center gap-2.5 rounded-xl bg-slate-900 px-5 text-[15px] font-semibold text-white">
            {tr("lesRegarder")}
            <ArrowRightIcon className="size-4" aria-hidden />
          </button>
        ) : (
          <button type="button" onClick={() => go("explorer")} className="inline-flex min-h-12 items-center gap-2.5 rounded-xl border border-slate-300 bg-white px-5 text-[15px] font-semibold text-slate-900">
            {tr("explorerTout")}
            <ArrowRightIcon className="size-4" aria-hidden />
          </button>
        )}
      </section>

      {queue.length > 0 && (
        <section aria-labelledby="radar-premier" className="space-y-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="radar-premier" className="text-lg font-semibold">
              {tr("aRegarderEnPremier")}
            </h2>
            <p className="text-[13px] text-slate-500">{tr("legendeScore")}</p>
          </div>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
            {queue.map((s, i) => (
              <SignalCard key={s.id} s={s} now={now} onOpen={() => open(i)} onStatus={(st) => void setStatus(s, st)} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="radar-formats-titre" className="space-y-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="radar-formats-titre" className="text-lg font-semibold">
              {tr("formatsQuiCirculent")}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{tr("formatsAide", { n: hot.length })}</p>
          </div>
          <button type="button" onClick={() => go("explorer", { vue: "formats" })} className={cn("text-sm", ACCENT_LINK)}>
            {tr("tousLesFormats")}
          </button>
        </div>
        {formats === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : hot.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-5 py-6 text-sm text-slate-500">{tr("aucunFormat")}</p>
        ) : (
          <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(270px,1fr))]">
            {hot.slice(0, FORMATS_SHOWN).map((f) => (
              <FormatTile key={f.id} f={f} label={formatLabel(f)} onSee={() => go("explorer", { vue: "formats" })} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="radar-concurrents-titre" className="space-y-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="radar-concurrents-titre" className="text-lg font-semibold">
              {tr("concurrentsSemaine")}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{tr("concurrentsAide")}</p>
          </div>
          {rivals.length > 0 && (
            <button type="button" onClick={() => go("concurrents")} className={cn("text-sm", ACCENT_LINK)}>
              {tr("lesConcurrents", { n: rivals.length, projet: project.name })}
            </button>
          )}
        </div>
        {networks === undefined ? (
          <Skeleton className="h-48 w-full" />
        ) : rivals.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-5 py-6 text-sm text-slate-500">{tr("aucunConcurrent")}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">{tr("colApp")}</th>
                  <th className="px-4 py-2.5 text-right font-semibold">{tr("colQuiCartonnent")}</th>
                  <th className="px-4 py-2.5 font-semibold">{tr("colMeilleure")}</th>
                  <th className="px-4 py-2.5 text-right font-semibold">{tr("colPubs")}</th>
                  <th className="px-4 py-2.5 text-right font-semibold">{tr("colComptes")}</th>
                </tr>
              </thead>
              <tbody>
                {rivals.slice(0, RIVALS_SHOWN).map(({ a, w }) => (
                  <tr key={a.id} className="border-t border-slate-100" data-testid="radar-concurrent-semaine">
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => go("concurrents", { app: a.slug })} className="font-semibold text-slate-900 hover:underline">
                        {a.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{w.hits.length}</td>
                    <td className="px-4 py-3">
                      {/* Sa meilleure vidéo QUI LA CITE (pas la meilleure de ses comptes, qui publient aussi autre chose). */}
                      {w.hits[0] ? (
                        <a href={w.hits[0].url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-slate-700 hover:underline">
                          <ScoreBadge s={w.hits[0]} size="sm" />
                          {tr("meilleure", { handle: w.hits[0].handle, vues: formatCount(w.hits[0].views, loc) })}
                        </a>
                      ) : (
                        <span className="text-slate-500">{tr("rienCetteSemaine")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{w.activeAds}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{a.accounts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RadarViewer queue={viewer} signals={signals} now={now} onChange={setViewer} />
    </div>
  );
}

/** Un format qui circule, en tuile : son nom, qui l'a repris, jusqu'où il est monté. */
export function FormatTile({ f, label, onSee }: { f: Format; label: string; onSee: () => void }) {
  const tr = useTranslations("admin.ops.RadarToday");
  const loc = useIntlLocale();
  const Icon = f.kind === "hook" ? TypeIcon : MusicIcon;
  return (
    <li className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-slate-200 bg-white p-4" data-testid="radar-format-tuile">
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
          <Icon className="size-3.5" aria-hidden />
          {f.kind === "hook" ? tr("memeTexte") : tr("memeSon")}
        </span>
        {f.rival && <AccentTag className="px-2 py-0.5">{tr("pousseParUnConcurrent")}</AccentTag>}
      </div>
      <p className="line-clamp-3 break-words text-[15px] font-semibold leading-snug text-slate-900">{label}</p>
      <p className="text-[13px] leading-relaxed text-slate-500">
        {tr("formatMeta", { comptes: f.accountCount, apps: f.apps.map((a) => a.name).join(", "), vues: formatCount(f.maxViews, loc) })}
        {f.variants > 1 && ` · ${tr("variantes", { n: f.variants })}`}
      </p>
      <div className="mt-auto border-t border-slate-100 pt-2.5">
        <button type="button" onClick={onSee} className={cn("text-sm", ACCENT_LINK)}>
          {tr("voirLeFormat")}
        </button>
      </div>
    </li>
  );
}
