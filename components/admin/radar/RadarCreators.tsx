"use client";

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useTranslations } from "next-intl";
import { ArrowLeftIcon, ArrowRightIcon, ExternalLinkIcon, PlayIcon, SearchIcon } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProject } from "@/components/project/ProjectProvider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatCount, formatOutlierRatio } from "@/components/admin/radar/radar-format";
import { AccentTag, SignalThumb, useAge, useNow } from "@/components/admin/radar/radar-ui";
import { Menu, RadioList } from "@/components/admin/radar/RadarSignals";
import { Player } from "@/components/admin/radar/RadarViewer";
import {
  CREATOR_LANGS,
  CREATOR_SORTS,
  DEFAULT_CREATOR_LANG,
  DEFAULT_CREATOR_SORT,
  appOptions,
  filterCreators,
  sortCreators,
  type CreatorLang,
  type CreatorSort,
} from "@/convex/radarCreatorsMath";

type Creator = FunctionReturnType<typeof api.radarCreators.listCreators>[number];
type AccountId = Id<"radarTracked">;
type CreatorVideo = NonNullable<FunctionReturnType<typeof api.radarCreators.creatorVideosOf>>["videos"][number];

/** À partir de 3 fois sa normale, une vidéo porte son score dans la fiche (le seuil des signaux). */
const OUTLIER = 3;

/**
 * RADAR — CRÉATEURS : les comptes suivis d'une langue (le français d'abord), à
 * contacter. Chaque ligne dit qui c'est (bio), pour quelle app, ce que ses
 * vidéos font d'habitude ; sa fiche montre tous ses TikToks relevés, à regarder
 * sur place, et mène à son profil TikTok pour lui écrire.
 */
export function RadarCreators() {
  const tr = useTranslations("admin.ops.RadarCreators");
  const tu = useTranslations("admin.ops.RadarUi");
  const k = (key: string) => key as Parameters<typeof tr>[0];
  const langLabel = (l: CreatorLang) => tu(`langueLongue.${l}` as Parameters<typeof tu>[0]);
  const loc = useIntlLocale();
  const { project } = useProject();
  const now = useNow();
  const age = useAge();
  const [lang, setLang] = useState<CreatorLang>(DEFAULT_CREATOR_LANG);
  const [app, setApp] = useState<string | null>(null);
  const [sort, setSort] = useState<CreatorSort>(DEFAULT_CREATOR_SORT);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<AccountId | null>(null);
  const rows = useProjectQuery(api.radarCreators.listCreators, { lang });

  const options = appOptions(rows ?? []);
  // Une app choisie qui n'a personne dans la langue affichée ne filtre plus rien.
  const appShown = app !== null && options.some((o) => o.name === app) ? app : null;
  const list = sortCreators(filterCreators(rows ?? [], { app: appShown, q }), sort);
  const rivals = (rows ?? []).filter((r) => r.rival).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 flex-[1_1_300px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3">
          <SearchIcon className="size-4 text-slate-500" aria-hidden />
          <span className="sr-only">{tr("rechercher")}</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr("placeholderRecherche")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <Menu label={tr("langue")} value={langLabel(lang)}>
          <RadioList
            name="radar-createurs-langue"
            legend={tr("langueTitre")}
            options={CREATOR_LANGS.map((l) => ({ value: l, label: langLabel(l), checked: l === lang }))}
            onPick={(v) => setLang(v as CreatorLang)}
          />
        </Menu>
        <Menu label={tr("app")} value={appShown ?? tr("toutesLesApps")} active={appShown !== null}>
          <div className="max-h-[60vh] overflow-y-auto">
            <RadioList
              name="radar-createurs-app"
              legend={tr("appTitre")}
              options={[
                { value: "", label: tr("toutesLesApps"), count: rows?.length ?? 0, checked: appShown === null },
                ...options.map((o) => ({ value: o.name, label: o.rival ? tu("appConcurrent", { app: o.name }) : o.name, count: o.count, checked: appShown === o.name })),
              ]}
              onPick={(v) => setApp(v || null)}
            />
          </div>
        </Menu>
        <span className="flex-1" />
        <Menu label={tr("trierPar")} value={tr(k(`tri.${sort}`))} align="end" plain>
          <RadioList
            name="radar-createurs-tri"
            legend={tr("trierPar")}
            options={CREATOR_SORTS.map((s) => ({ value: s, label: tr(k(`tri.${s}`)), checked: sort === s }))}
            onPick={(v) => setSort(v as CreatorSort)}
          />
        </Menu>
      </div>

      {rows === undefined ? (
        <Skeleton className="h-[480px] w-full" />
      ) : (
        <>
          <p className="flex min-h-9 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-semibold text-slate-900" data-testid="radar-createurs-compte">
              {tr("nCreateurs", { n: list.length })}
            </span>
            <span className="text-sm text-slate-500">
              {tr("contexte", { langue: langLabel(lang) })}
              {rivals > 0 && appShown === null && !q.trim() && ` · ${tr("dontConcurrents", { n: rivals, projet: project.name })}`}
            </span>
          </p>

          {list.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center" data-testid="radar-createurs-vide">
              <p className="font-semibold text-slate-900">{rows.length === 0 ? tr("aucunTitre", { langue: langLabel(lang) }) : tr("aucunResultatTitre")}</p>
              <p className="mt-1 text-sm text-slate-500">{rows.length === 0 ? tr("aucunTexte") : tr("aucunResultatTexte")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label={tr("liste")}>
              {list.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5" data-testid="radar-createur">
                  <div className="min-w-0 flex-[1_1_340px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-slate-900">@{c.handle}</span>
                      {c.app && <AppTag app={c.app} rival={c.rival} />}
                    </div>
                    {c.bio && <p className="mt-1 line-clamp-2 break-words text-[13px] leading-snug text-slate-600">{c.bio}</p>}
                  </div>
                  {/* Quatre colonnes de même largeur : les chiffres s'alignent d'une ligne à l'autre, et tiennent sur un téléphone. */}
                  <dl className="grid w-full grid-cols-4 items-start gap-x-3 sm:w-auto sm:shrink-0 sm:grid-cols-[repeat(4,96px)] sm:gap-x-4 sm:text-right">
                    <Stat label={tr("abonnes")} value={formatCount(c.fans, loc)} />
                    <Stat label={tr("parVideo")} value={c.medianViews === null ? "—" : formatCount(c.medianViews, loc)} />
                    <Stat label={tr("cetteSemaine")} value={String(c.posts7d)} />
                    <Stat label={tr("derniere")} value={c.lastPostAt === null ? "—" : age(c.lastPostAt, now)} />
                  </dl>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(c.id)}
                      aria-label={tr("voirSesVideosDe", { handle: c.handle })}
                      className="inline-flex min-h-10 items-center rounded-lg bg-slate-900 px-3.5 text-[13px] font-semibold text-white"
                    >
                      {tr("voirSesVideos")}
                    </button>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={tr("profilTiktokDe", { handle: c.handle })}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-900 hover:bg-slate-50"
                    >
                      {tr("profilTiktok")}
                      <ExternalLinkIcon className="size-3.5" aria-hidden />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <CreatorFiche list={list} openId={open} now={now} onChange={setOpen} />
    </div>
  );
}

function AppTag({ app, rival }: { app: string; rival: boolean }) {
  const tu = useTranslations("admin.ops.RadarUi");
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-semibold", rival ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700")}>
      {rival ? tu("appConcurrent", { app }) : app}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end">
      <dt className="text-xs leading-snug text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

/**
 * La fiche d'un créateur : qui c'est, le lien vers son profil pour lui écrire, et
 * tous ses TikToks relevés — un clic en lit un sur place. Les flèches passent au
 * créateur précédent ou suivant de la liste, haut et bas d'une vidéo à l'autre.
 */
function CreatorFiche({ list, openId, now, onChange }: { list: readonly Creator[]; openId: AccountId | null; now: number; onChange: (id: AccountId | null) => void }) {
  const tr = useTranslations("admin.ops.RadarCreators");
  const loc = useIntlLocale();
  const index = openId === null ? -1 : list.findIndex((c) => c.id === openId);
  const c = index >= 0 ? list[index] : null;
  const data = useProjectQuery(api.radarCreators.creatorVideosOf, c ? { accountId: c.id } : "skip");
  // La vidéo choisie vaut pour le créateur affiché : en changer revient à sa plus récente.
  const [picked, setPicked] = useState<{ of: string; videoId: string } | null>(null);
  const videos = data?.videos ?? [];
  const current = videos.find((v) => c !== null && picked?.of === c.id && v.videoId === picked.videoId) ?? videos[0] ?? null;
  const at = current ? videos.indexOf(current) : -1;

  const goCreator = (i: number) => {
    if (i >= 0 && i < list.length) onChange(list[i].id);
  };
  const goVideo = (i: number) => {
    if (c && i >= 0 && i < videos.length) setPicked({ of: c.id, videoId: videos[i].videoId });
  };

  function onKeyDown(e: React.KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight") goCreator(index + 1);
    else if (e.key === "ArrowLeft") goCreator(index - 1);
    else if (e.key === "ArrowDown") goVideo(at + 1);
    else if (e.key === "ArrowUp") goVideo(at - 1);
    else return;
    e.preventDefault();
  }

  const isPrivate = videos.some((v) => v.unavailable?.reason === "private");

  return (
    <Dialog open={c !== null} onOpenChange={(o) => !o && onChange(null)}>
      <DialogContent className="gap-5 p-5 sm:max-w-[1180px] md:p-6" onKeyDown={onKeyDown} data-testid="radar-fiche-createur">
        {c && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pr-8">
              <div className="min-w-0 flex-[1_1_420px]">
                <div className="flex flex-wrap items-center gap-2.5">
                  <DialogTitle className="text-xl font-semibold tracking-tight">@{c.handle}</DialogTitle>
                  {c.app && <AppTag app={c.app} rival={c.rival} />}
                  {isPrivate && (
                    <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800" data-testid="radar-createur-prive">
                      {tr("comptePrive")}
                    </span>
                  )}
                </div>
                <DialogDescription className="mt-1 text-[13px] text-slate-500">
                  {tr("resume", {
                    abonnes: formatCount(c.fans, loc),
                    semaine: c.posts7d,
                    habitude: c.medianViews === null ? "" : tr("resumeHabitude", { n: formatCount(c.medianViews, loc) }),
                  })}
                </DialogDescription>
                {c.bio && <p className="mt-2.5 line-clamp-4 whitespace-pre-line break-words text-sm leading-relaxed text-slate-700">{c.bio}</p>}
              </div>
              <div className="flex flex-col items-end gap-2.5">
                <div className="flex items-center gap-3">
                  <span className="whitespace-nowrap text-sm font-semibold" data-testid="radar-fiche-createur-position">
                    {tr("position", { i: index + 1, n: list.length })}
                  </span>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => goCreator(index - 1)} disabled={index === 0} aria-label={tr("precedent")} className="flex size-9 items-center justify-center rounded-lg border border-slate-300 disabled:opacity-40">
                      <ArrowLeftIcon className="size-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => goCreator(index + 1)} disabled={index === list.length - 1} aria-label={tr("suivant")} className="flex size-9 items-center justify-center rounded-lg border border-slate-300 disabled:opacity-40">
                      <ArrowRightIcon className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {c.igHandle && (
                    <a
                      href={`https://www.instagram.com/${c.igHandle}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                    >
                      {tr("instagram", { handle: c.igHandle })}
                      <ExternalLinkIcon className="size-3.5" aria-hidden />
                    </a>
                  )}
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white"
                    data-testid="radar-createur-profil"
                  >
                    {tr("ouvrirSonProfil")}
                    <ExternalLinkIcon className="size-4" aria-hidden />
                  </a>
                </div>
              </div>
            </div>

            {data === undefined ? (
              <Skeleton className="h-[420px] w-full" />
            ) : videos.length === 0 || !current ? (
              <p className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500" data-testid="radar-createur-sans-video">
                {tr("aucuneVideo")}
              </p>
            ) : (
              <div className="flex flex-wrap items-start gap-6">
                <Player
                  s={{ videoId: current.videoId, url: current.url, handle: c.handle, platform: "tiktok", coverUrl: current.coverUrl, hook: current.hook, caption: current.caption ?? "", unavailable: current.unavailable }}
                  now={now}
                />
                <section aria-labelledby="radar-createur-videos" className="flex min-w-0 flex-[999_1_420px] flex-col gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 id="radar-createur-videos" className="text-[15px] font-semibold" data-testid="radar-createur-nvideos">
                      {tr("sesVideos", { n: videos.length })}
                    </h3>
                    <p className="text-[13px] text-slate-500">{data?.truncated ? tr("tronque", { n: videos.length }) : tr("raccourcis")}</p>
                  </div>
                  <ul className="flex max-h-[62vh] flex-col gap-1.5 overflow-y-auto pr-1">
                    {videos.map((v) => (
                      <VideoRow key={v.videoId} v={v} selected={v === current} now={now} onPick={() => setPicked({ of: c.id, videoId: v.videoId })} />
                    ))}
                  </ul>
                </section>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Un TikTok du créateur : son texte à l'écran (sinon sa légende), son âge, ses vues, son score s'il sort du lot. */
function VideoRow({ v, selected, now, onPick }: { v: CreatorVideo; selected: boolean; now: number; onPick: () => void }) {
  const tr = useTranslations("admin.ops.RadarCreators");
  const loc = useIntlLocale();
  const age = useAge();
  const text = v.hook || v.caption;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-pressed={selected}
        className={cn("flex w-full items-center gap-3 rounded-lg border p-2 text-left", selected ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50")}
        data-testid="radar-createur-video"
      >
        {v.coverUrl ? (
          <SignalThumb s={v} className="h-16 w-9 shrink-0 rounded-md" />
        ) : (
          // Pas de miniature pour une vidéo qui n'est pas un signal : un repère de lecture, pas un rectangle noir.
          <span className={cn("flex h-16 w-9 shrink-0 items-center justify-center rounded-md", selected ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400")}>
            <PlayIcon className="size-3.5 fill-current" aria-hidden />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("line-clamp-2 break-words text-sm leading-snug", text ? "font-medium text-slate-900" : "text-slate-500")}>{text || tr("sansTexte")}</span>
          <span className="text-xs text-slate-500">
            {age(v.publishedAt, now)}
            {v.unavailable && ` · ${tr("plusVisible")}`}
          </span>
        </span>
        {v.multiplier !== null && v.multiplier >= OUTLIER && <AccentTag className="shrink-0 px-1.5 py-0.5 text-xs">{formatOutlierRatio(v.multiplier, loc)}</AccentTag>}
        <span className="w-[88px] shrink-0 text-right text-sm font-semibold tabular-nums">{tr("vues", { n: formatCount(v.views, loc) })}</span>
      </button>
    </li>
  );
}
