"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDownIcon, ExternalLinkIcon, MusicIcon, TypeIcon } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AccentTag, useFormatLabel, useNow } from "@/components/admin/radar/radar-ui";
import { formatPlannedDay } from "@/convex/calendarStatus";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatCount, formatOutlierRatio, formatRelative } from "@/components/admin/radar/radar-format";

type Format = FunctionReturnType<typeof api.radarNetworks.listFormats>[number];
type Kind = "all" | Format["kind"];
type Vue = "reussis" | "petent" | "familles" | "tous";
/** Une famille : la même idée reprise dans au moins deux langues (convex/radarFamilies). */
type Family = { id: string; label: string; formats: Format[]; langs: string[] };

const KINDS: Kind[] = ["all", "hook", "sound"];
const VUES: Vue[] = ["reussis", "petent", "familles", "tous"];
/** Au-delà, la réussite se lit en chiffres seuls : une rangée de pastilles ne se compte plus. */
const MAX_DOTS = 10;
/** Les colonnes de l'en-tête et des lignes : les mêmes, pour que tout s'aligne. */
const COLS = "md:grid md:grid-cols-[minmax(0,1fr)_212px_88px_96px_80px_24px] md:gap-6";
/** Les colonnes d'une famille : langue, variante, chronologie, comptes, meilleure. */
const FAMILY_COLS = "md:grid md:grid-cols-[156px_minmax(0,1fr)_220px_72px_88px] md:gap-6";

/** Les familles des formats montrés, dans au moins deux langues : les plus multilingues, puis les plus vues. */
function familiesOf(formats: readonly Format[]): Family[] {
  const byId = new Map<string, Family>();
  for (const f of formats) {
    if (!f.family) continue;
    const fam = byId.get(f.family.id) ?? { id: f.family.id, label: f.family.label, formats: [], langs: [] };
    fam.formats.push(f);
    const lang = f.lang ?? "autre";
    if (!fam.langs.includes(lang)) fam.langs.push(lang);
    byId.set(f.family.id, fam);
  }
  const maxViews = (x: Family) => Math.max(...x.formats.map((f) => f.maxViews));
  return [...byId.values()]
    .filter((x) => x.langs.length >= 2)
    .map((x) => ({ ...x, formats: [...x.formats].sort((a, b) => a.firstSeenAt - b.firstSeenAt) }))
    .sort((x, y) => y.langs.length - x.langs.length || maxViews(y) - maxViews(x));
}

/**
 * RADAR — Formats qui circulent : le même hook (texte à l'écran) ou le même son
 * repris par au moins deux comptes suivis en 14 jours. Par défaut, ceux qui
 * RÉUSSISSENT — une reprise sur deux ou mieux fait 3× la normale de son compte
 * (radarNetworkMath.formatSuccess) — et non ceux qui ont un seul coup viral
 * (09/11/2026 : « new obsession », 1,8 M vues, 3 reprises réussies sur 23).
 */
export function RadarFormats() {
  const tr = useTranslations("admin.ops.RadarFormats");
  const key = (k: string) => k as Parameters<typeof tr>[0];
  const formats = useProjectQuery(api.radarNetworks.listFormats, {});
  const [kind, setKind] = useState<Kind>("all");
  const [rivalOnly, setRivalOnly] = useState(false);
  const [vue, setVue] = useState<Vue | null>(null);

  if (formats === undefined) return <Skeleton className="h-96 w-full" />;
  const base = formats.filter((f) => (kind === "all" || f.kind === kind) && (!rivalOnly || f.rival));
  const families = familiesOf(base);
  const langsOf = new Map(families.flatMap((x) => x.formats.map((f) => [f.id as string, x.langs.length])));
  const count: Record<Vue, number> = {
    reussis: base.filter((f) => f.winning).length,
    petent: base.filter((f) => f.hot).length,
    familles: families.length,
    tous: base.length,
  };
  // Par défaut : ceux qui réussissent, ou ceux qui pètent tant qu'aucun ne réussit.
  const current: Vue = vue ?? (count.reussis > 0 ? "reussis" : "petent");
  const shown = base.filter((f) => (current === "reussis" ? f.winning : current === "petent" ? f.hot : true));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label={tr("lesquels")}>
          {VUES.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={current === v}
              onClick={() => setVue(v)}
              className={cn("min-h-10 rounded-lg px-4 text-sm", current === v ? "bg-white font-semibold text-slate-900 shadow-sm" : "font-medium text-slate-600")}
            >
              {tr(key(`vue.${v}`), { n: count[v] })}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
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
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={rivalOnly} onChange={() => setRivalOnly((r) => !r)} className="size-4 accent-slate-900" />
            {tr("concurrentsSeulement")}
          </label>
        </div>
      </div>

      <p className="max-w-3xl text-sm leading-relaxed text-slate-600">
        <span className="font-semibold text-slate-900" data-testid="radar-formats-compte">
          {current === "familles" ? tr("compteFamilles", { n: families.length }) : tr("compte", { n: shown.length })}
        </span>{" "}
        · {tr(key(`aide.${current}`))}
      </p>

      {current === "familles" ? (
        families.length === 0 ? (
          <div className="border-t border-slate-200 py-12 text-center">
            <p className="font-semibold text-slate-900">{tr("aucuneFamille")}</p>
            <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{tr("aucuneFamilleAide")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-14">
            {families.map((x) => (
              <FamilyBlock key={x.id} family={x} />
            ))}
          </div>
        )
      ) : shown.length === 0 ? (
        <div className="border-t border-slate-200 py-12 text-center">
          <p className="font-semibold text-slate-900">{formats.length === 0 ? tr("aucunTitre") : tr("aucunFiltreTitre")}</p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{tr("aucunTexte")}</p>
        </div>
      ) : (
        <div>
          <div className={cn("hidden border-b border-slate-200 pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500", COLS)}>
            <span>{tr("colFormat")}</span>
            <span>{tr("colReussite")}</span>
            <span className="text-right">{tr("colMediane")}</span>
            <span className="text-right">{tr("colMeilleure")}</span>
            <span className="text-right">{tr("colComptes")}</span>
            <span />
          </div>
          <ul>
            {shown.map((f) => (
              <FormatRow key={f.id} f={f} langs={langsOf.get(f.id) ?? 0} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Un format en ligne : ce qu'il est, combien de ses reprises réussissent ; ses reprises en dépliant. */
function FormatRow({ f, langs }: { f: Format; langs: number }) {
  const tr = useTranslations("admin.ops.RadarFormats");
  // « Son original de @x » plutôt que « original sound - x ».
  const formatLabel = useFormatLabel();
  const loc = useIntlLocale();
  const [open, setOpen] = useState(false);
  const Icon = f.kind === "hook" ? TypeIcon : MusicIcon;
  const enough = f.measured >= 3;
  return (
    <li className="border-b border-slate-100" data-testid="radar-format">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={cn("flex w-full flex-col gap-3 py-5 text-left md:items-center", COLS)}>
        <span className="flex min-w-0 flex-col gap-1.5">
          <span className={cn("break-words text-slate-900", f.kind === "hook" ? "text-[15px] font-semibold leading-snug" : "text-sm font-medium")}>{formatLabel(f)}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Icon className="size-3.5" aria-hidden />
              {tr(f.kind === "hook" ? "memeHook" : "memeSon")}
            </span>
            <span>
              · {tr("comptesEtApps", { comptes: f.accountCount, apps: f.apps.map((a) => a.name).join(", ") })}
              {f.variants > 1 && ` · ${tr("variantes", { n: f.variants })}`}
              {/* Écrit « 1 < » : la garde i18n lit « > 1 && » comme du texte JSX. */}
              {1 < langs && ` · ${tr("familleEnLangues", { n: langs })}`}
            </span>
            {f.rival && <AccentTag className="px-1.5 py-0.5 text-xs">{tr("pousseParUnConcurrent")}</AccentTag>}
          </span>
        </span>
        <span className="flex items-center gap-3" data-testid="radar-format-reussite">
          {enough ? (
            <>
              {f.measured <= MAX_DOTS && (
                <span role="img" aria-label={tr("reussiteAria", { wins: f.wins, n: f.measured })} className="inline-flex gap-1">
                  {Array.from({ length: f.measured }, (_, i) => (
                    <span key={i} className={cn("size-2.5 rounded-full", i < f.wins ? "bg-primary" : "bg-slate-200")} />
                  ))}
                </span>
              )}
              <span className="text-lg font-semibold tabular-nums">
                {f.wins}
                <span className="text-sm font-medium text-slate-500"> {tr("sur", { n: f.measured })}</span>
              </span>
            </>
          ) : (
            <span className="text-[13px] text-slate-500">{tr("pasAssez")}</span>
          )}
        </span>
        <span className="text-[15px] font-semibold tabular-nums md:text-right">{f.medianMultiplier !== null ? formatOutlierRatio(f.medianMultiplier, loc) : "—"}</span>
        <span className="text-sm tabular-nums text-slate-600 md:text-right">{formatCount(f.maxViews, loc)}</span>
        <span className="text-sm tabular-nums text-slate-600 md:text-right">{f.accountCount}</span>
        <ChevronDownIcon className={cn("hidden size-4 justify-self-end text-slate-400 transition-transform md:block", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="max-w-2xl space-y-3 pb-6">
          <p className="text-[13px] text-slate-500">
            {tr("resume", { vues: formatCount(f.maxViews, loc), quand: formatRelative(f.lastPostAt, loc) })}
            {f.bestMultiplier !== null && ` · ${tr("meilleurMultiplicateur", { x: formatOutlierRatio(f.bestMultiplier, loc) })}`}
          </p>
          <ul className="space-y-2 text-sm">
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
        </div>
      )}
    </li>
  );
}

/**
 * Une famille : la même idée d'une langue à l'autre, ses variantes dans l'ordre
 * où elles sont apparues, et quand chacune a circulé (de sa première reprise à
 * la dernière, sur l'axe commun à la famille).
 */
function FamilyBlock({ family }: { family: Family }) {
  const tr = useTranslations("admin.ops.RadarFormats");
  const tl = useTranslations("admin.ops.RadarUi");
  const langKey = (k: string) => k as Parameters<typeof tl>[0];
  const loc = useIntlLocale();
  const now = useNow();
  const start = Math.min(...family.formats.map((f) => f.firstSeenAt));
  const span = Math.max(1, now - start);
  const top = Math.max(...family.formats.map((f) => f.maxViews));
  const day = (t: number) => formatPlannedDay(t, loc, { day: "numeric", month: "numeric" });
  const apps = [...new Set(family.formats.flatMap((f) => f.apps.map((a) => a.name)))];
  const id = `radar-famille-${family.id}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4" data-testid="radar-famille">
      <div className="flex max-w-3xl flex-col gap-1">
        <h3 id={id} className="text-[17px] font-semibold leading-snug text-slate-900">
          {family.label}
        </h3>
        <p className="text-[13px] text-slate-500">{tr("familleSous", { n: family.formats.length, langues: family.langs.length, apps: apps.join(", ") })}</p>
      </div>
      <div>
        <div className={cn("hidden border-b border-slate-200 pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500", FAMILY_COLS)}>
          <span>{tr("colLangue")}</span>
          <span>{tr("colVariante")}</span>
          <span className="flex justify-between">
            <span>{day(start)}</span>
            <span>{day(now)}</span>
          </span>
          <span className="text-right">{tr("colComptes")}</span>
          <span className="text-right">{tr("colMeilleure")}</span>
        </div>
        <ul>
          {family.formats.map((f) => (
            <li key={f.id} className={cn("flex flex-col gap-2 border-b border-slate-100 py-4 md:items-center", FAMILY_COLS)} data-testid="radar-famille-variante">
              <span className="text-sm font-semibold text-slate-900">{tl(langKey(`langueLongue.${f.lang ?? "autre"}`))}</span>
              <span className="min-w-0 break-words text-sm leading-snug text-slate-700">{f.label}</span>
              <span className="relative h-2 rounded-full bg-slate-100" title={tr("circuleDepuis", { le: day(f.firstSeenAt) })} aria-label={tr("circuleDepuis", { le: day(f.firstSeenAt) })} role="img">
                <span
                  className="absolute inset-y-0 rounded-full bg-primary"
                  style={{
                    left: `${((f.firstSeenAt - start) / span) * 100}%`,
                    right: `${Math.max(0, ((now - Math.max(f.lastPostAt, f.firstSeenAt)) / span) * 100)}%`,
                    minWidth: 6,
                    opacity: 0.35 + 0.65 * (f.maxViews / Math.max(1, top)),
                  }}
                />
              </span>
              <span className="hidden text-right text-sm tabular-nums text-slate-600 md:block">{f.accountCount}</span>
              <span className="hidden text-right text-sm font-semibold tabular-nums md:block">{formatCount(f.maxViews, loc)}</span>
              {/* Mobile : les deux chiffres sur une ligne, avec leur libellé. */}
              <span className="text-[13px] tabular-nums text-slate-500 md:hidden">{tr("familleChiffres", { comptes: f.accountCount, vues: formatCount(f.maxViews, loc) })}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
