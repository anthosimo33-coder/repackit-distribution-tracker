"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDownIcon, SearchIcon, XIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatCount } from "@/components/admin/radar/radar-format";
import { ACCENT_LINK, ScoreBadge, SignalActions, SignalThumb, Sparkline, signalTitle, useAge, useNow, useSignalStatus, type RadarSignal } from "@/components/admin/radar/radar-ui";
import { RadarViewer, type ViewerQueue } from "@/components/admin/radar/RadarViewer";
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
  toSearchParams,
  toggle,
  type Chip,
  type FacetOption,
  type Filters,
  type GroupKey,
} from "@/convex/radarSignalFilters";

export type { RadarSignal } from "@/components/admin/radar/radar-ui";

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

/** Les quatre filtres de la barre ; les autres sont derrière « Plus de filtres ». */
const MAIN_GROUPS: GroupKey[] = ["app", "langue", "origine"];
const MORE_GROUPS: GroupKey[] = ["plateforme", "taille", "statut"];

/**
 * RADAR — EXPLORER › VIDÉOS : toutes les vidéos qui sortent du lot, dans toutes
 * les apps. Quatre filtres visibles (période, app, langue, origine), le reste
 * derrière « Plus de filtres » ; filtres purs (convex/radarSignalFilters, mêmes
 * règles que l'outil MCP `signaux`), état dans l'adresse. Une ligne par vidéo ;
 * un clic l'ouvre en grand (Regarder une par une), la liste devient la file.
 */
export function RadarSignals() {
  const tr = useTranslations("admin.ops.RadarSignals");
  // Clés construites (`groupe.${clé}`) : toutes présentes dans le catalogue, vérifié par l'e2e.
  const k = (key: string) => key as Parameters<typeof tr>[0];
  const router = useRouter();
  const projectPath = useProjectPath();
  const searchParams = useSearchParams();
  const now = useNow();
  const since = listSince(now);
  const data = useProjectQuery(api.radarSignals.listSignals, { since });
  const setStatus = useSignalStatus();

  // Les filtres vivent ICI et l'adresse les suit : lus dans l'adresse, une case
  // cliquée ne changeait d'état qu'une fois la navigation finie (elle semblait
  // ne pas répondre). Une adresse changée d'ailleurs (Précédent, lien collé)
  // est relue au rendu suivant ; une adresse que l'écran vient d'écrire non (elle
  // arrive APRÈS l'état et le ramènerait en arrière pendant une frappe rapide).
  const urlKey = searchParams.toString();
  const [f, setF] = useState<Filters>(() => fromSearchParams(searchParams));
  const [seenUrl, setSeenUrl] = useState(urlKey);
  const [written, setWritten] = useState<readonly string[]>([]);
  if (urlKey !== seenUrl) {
    setSeenUrl(urlKey);
    if (!written.includes(urlKey)) setF(fromSearchParams(searchParams));
  }
  const [saved, setSaved] = useState<SavedView[]>(() => (typeof window === "undefined" ? [] : readSavedViews()));
  const [viewer, setViewer] = useState<ViewerQueue | null>(null);

  function apply(next: Filters) {
    setF(next);
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

  const optionLabel = (key: GroupKey, value: string) => (key === "app" ? value : tr(k(`${key}.${value}`)));
  function chipLabel(c: Chip): string {
    if (c.kind === "q") return tr("chipRecherche", { q: c.value });
    if (c.kind === "age") return tr("chipPeriode", { periode: tr(k(`age.${c.value}`)) });
    if (c.kind === "seuil") return tr(k(`seuil.${c.value}`));
    if (c.kind === "statut") return tr("chipStatut", { statuts: c.values.map((s) => tr(k(`statut.${s}`))).join(", ") || tr("aucunStatut") });
    return `${tr(k(`groupe.${c.key}`))} : ${optionLabel(c.key, c.value)}`;
  }
  /** Ce que dit le bouton d'un filtre : « Toutes », la valeur, ou « 3 choisies ». */
  function summary(key: GroupKey): string {
    const sel = f.sel[key];
    if (key === "statut") return activeChips.some((c) => c.kind === "statut") ? tr("nChoisis", { n: sel.length }) : tr("parDefaut");
    if (sel.length === 0) return tr("toutes");
    if (sel.length === 1) return optionLabel(key, sel[0]);
    return tr("nChoisis", { n: sel.length });
  }
  const groupOf = (key: GroupKey) => fc.groups.find((g) => g.key === key)!;
  const moreCount = MORE_GROUPS.filter((g) => activeChips.some((c) => (c.kind === "group" && c.key === g) || (g === "statut" && c.kind === "statut"))).length + (f.seuil !== "0" ? 1 : 0);

  if (data === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-11 w-full" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Recherche et vues enregistrées */}
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
        <Menu label={tr("vues")} value={presetActive ? tr(k(`preset.${presetActive}`)) : (customActive ?? tr("aucuneVue"))} align="end">
          <div className="flex flex-col gap-0.5 p-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={presetActive === p.id}
                onClick={() => apply({ ...p.patch(f), sort: f.sort })}
                className={cn("min-h-9 rounded-md px-2.5 text-left text-sm", presetActive === p.id ? "bg-slate-900 font-semibold text-white" : "hover:bg-slate-100")}
              >
                {tr(k(`preset.${p.id}`))}
              </button>
            ))}
            {saved.map((s) => (
              <span key={s.name} className={cn("flex min-h-9 items-center rounded-md text-sm", customActive === s.name ? "bg-slate-900 font-semibold text-white" : "hover:bg-slate-100")}>
                <button type="button" aria-pressed={customActive === s.name} onClick={() => apply(fromSearchParams(new URLSearchParams(s.qs)))} className="flex-1 px-2.5 text-left">
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
                  className="px-2"
                >
                  <XIcon className="size-3.5" aria-hidden />
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
                className="mt-1 min-h-9 rounded-md border border-dashed border-slate-400 px-2.5 text-left text-sm font-medium"
              >
                {tr("enregistrerCetteVue")}
              </button>
            )}
          </div>
        </Menu>
      </div>

      {/* Les filtres, puis le tri */}
      <div className="flex flex-wrap items-center gap-2">
        <Menu label={tr("groupe.periode")} value={tr(k(`age.${f.age}`))}>
          <RadioList
            name="radar-age"
            legend={tr("singleTitre.age")}
            options={fc.age.map((o) => ({ value: o.value, label: tr(k(`age.${o.value}`)), count: o.count, checked: o.checked }))}
            onPick={(v) => apply({ ...f, age: v as Filters["age"] })}
          />
        </Menu>
        {MAIN_GROUPS.map((key) =>
          groupOf(key).options.length === 0 ? null : (
            <Menu key={key} label={tr(k(`groupe.${key}`))} value={summary(key)} active={f.sel[key].length > 0}>
              <CheckList
                legend={tr(k(`groupe.${key}`))}
                options={groupOf(key).options}
                label={(v) => optionLabel(key, v)}
                onToggle={(v) => apply(toggle(f, key, v))}
                onClear={f.sel[key].length ? () => apply(reset(f, key)) : null}
                clearLabel={tr("effacerCeFiltre")}
              />
            </Menu>
          ),
        )}
        <Menu label={tr("plusDeFiltres")} value={moreCount ? `(${moreCount})` : ""} active={moreCount > 0} dashed>
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-1">
            {MORE_GROUPS.map((key) => {
              const isStatut = key === "statut";
              const hasSel = isStatut ? activeChips.some((c) => c.kind === "statut") : f.sel[key].length > 0;
              return (
                <CheckList
                  key={key}
                  legend={tr(k(`groupe.${key}`))}
                  options={groupOf(key).options}
                  label={(v) => optionLabel(key, v)}
                  onToggle={(v) => apply(toggle(f, key, v))}
                  onClear={hasSel ? () => apply(reset(f, key)) : null}
                  clearLabel={tr("effacerCeFiltre")}
                />
              );
            })}
            <RadioList
              name="radar-seuil"
              legend={tr("singleTitre.seuil")}
              options={fc.seuil.map((o) => ({ value: o.value, label: tr(k(`seuil.${o.value}`)), count: o.count, checked: o.checked }))}
              onPick={(v) => apply({ ...f, seuil: v as Filters["seuil"] })}
            />
          </div>
        </Menu>
        <span className="flex-1" />
        <Menu label={tr("trierPar")} value={tr(k(`tri.${f.sort}`))} align="end" plain>
          <RadioList
            name="radar-tri"
            legend={tr("trierPar")}
            options={SORTS.map((s) => ({ value: s, label: tr(k(`tri.${s}`)), checked: f.sort === s }))}
            onPick={(v) => apply({ ...f, sort: v as Filters["sort"] })}
          />
        </Menu>
      </div>

      {/* Nombre de résultats et pastilles */}
      <div className="flex min-h-9 flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900" data-testid="radar-signaux-compte">
          {tr("nVideos", { n: results.length })}
        </span>
        <span className="text-sm text-slate-500">{tr("contexte", { total: signals.length, periode: tr(k(`contexteAge.${f.age}`)) })}</span>
        {activeChips.map((c) => (
          <button
            key={c.kind === "group" ? `${c.key}:${c.value}` : c.kind}
            type="button"
            onClick={() => apply(removeChip(f, c))}
            aria-label={tr("retirerLeFiltre", { filtre: chipLabel(c) })}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-1 pl-3 pr-2 text-sm text-slate-900"
          >
            {chipLabel(c)}
            <XIcon className="size-3.5" aria-hidden />
          </button>
        ))}
        {activeChips.length > 0 && (
          <button type="button" onClick={() => apply(clearAll(f))} className={cn("min-h-8 px-2 text-sm", ACCENT_LINK)}>
            {tr("toutEffacer")}
          </button>
        )}
        {data.truncated && <span className="text-xs text-slate-500">{tr("tronque")}</span>}
      </div>

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
          <button type="button" onClick={() => apply(clearAll(f))} className={cn("text-sm", ACCENT_LINK)}>
            {tr("toutEffacer")}
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label={tr("resultats")}>
          {results.map((s, i) => (
            <SignalRow key={s.id} s={s} now={now} onOpen={() => setViewer({ ids: results.map((x) => x.id), index: i })} onStatus={(st) => void setStatus(s, st)} />
          ))}
        </ul>
      )}

      <RadarViewer queue={viewer} signals={signals} now={now} onChange={setViewer} />
    </div>
  );
}

/** Une vidéo en ligne : de quoi comparer vite ; un clic l'ouvre en grand. */
function SignalRow({ s, now, onOpen, onStatus }: { s: RadarSignal; now: number; onOpen: () => void; onStatus: (st: RadarSignal["status"]) => void }) {
  const tr = useTranslations("admin.ops.RadarSignals");
  const tu = useTranslations("admin.ops.RadarUi");
  const k = (key: string) => key as Parameters<typeof tr>[0];
  const loc = useIntlLocale();
  const age = useAge();
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5" data-testid="radar-signal">
      <button type="button" onClick={onOpen} aria-label={tu("regarderDe", { handle: s.handle })} className="flex min-w-0 flex-[1_1_320px] items-center gap-3 text-left">
        <SignalThumb s={s} className="h-16 w-9 shrink-0 rounded-md" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="line-clamp-2 text-sm font-medium leading-snug text-slate-900">{signalTitle(s)}</span>
          <span className="truncate text-xs text-slate-500">
            @{s.handle} · {tu(`langueLongue.${s.lang}` as Parameters<typeof tu>[0])}
            {s.platform === "instagram" && ` · ${tu("instagram")}`}
          </span>
        </span>
      </button>
      <span className="flex w-[150px] shrink-0 flex-wrap items-center gap-1.5">
        {s.app && (
          <span className={cn("truncate rounded-md px-1.5 py-0.5 text-xs font-semibold", s.competitor ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700")}>
            {s.app}
          </span>
        )}
        {s.network && (
          <span className="truncate text-xs text-slate-500" title={tu("compteSuiviPourAide", { app: s.network })} data-testid="radar-reseau-seul">
            {tu("compteSuiviPour", { app: s.network })}
          </span>
        )}
        {s.status !== "nouveau" && (
          <span className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs text-slate-700" data-testid="radar-statut">
            {tr(k(`statutCourt.${s.status}`))}
          </span>
        )}
      </span>
      <span className="w-[92px] shrink-0">
        <ScoreBadge s={s} />
      </span>
      <span className="w-[72px] shrink-0 text-right text-sm font-semibold tabular-nums">{formatCount(s.views, loc)}</span>
      <Sparkline s={s} className="shrink-0" />
      <span className="w-[72px] shrink-0 text-[13px] text-slate-500">{age(s.publishedAt, now)}</span>
      <span className="shrink-0">
        <SignalActions s={s} onStatus={onStatus} compact />
      </span>
    </li>
  );
}

/** Un bouton de filtre qui ouvre son menu : « Langue · Toutes ». */
function Menu({
  label,
  value,
  children,
  active = false,
  dashed = false,
  plain = false,
  align = "start",
}: {
  label: string;
  value: string;
  children: React.ReactNode;
  active?: boolean;
  dashed?: boolean;
  plain?: boolean;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm",
              plain ? "text-slate-900" : "border bg-white",
              !plain && (active ? "border-primary/50 bg-primary/10" : dashed ? "border-dashed border-slate-400" : "border-slate-300"),
            )}
          >
            <span className="text-slate-500">{label}</span>
            {value && <span className="font-semibold text-slate-900">{value}</span>}
            <ChevronDownIcon className="size-3.5 text-slate-500" aria-hidden />
          </button>
        }
      />
      <PopoverContent align={align} className="w-max min-w-[240px] max-w-[min(360px,calc(100vw-2rem))] p-2">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Des cases à cocher avec leur compteur : ce qu'on obtient en cochant, compte tenu des autres filtres. */
function CheckList({
  legend,
  options,
  label,
  onToggle,
  onClear,
  clearLabel,
}: {
  legend: string;
  options: FacetOption[];
  label: (v: string) => string;
  onToggle: (v: string) => void;
  onClear: (() => void) | null;
  clearLabel: string;
}) {
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className="mb-1 px-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{legend}</legend>
      <div className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex min-h-9 items-center gap-2.5 rounded-md px-1.5 text-sm",
              o.disabled ? "cursor-not-allowed text-slate-400" : "cursor-pointer text-slate-900 hover:bg-slate-50",
              o.checked && "font-semibold",
            )}
          >
            <input type="checkbox" checked={o.checked} disabled={o.disabled} onChange={() => onToggle(o.value)} className="size-4 accent-slate-900" />
            <span className="flex-1">{label(o.value)}</span>
            <span className={cn("text-xs tabular-nums", o.disabled ? "text-slate-400" : "text-slate-500")}>{o.count}</span>
          </label>
        ))}
      </div>
      {onClear && (
        <button type="button" onClick={onClear} className="mt-1 self-start px-1.5 text-sm text-slate-600 underline">
          {clearLabel}
        </button>
      )}
    </fieldset>
  );
}

/** Un choix unique (période, seuil, tri), avec son compteur quand il en a un. */
function RadioList({
  name,
  legend,
  options,
  onPick,
}: {
  name: string;
  legend: string;
  options: { value: string; label: string; count?: number; checked: boolean }[];
  onPick: (v: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className="mb-1 px-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={cn("flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-sm hover:bg-slate-50", o.checked && "font-semibold")}>
          <input type="radio" name={name} checked={o.checked} onChange={() => onPick(o.value)} className="size-4 accent-slate-900" />
          <span className="flex-1">{o.label}</span>
          {o.count !== undefined && <span className="text-xs tabular-nums text-slate-500">{o.count}</span>}
        </label>
      ))}
    </fieldset>
  );
}
