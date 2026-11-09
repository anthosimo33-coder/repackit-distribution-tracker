"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeftIcon, ArrowRightIcon, BookmarkIcon, ExternalLinkIcon, PenLineIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { useProject } from "@/components/project/ProjectProvider";
import { usePermissions } from "@/components/project/use-permissions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { tiktokPlayerEmbedUrl } from "@/lib/embed";
import { useConvexError } from "@/lib/use-convex-error";
import { formatCount, formatDuration } from "@/components/admin/radar/radar-format";
import { ACCENT_LINK, ScoreBadge, SignalThumb, signalTitle, useAge, useSignalStatus, type RadarSignal } from "@/components/admin/radar/radar-ui";
import { curveOf, lastGrowth, scoreOf, sharesWell, usualViews } from "@/convex/radarDisplay";

/** 0,062 → « 6,2 % ». */
const formatPct = (x: number, loc: string) => new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: 1 }).format(x);
import type { SignalStatus } from "@/convex/radarSignalFilters";

/** Une file de vidéos à regarder : figée à l'ouverture (une vidéo traitée garde sa place). */
export type ViewerQueue = { ids: Id<"radarSignals">[]; index: number };

/**
 * REGARDER UNE PAR UNE — une vidéo en grand, pourquoi elle sort du lot (score,
 * courbe), ce qu'elle fait (texte à l'écran, ce qui est dit, son, légende), et
 * trois gestes : Passer, Garder, À adapter — au clavier (P, G, A, flèches).
 * Après un geste, la suivante arrive. Les données sont relues en direct
 * (`signals`), la file reste celle de l'ouverture.
 */
export function RadarViewer({
  queue,
  signals,
  now,
  onChange,
}: {
  queue: ViewerQueue | null;
  signals: readonly RadarSignal[];
  now: number;
  onChange: (q: ViewerQueue | null) => void;
}) {
  const tr = useTranslations("admin.ops.RadarViewer");
  const setStatus = useSignalStatus();
  const { project } = useProject();
  const byId = new Map(signals.map((s) => [s.id, s]));
  const n = queue?.ids.length ?? 0;
  const index = queue?.index ?? 0;
  const done = queue !== null && index >= n;
  const s = queue && !done ? (byId.get(queue.ids[index]) ?? null) : null;

  const go = (i: number) => queue && onChange({ ...queue, index: Math.max(0, Math.min(n, i)) });
  async function act(st: SignalStatus) {
    if (!s) return;
    if (await setStatus(s, st)) go(index + 1);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "arrowright" || k === "j") go(index + 1);
    else if (k === "arrowleft" || k === "k") go(index - 1);
    else if (k === "p") void act("ignore");
    else if (k === "g") void act("enregistre");
    else if (k === "a") void act("adapte");
    else return;
    e.preventDefault();
  }

  const next = queue ? queue.ids.slice(index + 1, index + 5).map((id) => byId.get(id)).filter((x): x is RadarSignal => !!x) : [];

  return (
    <Dialog open={queue !== null} onOpenChange={(o) => !o && onChange(null)}>
      <DialogContent
        className="gap-5 p-5 sm:max-w-[1180px] md:p-6"
        onKeyDown={onKeyDown}
        data-testid="radar-viewer"
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pr-8">
          <DialogTitle className="text-lg font-semibold">{tr("titre")}</DialogTitle>
          <DialogDescription className="text-[13px] text-slate-500">{tr("raccourcis")}</DialogDescription>
        </div>
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-sm font-semibold" data-testid="radar-viewer-position">
            {tr("position", { i: Math.min(index + 1, n), n })}
          </span>
          <div
            role="progressbar"
            aria-label={tr("progression")}
            aria-valuenow={Math.min(index, n)}
            aria-valuemin={0}
            aria-valuemax={n}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"
          >
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${n ? (Math.min(index, n) / n) * 100 : 0}%` }} />
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label={tr("precedente")} className="flex size-9 items-center justify-center rounded-lg border border-slate-300 disabled:opacity-40">
              <ArrowLeftIcon className="size-4" aria-hidden />
            </button>
            <button type="button" onClick={() => go(index + 1)} disabled={done} aria-label={tr("suivante")} className="flex size-9 items-center justify-center rounded-lg border border-slate-300 disabled:opacity-40">
              <ArrowRightIcon className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        {done || !s ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center" data-testid="radar-viewer-fini">
            <p className="text-lg font-semibold text-slate-900">{tr("finiTitre")}</p>
            <p className="text-sm text-slate-500">{tr("finiTexte", { n })}</p>
            <button type="button" onClick={() => onChange(null)} className="min-h-11 rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white">
              {tr("fermer")}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-6">
            <Player s={s} />
            <Details s={s} now={now} />
            {next.length > 0 && (
              <aside aria-labelledby="radar-ensuite" className="hidden w-[220px] shrink-0 flex-col gap-2 xl:flex">
                <h3 id="radar-ensuite" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {tr("ensuite")}
                </h3>
                {next.map((x, i) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => go(index + 1 + i)}
                    className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-2 text-left hover:bg-slate-50"
                  >
                    <SignalThumb s={x} className="h-[72px] w-10 shrink-0 rounded-md" />
                    <span className="flex min-w-0 flex-col gap-1">
                      <ScoreBadge s={x} size="sm" className="self-start" />
                      <span className="line-clamp-2 text-[13px] font-medium leading-snug">{signalTitle(x)}</span>
                    </span>
                  </button>
                ))}
              </aside>
            )}
          </div>
        )}

        {!done && s && (
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void act("ignore")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-600">
                <XIcon className="size-4" aria-hidden />
                {tr("passer")}
                <kbd className="ml-1 rounded border border-slate-300 px-1 text-[11px] font-medium text-slate-500">P</kbd>
              </button>
              <button type="button" onClick={() => void act("enregistre")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900">
                <BookmarkIcon className={cn("size-4", s.status === "enregistre" && "fill-slate-900")} aria-hidden />
                {tr("garder")}
                <kbd className="ml-1 rounded border border-slate-300 px-1 text-[11px] font-medium text-slate-500">G</kbd>
              </button>
              <button type="button" onClick={() => void act("adapte")} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white">
                <PenLineIcon className="size-4" aria-hidden />
                {tr("aAdapterPour", { projet: project.name })}
                <kbd className="ml-1 rounded border border-slate-500 px-1 text-[11px] font-medium text-slate-300">A</kbd>
              </button>
              <InspirationButton s={s} />
            </div>
            <p className="text-[13px] leading-relaxed text-slate-600">{tr("aAdapterAide", { projet: project.name })}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Player({ s }: { s: RadarSignal }) {
  const tr = useTranslations("admin.ops.RadarViewer");
  return (
    <div className="flex w-full max-w-[340px] shrink-0 flex-col gap-2">
      {s.platform === "instagram" ? (
        // Pas de lecteur Instagram intégrable sans compte : la miniature et le lien.
        <SignalThumb s={s} className="flex aspect-[9/16] w-full flex-col justify-end rounded-2xl p-4">
          <span className="relative text-base font-semibold leading-snug">{signalTitle(s)}</span>
        </SignalThumb>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-black">
          <iframe
            key={s.videoId}
            src={tiktokPlayerEmbedUrl(s.videoId)}
            title={tr("videoDe", { handle: s.handle })}
            className="aspect-[9/16] w-full"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
      <a href={s.url} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-1.5 text-sm", ACCENT_LINK)}>
        <ExternalLinkIcon className="size-3.5" aria-hidden />
        {s.platform === "instagram" ? tr("ouvrirInstagram") : tr("ouvrirTiktok")}
      </a>
    </div>
  );
}

function Details({ s, now }: { s: RadarSignal; now: number }) {
  const tr = useTranslations("admin.ops.RadarViewer");
  const tu = useTranslations("admin.ops.RadarUi");
  const loc = useIntlLocale();
  const age = useAge();
  const { basis } = scoreOf(s);
  const usual = usualViews(s);
  const curve = curveOf(s.snapshots, s.publishedAt);
  const growth = lastGrowth(curve);
  const hours = Math.max(0, Math.round((now - s.publishedAt) / 3_600_000));
  return (
    <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {s.app && (
            <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", s.competitor ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700")}>
              {s.competitor ? tu("appConcurrent", { app: s.app }) : s.app}
            </span>
          )}
          {s.network && (
            <span className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600" title={tu("compteSuiviPourAide", { app: s.network })} data-testid="radar-reseau-seul">
              {tu("compteSuiviPour", { app: s.network })}
            </span>
          )}
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{tu(`langueLongue.${s.lang}` as Parameters<typeof tu>[0])}</span>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{tr("publiee", { age: age(s.publishedAt, now) })}</span>
          {s.durationSec !== null && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{formatDuration(s.durationSec)}</span>}
        </div>
        <p className="text-[15px] text-slate-700">
          <a href={`https://www.tiktok.com/@${s.handle}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-900 hover:underline">
            @{s.handle}
          </a>
          {" · "}
          {tr("abonnes", { n: formatCount(s.fans, loc) })}
          {usual !== null && ` · ${tr("dHabitude", { n: formatCount(usual, loc) })}`}
        </p>
      </div>

      <section aria-labelledby="radar-pourquoi" className="flex flex-wrap gap-5 rounded-xl border border-slate-200 p-4">
        <div className="flex min-w-[160px] flex-col gap-1">
          <h3 id="radar-pourquoi" className="text-[13px] font-semibold text-slate-600">
            {tr("pourquoi")}
          </h3>
          <ScoreBadge s={s} size="lg" className="self-start" />
          <span className="text-sm text-slate-700">{basis === "normale" ? tr("saNormale") : tr("sesAbonnes")}</span>
          <span className="mt-2 text-xl font-semibold">{tr("vues", { n: formatCount(s.views, loc) })}</span>
          <span className="text-[13px] text-slate-500">{tr("enHeures", { n: hours })}</span>
          {sharesWell(s) && (
            <span className="mt-2 text-[13px] font-semibold text-slate-900" data-testid="radar-se-partage">
              {tr("partagee", { pct: formatPct(s.shares / Math.max(1, s.views), loc) })}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-2" data-testid="radar-courbe">
          <CurveChart points={curve} />
          {growth ? (
            <p className="text-sm text-slate-700">
              <strong>{tr("croissance", { pct: growth.pct, from: growth.fromH, to: growth.toH })}</strong>
              {s.inCurve && ` · ${tr("courbeContinue")}`}
            </p>
          ) : (
            <p className="text-sm text-slate-500">{s.inCurve ? tr("courbeAttendue") : tr("courbeUnReleve")}</p>
          )}
        </div>
      </section>

      <section aria-labelledby="radar-ce-quelle-fait" className="flex flex-col gap-3">
        <h3 id="radar-ce-quelle-fait" className="text-[15px] font-semibold">
          {tr("ceQuelleFait")}
        </h3>
        <dl className="grid grid-cols-[minmax(110px,150px)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
          {s.hook && (
            <>
              <dt className="text-slate-500">{tr("texteALEcran")}</dt>
              <dd className="font-medium text-slate-900">« {s.hook} »</dd>
            </>
          )}
          {s.transcript && (
            <>
              <dt className="text-slate-500">{tr("ceQuiEstDit")}</dt>
              <dd className="text-slate-800" data-testid="radar-transcription">
                {s.transcript}
              </dd>
            </>
          )}
          {s.caption && (
            <>
              <dt className="text-slate-500">{tr("legende")}</dt>
              <dd className="whitespace-pre-line text-slate-700">{s.caption}</dd>
            </>
          )}
          {s.musicTitle && (
            <>
              <dt className="text-slate-500">{tr("son")}</dt>
              <dd className="text-slate-700">{s.musicTitle}</dd>
            </>
          )}
          <dt className="text-slate-500">{tr("reactions")}</dt>
          <dd className="text-slate-700">
            {tr("reactionsValeur", {
              likes: formatCount(s.likes, loc),
              partages: formatCount(s.shares, loc),
              enregistrements: formatCount(s.saves, loc),
              commentaires: formatCount(s.comments, loc),
            })}
          </dd>
        </dl>
      </section>
    </div>
  );
}

/** La courbe en grand : chaque relevé, en heures après la publication. */
function CurveChart({ points }: { points: { h: number; views: number }[] }) {
  const tr = useTranslations("admin.ops.RadarViewer");
  const loc = useIntlLocale();
  if (points.length === 0) return null;
  // Un cadre proche de sa taille affichée (~340 px) : les étiquettes restent lisibles.
  const W = 360;
  const H = 160;
  const left = 46;
  const right = 14;
  const top = 12;
  const bottom = 124;
  const maxH = Math.max(1, ...points.map((p) => p.h));
  const maxV = Math.max(1, ...points.map((p) => p.views));
  const x = (h: number) => left + (h / maxH) * (W - left - right);
  const y = (v: number) => bottom - (v / maxV) * (bottom - top);
  const all = [{ h: 0, views: 0 }, ...points];
  const label = tr("courbeAria", { releves: points.map((p) => tr("releve", { h: p.h, vues: formatCount(p.views, loc) })).join(", ") });
  // Au plus 4 étiquettes sous l'axe : la première, la dernière et deux entre.
  const labelled = points.length <= 4 ? points : [points[0], points[Math.floor(points.length / 3)], points[Math.floor((2 * points.length) / 3)], points[points.length - 1]];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={left} x2={W - right} y1={y(maxV * t)} y2={y(maxV * t)} stroke={t === 0 ? "#e2e8f0" : "#f1f5f9"} />
          <text
            x={left - 6}
            y={y(maxV * t) + 4}
            textAnchor="end" // i18n-exempt: ancre d'un texte SVG, pas du texte affiché
            fontSize="11"
            fill="#64748b"
          >
            {formatCount(Math.round(maxV * t), loc)}
          </text>
        </g>
      ))}
      <polyline points={all.map((p) => `${x(p.h)},${y(p.views)}`).join(" ")} fill="none" className="stroke-primary" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(p.h)} cy={y(p.views)} r="4.5" className="fill-primary" />
      ))}
      {labelled.map((p, i) => (
        <text
          key={i}
          x={x(p.h)}
          y={H - 14}
          textAnchor={i === labelled.length - 1 ? "end" : "middle"} // i18n-exempt: ancre d'un texte SVG, pas du texte affiché
          fontSize="11"
          fill="#475569"
        >
          {tr("hPlus", { h: p.h })}
        </text>
      ))}
    </svg>
  );
}

/** Ajouter aux inspirations du projet (bibliothèque), quand on en a le droit. */
function InspirationButton({ s }: { s: RadarSignal }) {
  const tr = useTranslations("admin.ops.RadarViewer");
  const droits = usePermissions();
  const showError = useConvexError();
  const createInspiration = useProjectMutation(api.inspirations.createInspiration);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  if (!droits.has("library.manage")) return null;
  const isSaved = saved.has(s.url);
  return (
    <button
      type="button"
      disabled={saving || isSaved}
      onClick={async () => {
        setSaving(true);
        try {
          await createInspiration({
            url: s.url,
            type: "video",
            plateforme: s.platform === "instagram" ? "Instagram" : "TikTok",
            notes: s.hook || s.caption || undefined,
            stats: { views: s.views, followers: s.fans, outlierRatio: s.ratio, authorHandle: s.handle, capturedAt: Date.now() },
          });
          setSaved((x) => new Set(x).add(s.url));
          toast.success(tr("ajouteeAuxInspirations"));
        } catch (err) {
          toast.error(showError(err, tr("ajoutImpossible")));
        } finally {
          setSaving(false);
        }
      }}
      className="ml-auto min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-700 underline-offset-2 hover:underline disabled:no-underline disabled:opacity-60"
    >
      {isSaved ? tr("dansLesInspirations") : tr("ajouterAuxInspirations")}
    </button>
  );
}
