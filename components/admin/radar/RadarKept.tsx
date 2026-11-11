"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRightIcon, BookmarkIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalCard, useNow, useSignalStatus } from "@/components/admin/radar/radar-ui";
import { RadarViewer, type ViewerQueue } from "@/components/admin/radar/RadarViewer";
import type { RadarGo } from "@/components/admin/radar/RadarToday";
import { listSince } from "@/convex/radarSignalFilters";

/**
 * RADAR — GARDÉES : les vidéos que l'équipe du projet a gardées (le signet d'une
 * carte, ou G dans « Regarder une par une »), les dernières gardées d'abord.
 * Avant le 11/11/2026 elles ne se retrouvaient que par un filtre d'Explorer.
 * Retirer le signet la sort de la liste, « Annuler » la remet.
 */
export function RadarKept({ go }: { go: RadarGo }) {
  const tr = useTranslations("admin.ops.RadarKept");
  const now = useNow();
  const kept = useProjectQuery(api.radarSignals.listKept, {});
  // Déjà lue par la page (le compteur d'Aujourd'hui) : aucune lecture de plus.
  const all = useProjectQuery(api.radarSignals.listSignals, { since: listSince(now) });
  const setStatus = useSignalStatus();
  const [viewer, setViewer] = useState<ViewerQueue | null>(null);

  if (kept === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const signals = kept.signals;
  // Le lecteur garde la file de son ouverture : une vidéo qu'on y sort des gardées doit rester lisible, avec son nouveau statut.
  const keptIds = new Set(signals.map((s) => s.id));
  const forViewer = [...signals, ...(all?.signals ?? []).filter((s) => !keptIds.has(s.id))];
  const hiddenCount = kept.total - signals.length;

  if (signals.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center" data-testid="radar-gardees-vide">
        <BookmarkIcon className="size-6 text-slate-400" aria-hidden />
        <p className="font-semibold text-slate-900">{tr("videTitre")}</p>
        <p className="max-w-md text-sm leading-relaxed text-slate-500">{tr("videTexte")}</p>
        <button type="button" onClick={() => go("explorer")} className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900">
          {tr("explorer")}
          <ArrowRightIcon className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5" aria-labelledby="radar-gardees-titre">
        <div className="min-w-0 flex-[1_1_480px]">
          <h2 id="radar-gardees-titre" className="text-xl font-semibold tracking-tight text-slate-900" data-testid="radar-gardees-titre">
            {tr("titre", { n: kept.total })}
          </h2>
          <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">
            {tr("aide")}
            {hiddenCount > 0 && <span className="text-slate-500"> {tr("tronque", { n: signals.length })}</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setViewer({ ids: signals.map((s) => s.id), index: 0 })}
          className="inline-flex min-h-12 items-center gap-2.5 rounded-xl bg-slate-900 px-5 text-[15px] font-semibold text-white"
        >
          {tr("lesRegarder")}
          <ArrowRightIcon className="size-4" aria-hidden />
        </button>
      </section>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
        {signals.map((s, i) => (
          <SignalCard key={s.id} s={s} now={now} onOpen={() => setViewer({ ids: signals.map((x) => x.id), index: i })} onStatus={(st) => void setStatus(s, st)} />
        ))}
      </div>

      <RadarViewer queue={viewer} signals={forViewer} now={now} onChange={setViewer} />
    </div>
  );
}
