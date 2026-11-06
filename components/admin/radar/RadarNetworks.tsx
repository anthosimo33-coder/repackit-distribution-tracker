"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDownIcon, ExternalLinkIcon, PlusIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";
import { formatCount, formatOutlierRatio, formatRelative } from "@/components/admin/radar/radar-format";

type Networks = FunctionReturnType<typeof api.radarNetworks.listNetworks>;
type AppRow = Networks["apps"][number];
type Candidate = FunctionReturnType<typeof api.radarNetworks.listCandidates>[number];

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
  const [openApp, setOpenApp] = useState<Id<"radarApps"> | null>(null);
  const [adding, setAdding] = useState<Candidate | true | false>(false);

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

      {candidates && candidates.length > 0 && <Candidates rows={candidates} onFollow={(c) => setAdding(c)} />}

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
                  <AppCard key={a.id} app={a} open={openApp === a.id} onToggle={() => setOpenApp(openApp === a.id ? null : a.id)} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

function AppCard({ app, open, onToggle }: { app: AppRow; open: boolean; onToggle: () => void }) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const loc = useIntlLocale();
  const showError = useConvexError();
  const searchNow = useProjectMutation(api.radarNetworks.searchAppNow);
  const setStatus = useProjectMutation(api.radarNetworks.setAppStatus);
  const paused = app.status === "paused";

  return (
    <li className={cn("rounded-xl border bg-white", paused ? "border-slate-200 opacity-70" : "border-slate-200")} data-testid="radar-app">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-11 min-w-0 flex-[1_1_220px] items-center gap-2 text-left">
          <ChevronDownIcon className={cn("size-4 shrink-0 text-slate-500 transition-transform", open && "rotate-180")} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{app.name}</span>
            <span className="block text-xs text-slate-500">
              {tr("resumeApp", { comptes: app.accounts, actifs: app.activeAccounts, posts: app.posts7d })}
              {paused && ` · ${tr("enPause")}`}
            </span>
          </span>
        </button>
        <div className="min-w-0 flex-[1_1_240px] text-sm">
          {app.best ? (
            <a href={app.best.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-slate-900 hover:underline">
              <span className="rounded-md bg-orange-500 px-1.5 py-0.5 text-xs font-bold text-slate-950">{formatOutlierRatio(app.best.multiplier, loc)}</span>
              <span className="truncate">{tr("meilleure", { handle: app.best.handle, vues: formatCount(app.best.views, loc) })}</span>
              <ExternalLinkIcon className="size-3.5 shrink-0 text-slate-500" aria-hidden />
            </a>
          ) : (
            <span className="text-slate-500">{tr("pasEncoreDeVideo")}</span>
          )}
        </div>
        <span className="text-xs text-slate-500">{tr("reseauCherche", { quand: formatRelative(app.networkSearchedAt, loc) })}</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={async () => {
              try {
                await searchNow({ appId: app.id });
                toast.success(tr("rechercheLancee", { app: app.name }));
              } catch (err) {
                toast.error(showError(err, tr("rechercheImpossible")));
              }
            }}
            disabled={paused}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium disabled:opacity-50"
          >
            <SearchIcon className="size-4" aria-hidden />
            {tr("chercherSonReseau")}
          </button>
          <button
            type="button"
            onClick={() => setStatus({ appId: app.id, status: paused ? "active" : "paused" })}
            className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium"
          >
            {paused ? tr("reprendre") : tr("mettreEnPause")}
          </button>
        </div>
      </div>
      {open && <AccountsTable appId={app.id} appName={app.name} />}
    </li>
  );
}

function AccountsTable({ appId, appName }: { appId: Id<"radarApps">; appName: string }) {
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
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums">{formatCount(r.fans, loc)}</TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums">{r.medianViews === null ? "—" : formatCount(r.medianViews, loc)}</TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums">{r.posts7d}</TableCell>
                    <TableCell className="px-3 py-2">
                      {r.best7d ? (
                        <>
                          <a href={r.best7d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:underline">
                            <span className="rounded-md bg-orange-500 px-1.5 py-0.5 text-xs font-bold text-slate-950">{formatOutlierRatio(r.best7d.multiplier, loc)}</span>
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
function suggestedName(c: Candidate): string {
  if (c.kind === "mention") return c.label.replace(/^@/, "");
  const base = c.label.replace(/\.[a-z]+$/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function Candidates({ rows, onFollow }: { rows: Candidate[]; onFollow: (c: Candidate) => void }) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const showError = useConvexError();
  const ignore = useProjectMutation(api.radarNetworks.ignoreCandidate);
  return (
    <section aria-labelledby="radar-apps-reperees" className="space-y-2 rounded-xl border border-orange-200 bg-orange-50/60 p-4">
      <h2 id="radar-apps-reperees" className="text-base font-semibold">
        {tr("appsReperees")}
      </h2>
      <p className="text-sm text-slate-600">{tr("appsRepereesAide")}</p>
      <ul className="divide-y divide-orange-100">
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

function AddAppForm({ projectSlug, onDone, candidate }: { projectSlug: string; onDone: () => void; candidate?: Candidate }) {
  const tr = useTranslations("admin.ops.RadarNetworks");
  const showError = useConvexError();
  const addApp = useProjectMutation(api.radarNetworks.addApp);
  const follow = useProjectMutation(api.radarNetworks.followCandidate);
  const [name, setName] = useState(candidate ? suggestedName(candidate) : "");
  const [patterns, setPatterns] = useState(candidate ? candidate.patterns.join(", ") : "");
  const [rival, setRival] = useState(true);

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
