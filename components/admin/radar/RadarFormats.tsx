"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLinkIcon, MusicIcon, TypeIcon } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AccentTag, useFormatLabel } from "@/components/admin/radar/radar-ui";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatCount, formatOutlierRatio, formatRelative } from "@/components/admin/radar/radar-format";

type Format = FunctionReturnType<typeof api.radarNetworks.listFormats>[number];
type Kind = "all" | Format["kind"];

const KINDS: Kind[] = ["all", "hook", "sound"];

/**
 * NOUVEAU RADAR — Formats qui circulent : le même hook (texte à l'écran) ou le
 * même son repris par au moins deux comptes suivis en 14 jours. Par défaut, ceux
 * qui pètent seulement, les plus vus d'abord, toutes apps confondues
 * (convex/radarNetworks.listFormatsCore, radarNetworkMath.isHotFormat).
 */
export function RadarFormats() {
  const tr = useTranslations("admin.ops.RadarFormats");
  const key = (k: string) => k as Parameters<typeof tr>[0];
  const formats = useProjectQuery(api.radarNetworks.listFormats, {});
  const [kind, setKind] = useState<Kind>("all");
  const [rivalOnly, setRivalOnly] = useState(false);
  const [hotOnly, setHotOnly] = useState(true);

  if (formats === undefined) return <Skeleton className="h-96 w-full" />;
  const others = formats.filter((f) => (kind === "all" || f.kind === kind) && (!rivalOnly || f.rival));
  const shown = others.filter((f) => !hotOnly || f.hot);
  const cold = others.length - shown.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label={tr("type")}>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={cn("min-h-9 rounded-md px-3 text-sm font-medium", kind === k ? "bg-slate-900 text-white" : "text-slate-700")}
            >
              {tr(key(`kind.${k}`))}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5">
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={hotOnly} onChange={() => setHotOnly((h) => !h)} className="size-4 accent-slate-900" />
            {tr("quiPetent")}
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={rivalOnly} onChange={() => setRivalOnly((r) => !r)} className="size-4 accent-slate-900" />
            {tr("concurrentsSeulement")}
          </label>
        </div>
      </div>
      <p className="text-sm text-slate-600">
        <span data-testid="radar-formats-compte">{tr("compte", { n: shown.length })}</span>
        {hotOnly && 0 < cold && <span className="text-slate-500"> · {tr("cachesFroids", { n: cold })}</span>}
      </p>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
          <p className="font-semibold text-slate-900">{formats.length === 0 ? tr("aucunTitre") : tr("aucunFiltreTitre")}</p>
          <p className="mt-1 text-sm text-slate-500">{tr("aucunTexte")}</p>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {shown.map((f) => (
            <FormatCard key={f.id} f={f} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FormatCard({ f }: { f: Format }) {
  const tr = useTranslations("admin.ops.RadarFormats");
  // « Son original de @x » plutôt que « original sound - x ».
  const formatLabel = useFormatLabel();
  const loc = useIntlLocale();
  const Icon = f.kind === "hook" ? TypeIcon : MusicIcon;
  return (
    <li className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4" data-testid="radar-format">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">
          <Icon className="size-3.5" aria-hidden />
          {tr(f.kind === "hook" ? "memeHook" : "memeSon")}
        </span>
        {f.rival && <AccentTag className="px-1.5 py-0.5">{tr("pousseParUnConcurrent")}</AccentTag>}
        <span className="text-slate-500">
          {tr("comptesEtApps", { comptes: f.accountCount, apps: f.apps.map((a) => a.name).join(", ") })}
          {f.variants > 1 && ` · ${tr("variantes", { n: f.variants })}`}
        </span>
      </div>
      <p className={cn("break-words text-slate-900", f.kind === "hook" ? "text-base font-semibold" : "text-sm font-medium")}>
        {formatLabel(f)}
      </p>
      <p className="text-xs text-slate-500">
        {tr("resume", { vues: formatCount(f.maxViews, loc), quand: formatRelative(f.lastPostAt, loc) })}
        {f.bestMultiplier !== null && ` · ${tr("meilleurMultiplicateur", { x: formatOutlierRatio(f.bestMultiplier, loc) })}`}
      </p>
      <ul className="space-y-1 border-t border-slate-100 pt-2 text-sm">
        {f.members.map((m) => (
          <li key={m.url} className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <a href={m.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 font-medium text-slate-900 hover:underline">
                <span className="truncate">@{m.handle}</span>
                <ExternalLinkIcon className="size-3.5 shrink-0 text-slate-500" aria-hidden />
              </a>
              {m.platform === "instagram" && <span className="shrink-0 rounded bg-fuchsia-600 px-1 text-[11px] font-semibold text-white">{tr("ig")}</span>}
              <span className="shrink-0 text-xs text-slate-500">
                {m.app ? `${m.app} · ` : ""}
                {tr("vues", { n: formatCount(m.views, loc) })}
                {m.multiplier !== null && ` · ${formatOutlierRatio(m.multiplier, loc)}`}
              </span>
            </div>
            {/* Écrit « 1 < » : la garde i18n lit « > 1 && » comme du texte JSX. */}
            {m.hook && 1 < f.variants && <p className="truncate text-xs text-slate-500">{tr("hookCite", { hook: m.hook })}</p>}
          </li>
        ))}
      </ul>
    </li>
  );
}
