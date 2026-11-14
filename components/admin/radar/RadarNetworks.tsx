"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDownIcon, ExternalLinkIcon, Loader2Icon, PlusIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { useProject } from "@/components/project/ProjectProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { formatMoney } from "@/lib/format-rate";
import { isoCountryLabel } from "@/lib/country-name";
import { cn } from "@/lib/utils";
import { AccentTag } from "@/components/admin/radar/radar-ui";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";
import { formatCount, formatOutlierRatio, formatRelative } from "@/components/admin/radar/radar-format";
import { networkSearchPhase, type NetworkSearchOutcome, type NetworkSearchState } from "@/convex/radarNetworkSearch";

type Networks = FunctionReturnType<typeof api.radarNetworks.listNetworks>;
export type AppRow = Networks["apps"][number];
type Candidate = FunctionReturnType<typeof api.radarNetworks.listCandidates>[number];
type StoreList = FunctionReturnType<typeof api.radarStore.listStoreCandidates>;
type StoreApp = StoreList["apps"][number];
type MarketList = FunctionReturnType<typeof api.radarMarket.listMarketCandidates>;
type MarketApp = MarketList["apps"][number];
/** Ce qu'il faut d'une app repérée pour la suivre : son nom et ses motifs proposés, et si on la coche « concurrente » d'office. */
type Followable = { id: Id<"radarAppCandidates">; name: string; patterns: string[]; rival: boolean };

const GROUPS: AppRow["group"][] = ["rival", "otherRival", "other"];

/**
 * NOUVEAU RADAR — Comptes suivis : les apps dont on suit le réseau (concurrentes
 * du projet d'abord), leurs comptes TikTok et ce qu'ils publient. Les comptes
 * entrent seuls (une légende qui cite l'app) ou à la main ; chacun est relevé à
 * son rythme (convex/radarNetworks). En tête, les apps repérées chez ces comptes :
 * suivre l'une d'elles rattache à son réseau les comptes qui la citaient.
 */
export function RadarNetworks() {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const k = (key: string) => key as Parameters<typeof tr>[0];
  const loc = useIntlLocale();
  const data = useProjectQuery(api.radarNetworks.listNetworks, {});
  const candidates = useProjectQuery(api.radarNetworks.listCandidates, {});
  const store = useProjectQuery(api.radarStore.listStoreCandidates, {});
  const market = useProjectQuery(api.radarMarket.listMarketCandidates, {});
  const [openApp, setOpenApp] = useState<Id<"radarApps"> | null>(null);
  const [adding, setAdding] = useState<Followable | true | false>(false);
  // L'horloge des recherches en cours : une recherche tombée en route cesse de
  // « tourner » au bout de 15 min, et les « il y a X min » avancent.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (data === undefined) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600" data-testid="radar-reseaux-compte">
          {tr("comptesSuivis", { actifs: formatNumber(data.active, loc), max: formatNumber(data.max, loc), total: formatNumber(data.total, loc) })}
        </p>
        <button
          type="button"
          onClick={() => setAdding((a) => (a === false ? true : false))}
          aria-expanded={adding !== false}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold"
        >
          <PlusIcon className="size-4" aria-hidden />
          {tr("ajouterUneApp")}
        </button>
      </div>

      {adding !== false && (
        <AddAppForm key={adding === true ? "new" : adding.id} projectSlug={data.projectSlug} candidate={adding === true ? undefined : adding} onDone={() => setAdding(false)} />
      )}

      {candidates && candidates.length > 0 && <Candidates rows={candidates} onFollow={(c) => setAdding({ id: c.id, name: c.name, patterns: c.patterns, rival: true })} />}

      {/* Une app des classements n'est la concurrente de personne tant qu'on ne l'a pas dit. */}
      {store && (store.apps.length > 0 || store.seen > 0) && (
        <StoreCandidates data={store} onFollow={(c) => setAdding({ id: c.id, name: c.name, patterns: c.patterns, rival: false })} />
      )}

      {/* Une app qui paie des créateurs sur une place de marché : même règle, pas concurrente tant qu'on ne l'a pas dit. */}
      {market && (market.apps.length > 0 || market.seen > 0) && (
        <MarketCandidates data={market} onFollow={(c) => setAdding({ id: c.id, name: c.name, patterns: c.patterns, rival: false })} />
      )}

      {data.apps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
          <p className="font-semibold text-slate-900">{tr("aucuneAppTitre")}</p>
          <p className="mt-1 text-sm text-slate-500">{tr("aucuneAppTexte")}</p>
        </div>
      ) : (
        GROUPS.map((g) => {
          const apps = data.apps.filter((a) => a.group === g);
          if (apps.length === 0) return null;
          return (
            <section key={g} aria-labelledby={`radar-groupe-${g}`} className="space-y-2">
              <h2 id={`radar-groupe-${g}`} className="text-base font-semibold">
                {tr(k(`groupe.${g}`))}
              </h2>
              <ul className="space-y-2">
                {apps.map((a) => (
                  <AppCard key={a.id} app={a} now={now} open={openApp === a.id} onToggle={() => setOpenApp(openApp === a.id ? null : a.id)} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

/** Clé du texte qui dit comment une recherche s'est terminée (hors « done », qui donne les comptes ajoutés). */
const ISSUE_KEY = {
  budget: "issue.budget",
  "no-credits": "issue.noCredits",
  "no-key": "issue.noKey",
  error: "issue.error",
  paused: "issue.paused",
} as const satisfies Record<Exclude<NetworkSearchOutcome, "done">, string>;

/**
 * Chercher le réseau d'une app tout de suite : la phase de sa recherche, et le
 * clic qui la lance. Une recherche lancée d'ici annonce sa fin, même si on a
 * fait défiler la page entre-temps.
 */
function useNetworkSearch(app: AppRow, now: number) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const loc = useIntlLocale();
  const showError = useConvexError();
  const searchNow = useProjectMutation(api.radarNetworks.searchAppNow);
  const ns = app.networkSearch;
  const phase = networkSearchPhase(ns, now);
  const asked = useRef<{ finishedAt: number | undefined } | null>(null);
  useEffect(() => {
    const a = asked.current;
    if (!a || !ns || ns.finishedAt === undefined || ns.finishedAt === a.finishedAt) return;
    asked.current = null;
    if (ns.outcome === "done" || ns.outcome === undefined) {
      toast.success(tr("rechercheTerminee", { app: app.name, n: ns.attached }));
    } else {
      const issue = tr(ISSUE_KEY[ns.outcome], { quand: formatRelative(ns.finishedAt, loc) });
      (ns.outcome === "budget" || ns.outcome === "paused" ? toast.warning : toast.error)(tr("issueDeLApp", { app: app.name, issue }));
    }
  }, [ns, app.name, tr, loc]);

  async function search() {
    asked.current = { finishedAt: ns?.finishedAt };
    try {
      const r = await searchNow({ appId: app.id });
      if (r === "running") toast.info(tr("rechercheDejaEnCours", { app: app.name }));
    } catch (err) {
      asked.current = null;
      toast.error(showError(err, tr("rechercheImpossible")));
    }
  }
  return { phase, running: phase === "running", search };
}

/** Le bouton « Chercher son réseau », même largeur dans ses deux états. */
function SearchButton({ running, disabled, onClick }: { running: boolean; disabled: boolean; onClick: () => void }) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || running}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium disabled:opacity-50"
    >
      {running ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : <SearchIcon className="size-4" aria-hidden />}
      {/* Même largeur dans les deux états : la ligne ne bouge pas quand la recherche part. */}
      <span className="grid text-left">
        <span className="invisible col-start-1 row-start-1" aria-hidden>
          {tr("chercherSonReseau")}
        </span>
        <span className="col-start-1 row-start-1">{running ? tr("rechercheBouton") : tr("chercherSonReseau")}</span>
      </span>
    </button>
  );
}

/** La recherche du réseau d'une app, pour sa fiche (Concurrents) : le bouton et où elle en est. */
export function NetworkSearchBlock({ app, now }: { app: AppRow; now: number }) {
  const { phase, running, search } = useNetworkSearch(app, now);
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <SearchButton running={running} disabled={app.status === "paused"} onClick={() => void search()} />
      <SearchStatus app={app} phase={phase} />
    </div>
  );
}

/**
 * La fiche d'une app : sa niche et ce qu'elle fait, d'où elle vient (App Store, campagne qui paie ses créateurs),
 * et les pays d'où ses comptes publient. Rien tant que la fiche n'est pas arrivée.
 */
function AppFiche({ app }: { app: AppRow }) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const loc = useIntlLocale();
  const pays = app.countries.map((c) => `${isoCountryLabel(c.code, loc, c.code)} (${c.accounts})`).join(", ");
  if (!app.niche && !app.pitch && !app.store && !app.market && !pays) return null;
  const link = "underline underline-offset-2 hover:text-slate-900";
  return (
    <div className="mb-1 space-y-0.5 text-xs text-slate-600" data-testid="radar-app-fiche">
      {(app.niche || app.pitch) && (
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {app.niche && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700" data-testid="radar-app-niche">
              {app.niche}
            </span>
          )}
          {app.pitch && <span className="min-w-0 text-[13px] text-slate-700">{app.pitch}</span>}
        </p>
      )}
      {app.store && (
        <p>
          <a href={app.store.url} target="_blank" rel="noopener noreferrer" className={link}>
            {tr("ficheStore", { genre: app.store.genre, editeur: app.store.artist })}
          </a>
        </p>
      )}
      {app.market && (
        <p>
          <a href={app.market.campaignUrl} target="_blank" rel="noopener noreferrer" className={link}>
            {app.market.rateUsd !== null
              ? tr("ficheCampagne", { tarif: formatMoney(app.market.rateUsd, app.market.currency, loc), n: app.market.creators })
              : tr("ficheCampagneSansTarif", { n: app.market.creators })}
          </a>
        </p>
      )}
      {pays && <p data-testid="radar-app-pays">{tr("fichePays", { liste: pays })}</p>}
    </div>
  );
}

function AppCard({ app, now, open, onToggle }: { app: AppRow; now: number; open: boolean; onToggle: () => void }) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const loc = useIntlLocale();
  const { project } = useProject();
  const showError = useConvexError();
  const setStatus = useProjectMutation(api.radarNetworks.setAppStatus);
  const setRival = useProjectMutation(api.radarNetworks.setAppRival);
  const paused = app.status === "paused";
  const rival = app.group === "rival";
  const ns = app.networkSearch;
  const { phase, running, search } = useNetworkSearch(app, now);

  // Concurrente de CE projet ou non : la carte change de groupe aussitôt.
  async function classify() {
    try {
      const isRival = await setRival({ appId: app.id, rival: !rival });
      toast.success(tr(isRival ? "classeeConcurrente" : "plusConcurrente", { app: app.name, projet: project.name }));
    } catch (err) {
      toast.error(showError(err, tr("classementImpossible")));
    }
  }

  return (
    <li
      className={cn("overflow-hidden rounded-xl border bg-white", paused ? "border-slate-200 opacity-70" : running ? "border-primary/50" : "border-slate-200")}
      data-testid="radar-app"
      aria-busy={running}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5">
        <div className="min-w-0 flex-[1_1_260px]">
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-11 w-full min-w-0 items-center gap-2 text-left">
            <ChevronDownIcon className={cn("size-4 shrink-0 text-slate-500 transition-transform", open && "rotate-180")} aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{app.name}</span>
              <span className="block text-xs text-slate-500">
                {tr("resumeApp", { comptes: app.accounts, actifs: app.activeAccounts, posts: app.posts7d })}
                {paused && ` · ${tr(app.outOfScope ? "horsPerimetre" : "enPause")}`}
              </span>
            </span>
          </button>
          <div className="pl-6">
            <AppFiche app={app} />
            <SearchStatus app={app} phase={phase} />
          </div>
        </div>
        <div className="min-w-0 flex-[1_1_240px] text-sm">
          {app.best ? (
            <a href={app.best.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-slate-900 hover:underline">
              <AccentTag className="px-1.5 py-0.5 text-xs">{formatOutlierRatio(app.best.multiplier, loc)}</AccentTag>
              <span className="truncate">{tr("meilleure", { handle: app.best.handle, vues: formatCount(app.best.views, loc) })}</span>
              <ExternalLinkIcon className="size-3.5 shrink-0 text-slate-500" aria-hidden />
            </a>
          ) : (
            <span className="text-slate-500">{tr("pasEncoreDeVideo")}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <SearchButton running={running} disabled={paused} onClick={() => void search()} />
          <button
            type="button"
            onClick={() => setStatus({ appId: app.id, status: paused ? "active" : "paused" })}
            className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium"
          >
            {paused ? tr("reprendre") : tr("mettreEnPause")}
          </button>
          {/* Geste rare : en lien, pour ne pas peser autant que les deux boutons. */}
          <button type="button" onClick={() => void classify()} className="min-h-10 px-2 text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900">
            {rival ? tr("retirerDesConcurrentes") : tr("classerConcurrente")}
          </button>
        </div>
      </div>
      {running && ns && (
        <div
          className="h-1 w-full bg-primary/15"
          role="progressbar"
          aria-label={tr("rechercheEnCours")}
          aria-valuenow={ns.step}
          aria-valuemin={0}
          aria-valuemax={Math.max(1, ns.steps)}
        >
          <div
            className={cn("h-full bg-primary transition-[width] duration-500", ns.step === 0 && "animate-pulse")}
            style={{ width: `${Math.max(8, Math.round((ns.step / Math.max(1, ns.steps)) * 100))}%` }}
          />
        </div>
      )}
      {open && <AccountsTable appId={app.id} appName={app.name} />}
    </li>
  );
}

/**
 * Où en est la recherche du réseau d'une app : en cours (recherche n° X sur Y,
 * comptes déjà trouvés), sa dernière issue (comptes ajoutés, ou pourquoi elle
 * s'est arrêtée), ou à défaut la date de la dernière recherche.
 */
function SearchStatus({ app, phase }: { app: AppRow; phase: ReturnType<typeof networkSearchPhase> }) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const loc = useIntlLocale();
  const ns: NetworkSearchState | null = app.networkSearch;
  const box = "block min-w-0 text-xs";

  if (phase === "running" && ns) {
    return (
      <span role="status" className={cn(box, "flex items-center gap-1.5 font-medium text-slate-900")} data-testid="radar-recherche">
        <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />
        <span>
          {ns.startedAt === undefined || ns.step === 0 ? tr("rechercheEnCours") : tr("rechercheEnCoursEtape", { step: ns.step, steps: ns.steps })}
          {ns.attached > 0 && <span className="text-emerald-700"> · {tr("nouveauxComptes", { n: ns.attached })}</span>}
        </span>
      </span>
    );
  }
  if (phase === "stale" && ns) {
    return (
      <span role="status" className={cn(box, "text-amber-700")} data-testid="radar-recherche">
        {tr("rechercheBloquee", { quand: formatRelative(ns.startedAt ?? ns.requestedAt, loc) })}
      </span>
    );
  }
  if (phase === "finished" && ns && ns.finishedAt !== undefined) {
    const quand = formatRelative(ns.finishedAt, loc);
    if (ns.outcome === undefined || ns.outcome === "done") {
      return (
        <span role="status" className={cn(box, "text-slate-500")} data-testid="radar-recherche">
          {tr("reseauCherche", { quand })}
          {" · "}
          <span className={ns.attached > 0 ? "font-medium text-emerald-700" : undefined}>{tr("nouveauxComptes", { n: ns.attached })}</span>
        </span>
      );
    }
    const warn = ns.outcome === "budget" || ns.outcome === "paused";
    return (
      <span role="status" className={cn(box, warn ? "text-amber-700" : "text-red-700")} title={ns.error} data-testid="radar-recherche">
        {tr(ISSUE_KEY[ns.outcome], { quand })}
        {ns.attached > 0 && ` · ${tr("nouveauxComptes", { n: ns.attached })}`}
      </span>
    );
  }
  return (
    <span className={cn(box, "text-slate-500")} data-testid="radar-recherche">
      {tr("reseauCherche", { quand: formatRelative(app.networkSearchedAt, loc) })}
    </span>
  );
}

export function AccountsTable({ appId, appName }: { appId: Id<"radarApps">; appName: string }) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const loc = useIntlLocale();
  const showError = useConvexError();
  const rows = useProjectQuery(api.radarNetworks.listAppAccounts, { appId });
  const setStatus = useProjectMutation(api.radarNetworks.setTrackedStatus);
  const add = useProjectMutation(api.radarNetworks.addTrackedAccount);
  const [handle, setHandle] = useState("");

  return (
    <div className="space-y-3 border-t border-slate-100 px-4 py-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!handle.trim()) return;
          try {
            const r = await add({ appId, handle });
            toast.success(r === "known" ? tr("dejaSuivi") : tr("compteAjoute", { app: appName }));
            setHandle("");
          } catch (err) {
            toast.error(showError(err, tr("ajoutImpossible")));
          }
        }}
      >
        <label className="flex min-w-0 flex-[1_1_240px] flex-col gap-1 text-sm font-medium">
          {tr("ajouterUnCompte")}
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder={tr("placeholderCompte")}
            className="min-h-10 rounded-lg border border-slate-300 px-3 font-normal"
          />
        </label>
        <button type="submit" className="min-h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white">
          {tr("suivre")}
        </button>
      </form>

      {rows === undefined ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">{tr("aucunCompte")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <Table className="min-w-[760px] text-sm">
            <TableHeader>
              <TableRow className="bg-slate-50 text-left text-xs text-slate-500">
                <TableHead className="px-3 py-2 font-semibold">{tr("colCompte")}</TableHead>
                <TableHead className="px-3 py-2 text-right font-semibold">{tr("colAbonnes")}</TableHead>
                <TableHead className="px-3 py-2 text-right font-semibold">{tr("colMediane")}</TableHead>
                <TableHead className="px-3 py-2 text-right font-semibold">{tr("colSemaine")}</TableHead>
                <TableHead className="px-3 py-2 font-semibold">{tr("colMeilleure")}</TableHead>
                <TableHead className="px-3 py-2 font-semibold">{tr("colReleve")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const active = r.status === "active";
                return (
                  <TableRow key={r.id} className="border-t border-slate-100" data-testid="radar-compte">
                    <TableCell className="px-3 py-2">
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-900 hover:underline">
                        @{r.handle}
                      </a>
                      {r.matchedBy !== "caption" && (
                        <span className="ml-1.5 text-xs text-slate-500">{r.matchedBy === "manual" ? tr("ajouteALaMain") : tr("listeDeDepart")}</span>
                      )}
                      {r.country && <span className="ml-1.5 text-xs text-slate-500">{isoCountryLabel(r.country, loc, r.country)}</span>}
                      {r.igHandle && (
                        <a href={`https://www.instagram.com/${r.igHandle}/`} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-xs text-fuchsia-700 hover:underline">
                          {r.igBest7d
                            ? tr("instagramMeilleur", { handle: r.igHandle, x: formatOutlierRatio(r.igBest7d.multiplier, loc), vues: formatCount(r.igBest7d.views, loc) })
                            : tr("instagram", { handle: r.igHandle })}
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums">{formatCount(r.fans, loc)}</TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums">{r.medianViews === null ? "—" : formatCount(r.medianViews, loc)}</TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums">{r.posts7d}</TableCell>
                    <TableCell className="px-3 py-2">
                      {r.best7d ? (
                        <>
                          <a href={r.best7d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:underline">
                            <AccentTag className="px-1.5 py-0.5 text-xs">{formatOutlierRatio(r.best7d.multiplier, loc)}</AccentTag>
                            {tr("vues", { n: formatCount(r.best7d.views, loc) })}
                          </a>
                          {r.best7d.hook && <span className="mt-0.5 block max-w-[260px] truncate text-xs text-slate-500">{tr("hookCite", { hook: r.best7d.hook })}</span>}
                        </>
                      ) : (
                        <span className="text-slate-500">{r.readAt === null ? tr("pasEncoreReleve") : tr("rienCetteSemaine")}</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={active}
                        aria-label={tr("releveDe", { handle: r.handle })}
                        onClick={async () => {
                          try {
                            await setStatus({ accountId: r.id, status: active ? "paused" : "active" });
                          } catch (err) {
                            toast.error(showError(err, tr("changementImpossible")));
                          }
                        }}
                        className="inline-flex min-h-10 items-center gap-2"
                      >
                        <span className={cn("relative inline-block h-5 w-9 rounded-full", active ? "bg-slate-900" : "bg-slate-300")}>
                          <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", active ? "left-[18px]" : "left-0.5")} />
                        </span>
                        <span className="text-xs">{active ? tr("actif") : tr("enPause")}</span>
                      </button>
                      {!active && r.pausedReason === "vetting" && (
                        <span className="block max-w-[180px] text-xs text-slate-500" title={tr("enVerificationAide", { app: appName })} data-testid="radar-en-verification">
                          {tr("enVerification")}
                        </span>
                      )}
                      {!active && r.pausedReason === "offTopic" && (
                        <span className="block max-w-[180px] text-xs text-slate-500" title={tr("horsSujetAide", { app: appName })} data-testid="radar-hors-sujet">
                          {tr("horsSujet", { app: appName })}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** Nom proposé pour une app repérée : « @Voca AI » → « Voca AI », « stalkie.io » → « Stalkie ». */
function Candidates({ rows, onFollow }: { rows: Candidate[]; onFollow: (c: Candidate) => void }) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const showError = useConvexError();
  const ignore = useProjectMutation(api.radarNetworks.ignoreCandidate);
  return (
    <section aria-labelledby="radar-apps-reperees" className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <h2 id="radar-apps-reperees" className="text-base font-semibold">
        {tr("appsReperees")}
      </h2>
      <p className="text-sm text-slate-600">{tr("appsRepereesAide")}</p>
      <ul className="divide-y divide-primary/15">
        {rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5" data-testid="radar-app-reperee">
            <div className="min-w-0 flex-[1_1_260px]">
              <p className="truncate font-semibold text-slate-900">{c.label}</p>
              <p className="text-xs text-slate-500">
                {tr("citeePar", { n: c.authorCount })}
                {c.fromApps.length > 0 && ` · ${tr("chezLesComptesDe", { apps: c.fromApps.join(", ") })}`}
                {" · "}
                {c.examples.slice(0, 3).map((e, i) => (
                  <span key={e.handle}>
                    {i > 0 && ", "}
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      @{e.handle}
                    </a>
                  </span>
                ))}
              </p>
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => onFollow(c)} className="min-h-10 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white">
                {tr("suivreCetteApp")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await ignore({ candidateId: c.id });
                  } catch (err) {
                    toast.error(showError(err, tr("changementImpossible")));
                  }
                }}
                className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium"
              >
                {tr("ignorer")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Pourquoi un compte est tenu pour un compte créateur de l'app (convex/radarStoreMath.creatorEvidence). */
const PREUVES = { handle: "preuvePseudo", bio: "preuveBio", half: "preuveVideos" } as const;

/**
 * Les apps trouvées dans les classements de l'App Store dont le hashtag TikTok
 * porte des comptes créateurs (convex/radarStore), celles qui en ont le plus
 * d'abord. À relire avant de suivre : un nom courant désigne parfois autre chose.
 */
function StoreCandidates({ data, onFollow }: { data: StoreList; onFollow: (c: StoreApp) => void }) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const loc = useIntlLocale();
  const showError = useConvexError();
  const ignore = useProjectMutation(api.radarNetworks.ignoreCandidate);
  return (
    <section aria-labelledby="radar-apps-classements" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="radar-apps-classements" className="text-base font-semibold">
        {tr("appsClassements")}
      </h2>
      <p className="text-sm text-slate-600">{tr("appsClassementsAide")}</p>
      <p className="text-xs text-slate-500" data-testid="radar-classements-avancement">
        {tr("appsClassementsAvancement", { checked: formatNumber(data.checked, loc), seen: formatNumber(data.seen, loc) })}
        {data.stopped !== null && ` · ${tr("appsClassementsArret", { raison: data.stopped })}`}
      </p>
      {data.apps.length > 0 && (
        <ul className="divide-y divide-slate-200">
          {data.apps.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5" data-testid="radar-app-classement">
              <div className="min-w-0 flex-[1_1_300px]">
                <p className="truncate font-semibold text-slate-900">
                  {c.name}
                  <span className="font-normal text-slate-500">
                    {c.genre && ` · ${c.genre}`}
                    {c.year && ` · ${c.year}`}
                  </span>
                </p>
                {c.note && (
                  <p className="text-xs font-medium text-amber-800" data-testid="radar-app-non-suivie">
                    {tr("pasSuivieDOffice", { raison: c.note })}
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  {tr("appsClassementsPreuve", { n: c.creators.length, tag: c.tag, videos: formatNumber(c.tagVideos, loc) })}
                  {" · "}
                  {c.creators.slice(0, 4).map((x, i) => (
                    <span key={x.handle}>
                      {i > 0 && ", "}
                      <a href={x.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        @{x.handle}
                      </a>{" "}
                      ({tr(PREUVES[x.why])})
                    </span>
                  ))}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <a
                  href={c.storeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium"
                >
                  {tr("ficheAppStore")}
                </a>
                <button type="button" onClick={() => onFollow(c)} className="min-h-10 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white">
                  {tr("suivreCetteApp")}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await ignore({ candidateId: c.id });
                    } catch (err) {
                      toast.error(showError(err, tr("changementImpossible")));
                    }
                  }}
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium"
                >
                  {tr("ignorer")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Les apps et logiciels qui paient des créateurs à la vue sur une place de marché de campagnes
 * (convex/radarMarket), ceux dont on connaît le plus de comptes d'abord. La preuve est la campagne elle-même :
 * ce qu'elle paie, combien de créateurs y publient, et ses meilleurs clips.
 */
function MarketCandidates({ data, onFollow }: { data: MarketList; onFollow: (c: MarketApp) => void }) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const loc = useIntlLocale();
  const showError = useConvexError();
  const ignore = useProjectMutation(api.radarNetworks.ignoreCandidate);
  const usd = (x: number) => formatMoney(x, data.currency, loc);
  return (
    <section aria-labelledby="radar-apps-marche" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="radar-apps-marche" className="text-base font-semibold">
        {tr("appsMarche")}
      </h2>
      <p className="text-sm text-slate-600">{tr("appsMarcheAide")}</p>
      <p className="text-xs text-slate-500" data-testid="radar-marche-avancement">
        {tr("appsMarcheAvancement", { judged: formatNumber(data.judged, loc), seen: formatNumber(data.seen, loc) })}
        {data.stopped !== null && ` · ${tr("appsClassementsArret", { raison: data.stopped })}`}
      </p>
      {data.apps.length > 0 && (
        <ul className="divide-y divide-slate-200">
          {data.apps.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5" data-testid="radar-app-marche">
              <div className="min-w-0 flex-[1_1_300px]">
                <p className="truncate font-semibold text-slate-900">
                  {c.name}
                  <span className="font-normal text-slate-500">
                    {` · ${tr(c.productKind === "app" ? "marcheApp" : "marcheLogiciel")}`}
                    {c.org && c.org !== c.name && ` · ${tr("marchePayePar", { org: c.org })}`}
                  </span>
                </p>
                {c.note && (
                  <p className="text-xs font-medium text-amber-800" data-testid="radar-app-non-suivie">
                    {tr("pasSuivieDOffice", { raison: c.note })}
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  {tr("appsMarchePreuve", { n: c.creators, vues: formatNumber(c.views, loc), verse: usd(c.spentUsd) })}
                  {c.rateUsd !== null && ` · ${tr("marcheTarif", { tarif: usd(c.rateUsd) })}`}
                  {c.campaigns > 1 && ` · ${tr("marcheCampagnes", { n: c.campaigns })}`}
                  {c.handles.length > 0 && " · "}
                  {c.handles.slice(0, 4).map((x, i) => (
                    <span key={x.handle}>
                      {i > 0 && ", "}
                      <a href={x.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        @{x.handle}
                      </a>
                    </span>
                  ))}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <a
                  href={c.campaignUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium"
                >
                  {tr("voirCampagne")}
                </a>
                <button type="button" onClick={() => onFollow(c)} className="min-h-10 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white">
                  {tr("suivreCetteApp")}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await ignore({ candidateId: c.id });
                    } catch (err) {
                      toast.error(showError(err, tr("changementImpossible")));
                    }
                  }}
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium"
                >
                  {tr("ignorer")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddAppForm({ projectSlug, onDone, candidate }: { projectSlug: string; onDone: () => void; candidate?: Followable }) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const showError = useConvexError();
  const addApp = useProjectMutation(api.radarNetworks.addApp);
  const follow = useProjectMutation(api.radarNetworks.followCandidate);
  const [name, setName] = useState(candidate ? candidate.name : "");
  const [patterns, setPatterns] = useState(candidate ? candidate.patterns.join(", ") : "");
  const [rival, setRival] = useState(candidate ? candidate.rival : true);

  return (
    <form
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const args = { name, rivalOf: rival ? [projectSlug] : [], patterns: patterns.split(/[,\n]/).map((p) => p.trim()).filter(Boolean) };
        try {
          if (candidate) {
            const r = await follow({ candidateId: candidate.id, ...args });
            toast.success(tr("appSuivieDepuisReperee", { app: name.trim(), n: r.attached }));
          } else {
            await addApp(args);
            toast.success(tr("appAjoutee", { app: name.trim() }));
          }
          onDone();
        } catch (err) {
          toast.error(showError(err, tr("ajoutAppImpossible")));
        }
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-0 flex-[1_1_200px] flex-col gap-1 text-sm font-medium">
          {tr("nomDeLApp")}
          <input value={name} onChange={(e) => setName(e.target.value)} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 font-normal" />
        </label>
        <label className="flex min-w-0 flex-[2_1_280px] flex-col gap-1 text-sm font-medium">
          {tr("motifs")}
          <input
            value={patterns}
            onChange={(e) => setPatterns(e.target.value)}
            placeholder={tr("placeholderMotifs")}
            className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 font-normal"
          />
        </label>
      </div>
      <p className="text-xs text-slate-500">{tr("aideMotifs")}</p>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" checked={rival} onChange={() => setRival((r) => !r)} className="size-4 accent-slate-900" />
        {tr("concurrenteDeCeProjet")}
      </label>
      <div className="flex gap-2">
        <button type="submit" className="min-h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white">
          {tr("suivreLApp")}
        </button>
        <button type="button" onClick={onDone} className="min-h-10 px-3 text-sm font-semibold text-slate-600 underline">
          {tr("annuler")}
        </button>
      </div>
    </form>
  );
}
