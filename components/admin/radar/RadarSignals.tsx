"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BookmarkIcon,
  ChevronDownIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatCount, formatDuration, formatOutlierRatio } from "@/components/admin/radar/radar-format";
import { RadarSignalDetail } from "@/components/admin/radar/RadarSignalDetail";
import {
  PRESETS,
  SORTS,
  applyFilters,
  chips as chipsOf,
  clearAll,
  facets,
  fromSearchParams,
  listSince,
  removeChip,
  reset,
  sameFilters,
  suggestions as suggestionsOf,
  tailleOf,
  toSearchParams,
  toggle,
  type Chip,
  type Filters,
  type GroupKey,
} from "@/convex/radarSignalFilters";
import { viewsPerHour } from "@/convex/radarSignalsMath";

export type RadarSignal = FunctionReturnType<typeof api.radarSignals.listSignals>["signals"][number];

const SAVED_VIEWS_KEY = "radar.signaux.vues";
type SavedView = { name: string; qs: string };

function readSavedViews(): SavedView[] {
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is SavedView => typeof x?.name === "string" && typeof x?.qs === "string") : [];
  } catch {
    return [];
  }
}

function writeSavedViews(views: SavedView[]) {
  try {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch {
    // Navigation privée : la vue reste le temps de la page.
  }
}

/** Groupes de cases, dans l'ordre du panneau ; les repliés au départ. */
const GROUP_ORDER: GroupKey[] = ["origine", "langue", "taille", "statut"];
const COLLAPSED_AT_START: Partial<Record<GroupKey, boolean>> = { taille: true, statut: true };

/**
 * NOUVEAU RADAR — écran Signaux : les vidéos qui sortent du lot en ce moment,
 * dans toutes les apps. Filtres purs (convex/radarSignalFilters), état dans
 * l'adresse ; la query lit toute la rétention une fois, les périodes se filtrent
 * ici (ce qui donne leurs compteurs).
 */
export function RadarSignals() {
  const tr = useTranslations("admin.ops.RadarSignals");
  // Clés construites (`groupe.${clé}`) : toutes présentes dans le catalogue, vérifié par l'e2e.
  const k = (key: string) => key as Parameters<typeof tr>[0];
  const age = (ms: number) => {
    const h = Math.max(0, Math.round(ms / 3_600_000));
    return h < 24 ? tr("heures", { n: h }) : tr("jours", { n: Math.round(h / 24) });
  };
  const loc = useIntlLocale();
  const router = useRouter();
  const projectPath = useProjectPath();
  const searchParams = useSearchParams();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const since = listSince(now);
  const data = useProjectQuery(api.radarSignals.listSignals, { since });
  const mark = useProjectMutation(api.radarSignals.markSignal);

  // Les filtres vivent ICI et l'adresse les suit : lus dans l'adresse, une case
  // cliquée ne changeait d'état qu'une fois la navigation finie (elle semblait
  // ne pas répondre). Une adresse changée d'ailleurs (Précédent, lien collé)
  // est relue au rendu suivant.
  // Une adresse que l'écran vient d'écrire n'est pas relue : elle arrive APRÈS
  // l'état (frappe rapide dans la recherche) et le ramènerait en arrière.
  const urlKey = searchParams.toString();
  const [f, setF] = useState<Filters>(() => fromSearchParams(searchParams));
  const [seenUrl, setSeenUrl] = useState(urlKey);
  const [written, setWritten] = useState<readonly string[]>([]);
  if (urlKey !== seenUrl) {
    setSeenUrl(urlKey);
    if (!written.includes(urlKey)) setF(fromSearchParams(searchParams));
  }
  const [collapsed, setCollapsed] = useState(COLLAPSED_AT_START);
  const [facetsOpen, setFacetsOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: RadarSignal["id"]; prev: RadarSignal["status"]; handle: string } | null>(null);
  const [saved, setSaved] = useState<SavedView[]>(() => (typeof window === "undefined" ? [] : readSavedViews()));
  const [brokenCovers, setBrokenCovers] = useState<ReadonlySet<string>>(new Set());

  function apply(next: Filters) {
    setF(next);
    setUndo(null);
    const qs = toSearchParams(next, new URLSearchParams(searchParams)).toString();
    setWritten((w) => [...w.slice(-19), qs]);
    router.replace(projectPath(qs ? `/radar?${qs}` : "/radar"), { scroll: false });
  }

  const signals = useMemo(() => data?.signals ?? [], [data]);
  const results = useMemo(() => applyFilters(signals, f, now), [signals, f, now]);
  const fc = useMemo(() => facets(signals, f, now), [signals, f, now]);
  const activeChips = chipsOf(f);
  const sugg = results.length === 0 ? suggestionsOf(signals, f, now) : [];
  const presetActive = PRESETS.find((p) => !f.q && sameFilters(p.patch(f), f))?.id ?? null;
  const customActive = saved.find((s) => sameFilters(fromSearchParams(new URLSearchParams(s.qs)), f))?.name ?? null;
  const open = signals.find((s) => s.id === openId) ?? null;

  async function setStatus(s: RadarSignal, status: RadarSignal["status"]) {
    await mark({ signalId: s.id, status });
  }

  function chipLabel(c: Chip): string {
    if (c.kind === "q") return tr("chipRecherche", { q: c.value });
    if (c.kind === "age") return tr("chipPeriode", { periode: tr(k(`age.${c.value}`)) });
    if (c.kind === "seuil") return tr(k(`seuil.${c.value}`));
    if (c.kind === "statut") return tr("chipStatut", { statuts: c.values.map((s) => tr(k(`statut.${s}`))).join(", ") || tr("aucunStatut") });
    return `${tr(k(`groupe.${c.key}`))} : ${tr(k(`${c.key}.${c.value}`))}`;
  }

  if (data === undefined) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-80 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Vues enregistrées */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{tr("vuesEnregistrees")}</span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={presetActive === p.id}
            onClick={() => apply({ ...p.patch(f), sort: f.sort })}
            className={cn(
              "min-h-9 rounded-full border px-3.5 text-sm font-medium",
              presetActive === p.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
            )}
          >
            {tr(k(`preset.${p.id}`))}
          </button>
        ))}
        {saved.map((s) => (
          <span key={s.name} className={cn("inline-flex min-h-9 items-center rounded-full border text-sm font-medium", customActive === s.name ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900")}>
            <button type="button" aria-pressed={customActive === s.name} onClick={() => apply(fromSearchParams(new URLSearchParams(s.qs)))} className="px-3.5">
              {s.name}
            </button>
            <button
              type="button"
              aria-label={tr("supprimerLaVue", { nom: s.name })}
              onClick={() => {
                const next = saved.filter((x) => x.name !== s.name);
                setSaved(next);
                writeSavedViews(next);
              }}
              className="pr-2.5"
            >
              <XIcon className="size-3.5" />
            </button>
          </span>
        ))}
        {presetActive === null && customActive === null && (
          <button
            type="button"
            onClick={() => {
              const next = [...saved, { name: tr("maVue", { n: saved.length + 1 }), qs: toSearchParams(f).toString() }];
              setSaved(next);
              writeSavedViews(next);
            }}
            className="min-h-9 rounded-full border border-dashed border-slate-400 bg-white px-3.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            {tr("enregistrerCetteVue")}
          </button>
        )}
      </div>

      {/* Recherche, bouton filtres (téléphone), tri */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-11 flex-[1_1_320px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3">
          <SearchIcon className="size-4 text-slate-500" aria-hidden />
          <span className="sr-only">{tr("rechercher")}</span>
          <input
            type="search"
            value={f.q}
            onChange={(e) => apply({ ...f, q: e.target.value })}
            placeholder={tr("placeholderRecherche")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => setFacetsOpen((o) => !o)}
          aria-expanded={facetsOpen}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium md:hidden"
        >
          <SlidersHorizontalIcon className="size-4" aria-hidden />
          {activeChips.length ? tr("filtresN", { n: activeChips.length }) : tr("filtres")}
        </button>
        <div role="group" aria-label={tr("trierPar")} className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          <span className="px-1.5 text-xs text-slate-500">{tr("trierPar")}</span>
          {SORTS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={f.sort === s}
              onClick={() => apply({ ...f, sort: s })}
              className={cn("min-h-9 rounded-md px-2.5 text-sm", f.sort === s ? "bg-white font-semibold text-slate-900 shadow-sm" : "text-slate-600")}
            >
              {tr(k(`tri.${s}`))}
            </button>
          ))}
        </div>
      </div>

      {/* Nombre de résultats et pastilles */}
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900" data-testid="radar-signaux-compte">
          {tr("nVideos", { n: results.length })}
        </span>
        <span className="text-sm text-slate-500">
          {tr("contexte", { total: signals.length, periode: tr(k(`contexteAge.${f.age}`)) })}
        </span>
        {activeChips.map((c) => (
          <button
            key={c.kind === "group" ? `${c.key}:${c.value}` : c.kind}
            type="button"
            onClick={() => apply(removeChip(f, c))}
            aria-label={tr("retirerLeFiltre", { filtre: chipLabel(c) })}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-orange-300 bg-orange-50 py-1 pl-3 pr-2 text-sm text-orange-900"
          >
            {chipLabel(c)}
            <XIcon className="size-3.5" aria-hidden />
          </button>
        ))}
        {activeChips.length > 0 && (
          <button type="button" onClick={() => apply(clearAll(f))} className="min-h-8 px-2 text-sm font-semibold text-orange-700 underline">
            {tr("toutEffacer")}
          </button>
        )}
        {data.truncated && <span className="text-xs text-slate-500">{tr("tronque")}</span>}
      </div>

      <div className="flex flex-wrap items-start gap-6">
        {/* Panneau de filtres */}
        <aside
          aria-label={tr("filtres")}
          className={cn("w-full flex-[1_1_240px] rounded-xl border border-slate-200 bg-slate-50 md:block md:max-w-[280px]", facetsOpen ? "block" : "hidden")}
        >
          <div className="flex flex-col gap-0.5 border-b border-slate-200 px-4 py-3">
            <span className="font-semibold">{tr("filtres")}</span>
            <span className="text-xs text-slate-500">{tr("logique")}</span>
          </div>

          {(["age", "seuil"] as const).map((key) => (
            <fieldset key={key} className="border-b border-slate-200 px-4 py-3">
              <legend className="mb-2 float-left w-full font-semibold">{tr(k(`singleTitre.${key}`))}</legend>
              <div className="clear-both flex flex-wrap gap-1.5">
                {(key === "age" ? fc.age : fc.seuil).map((o) => (
                  <label
                    key={o.value}
                    className={cn(
                      "relative inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-slate-400",
                      o.checked ? "border-slate-900 bg-slate-900 font-semibold text-white" : "border-slate-300 bg-white",
                      !o.checked && o.count === 0 && "text-slate-400",
                    )}
                  >
                    <input
                      type="radio"
                      name={`radar-${key}`}
                      checked={o.checked}
                      onChange={() => apply(key === "age" ? { ...f, age: o.value as Filters["age"] } : { ...f, seuil: o.value as Filters["seuil"] })}
                      className="sr-only"
                    />
                    {key === "age" ? tr(k(`age.${o.value}`)) : tr(k(`seuil.${o.value}`))}
                    <span className={cn("text-xs tabular-nums", o.checked ? "text-slate-200" : "text-slate-500")}>{o.count}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          {GROUP_ORDER.map((key) => {
            const g = fc.groups.find((x) => x.key === key)!;
            const nSel = key === "statut" ? (activeChips.some((c) => c.kind === "statut") ? f.sel.statut.length : 0) : f.sel[key].length;
            const expanded = !collapsed[key];
            return (
              <div key={key} className="border-b border-slate-200 last:border-b-0">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setCollapsed((c) => ({ ...c, [key]: expanded }))}
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-4 py-3 text-left font-semibold"
                >
                  <span className="flex items-center gap-2">
                    {tr(k(`groupe.${key}`))}
                    {nSel > 0 && <span className="rounded-full bg-slate-900 px-2 text-xs font-semibold text-white">{nSel}</span>}
                  </span>
                  <ChevronDownIcon className={cn("size-4 text-slate-500 transition-transform", expanded && "rotate-180")} aria-hidden />
                </button>
                {expanded && (
                  <div className="flex flex-col gap-0.5 px-4 pb-3">
                    {g.options.map((o) => (
                      <label
                        key={o.value}
                        className={cn(
                          "flex min-h-9 items-center gap-2.5 rounded-md px-1.5 text-sm",
                          o.disabled ? "cursor-not-allowed text-slate-400" : "cursor-pointer text-slate-900",
                          o.checked && "bg-white font-semibold",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={o.checked}
                          disabled={o.disabled}
                          onChange={() => apply(toggle(f, key, o.value))}
                          className="size-4 accent-slate-900"
                        />
                        <span className="flex-1">{tr(k(`${key}.${o.value}`))}</span>
                        <span className={cn("text-xs tabular-nums", o.disabled ? "text-slate-400" : "text-slate-500")}>{o.count}</span>
                      </label>
                    ))}
                    {nSel > 0 && (
                      <button type="button" onClick={() => apply(reset(f, key))} className="mt-1 self-start text-sm text-slate-600 underline">
                        {tr("effacerCeFiltre")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        {/* Résultats */}
        <section aria-label={tr("resultats")} className="min-w-0 flex-[999_1_560px] space-y-4">
          {undo && (
            <div role="status" className="flex items-center justify-between gap-3 rounded-lg bg-slate-900 px-4 py-2.5 text-white">
              <span>{tr("videoIgnoree", { handle: undo.handle })}</span>
              <button
                type="button"
                onClick={async () => {
                  const u = undo;
                  setUndo(null);
                  await mark({ signalId: u.id, status: u.prev });
                }}
                className="min-h-9 rounded-md border border-slate-500 px-3 text-sm font-semibold"
              >
                {tr("annuler")}
              </button>
            </div>
          )}

          {signals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
              <p className="font-semibold text-slate-900">{tr("aucunSignalTitre")}</p>
              <p className="mt-1 text-sm text-slate-500">{tr("aucunSignalTexte")}</p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center">
              <p className="font-semibold text-slate-900">{tr("videVideTitre")}</p>
              <p className="text-sm text-slate-500">{tr("videVideTexte")}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {sugg.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => apply(reset(f, s.key))}
                    className="min-h-10 rounded-full border border-slate-300 bg-white px-3.5 text-sm font-medium hover:bg-slate-50"
                  >
                    {tr("retirerAvecCompte", { filtre: tr(k(`filtreNom.${s.key}`)), n: s.count })}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => apply(clearAll(f))} className="text-sm font-semibold text-orange-700 underline">
                {tr("toutEffacer")}
              </button>
            </div>
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
              {results.map((s) => {
                const isSaved = s.status === "enregistre";
                const showCover = s.coverUrl && !brokenCovers.has(s.id);
                return (
                  <article key={s.id} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="radar-signal">
                    <button
                      type="button"
                      onClick={() => setOpenId(s.id)}
                      aria-label={tr("voirLeDetail", { handle: s.handle })}
                      className="relative flex h-52 flex-col justify-end bg-stone-900 p-3.5 text-left text-white"
                    >
                      {showCover && (
                        // eslint-disable-next-line @next/next/no-img-element -- miniature TikTok signée, hors domaine optimisable
                        <img
                          src={s.coverUrl!}
                          alt=""
                          loading="lazy"
                          onError={() => setBrokenCovers((b) => new Set(b).add(s.id))}
                          className="absolute inset-0 size-full object-cover opacity-70"
                        />
                      )}
                      <span className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
                        <span className="rounded-md bg-orange-500 px-2 py-0.5 text-[13px] font-bold text-slate-950">{formatOutlierRatio(s.ratio, loc)}</span>
                        {s.competitor && <span className="rounded-md bg-white px-2 py-0.5 text-xs font-semibold text-slate-900">{s.competitor}</span>}
                        {s.inCurve && <span className="rounded-md bg-slate-900/80 px-2 py-0.5 text-xs font-semibold text-white">{tr("courbeEnCours")}</span>}
                      </span>
                      <span className="relative line-clamp-4 text-[15px] font-semibold leading-snug [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
                        {s.caption || `@${s.handle}`}
                      </span>
                      {s.durationSec !== null && <span className="relative mt-2 text-xs text-stone-200">{formatDuration(s.durationSec)}</span>}
                    </button>
                    <div className="flex flex-1 flex-col gap-2 px-3.5 py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-base font-bold">{tr("vues", { n: formatCount(s.views, loc) })}</span>
                        <span className="text-[13px] text-slate-500">{tr("ilYA", { duree: age(now - s.publishedAt) })}</span>
                      </div>
                      <div className="text-[13px] text-slate-500">
                        {tr("vuesParHeure", { n: formatCount(viewsPerHour(s.views, s.publishedAt, now), loc) })} · {tr("abonnes", { n: formatCount(s.fans, loc) })}
                      </div>
                      <div className="truncate text-[13px]">@{s.handle}</div>
                      <div className="flex flex-wrap gap-1">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{tr(k(`langueCourte.${s.lang}`))}</span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{tr(k(`taille.${tailleOf(s.fans)}`))}</span>
                        {s.status !== "nouveau" && <span className="rounded-md bg-slate-900 px-2 py-0.5 text-xs text-white">{tr(k(`statutCourt.${s.status}`))}</span>}
                      </div>
                      <div className="mt-auto flex gap-1.5 pt-1">
                        <button type="button" onClick={() => setOpenId(s.id)} className="min-h-10 flex-1 rounded-lg bg-slate-900 text-[13px] font-semibold text-white">
                          {tr("voir")}
                        </button>
                        <button
                          type="button"
                          aria-pressed={isSaved}
                          aria-label={isSaved ? tr("retirerDesEnregistrees") : tr("enregistrer")}
                          onClick={() => setStatus(s, isSaved ? "nouveau" : "enregistre")}
                          className={cn("flex min-h-10 w-10 items-center justify-center rounded-lg border bg-white", isSaved ? "border-slate-900" : "border-slate-300")}
                        >
                          <BookmarkIcon className={cn("size-4", isSaved && "fill-slate-900")} aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={tr("ignorer", { handle: s.handle })}
                          onClick={async () => {
                            await setStatus(s, "ignore");
                            setUndo({ id: s.id, prev: s.status, handle: s.handle });
                          }}
                          className="flex min-h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white"
                        >
                          <XIcon className="size-4 text-slate-600" aria-hidden />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <RadarSignalDetail signal={open} now={now} onClose={() => setOpenId(null)} onStatus={(st) => open && setStatus(open, st)} />
    </div>
  );
}
