"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { usePermissions } from "@/components/project/use-permissions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { tiktokPlayerEmbedUrl } from "@/lib/embed";
import { useConvexError } from "@/lib/use-convex-error";
import { formatCount, formatDuration, formatOutlierRatio, formatPublished } from "@/components/admin/radar/radar-format";
import { STATUSES, type SignalStatus } from "@/convex/radarSignalFilters";
import { viewsPerHour } from "@/convex/radarSignalsMath";
import type { RadarSignal } from "@/components/admin/radar/RadarSignals";

/**
 * Détail d'un signal : le lecteur TikTok en place, les chiffres, la COURBE (les
 * relevés successifs, en heures après la publication), le statut de l'équipe,
 * et l'ajout aux inspirations quand on en a le droit.
 */
export function RadarSignalDetail({
  signal,
  now,
  onClose,
  onStatus,
}: {
  signal: RadarSignal | null;
  now: number;
  onClose: () => void;
  onStatus: (s: SignalStatus) => void;
}) {
  const tr = useTranslations("admin.ops.RadarSignalDetail");
  const k = (key: string) => key as Parameters<typeof tr>[0];
  const loc = useIntlLocale();
  const droits = usePermissions();
  const showError = useConvexError();
  const createInspiration = useProjectMutation(api.inspirations.createInspiration);
  const [savedUrls, setSavedUrls] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const s = signal;
  const curve = s
    ? s.snapshots.map((p, i) => {
        const prev = i > 0 ? s.snapshots[i - 1].views : null;
        return {
          h: Math.max(0, Math.round((p.at - s.publishedAt) / 3_600_000)),
          views: p.views,
          growth: prev && prev > 0 ? (p.views - prev) / prev : null,
        };
      })
    : [];
  const maxViews = Math.max(1, ...curve.map((c) => c.views));

  async function saveInspiration() {
    if (!s || saving) return;
    setSaving(true);
    try {
      await createInspiration({
        url: s.url,
        type: "video",
        plateforme: "TikTok",
        notes: s.caption || undefined,
        stats: { views: s.views, followers: s.fans, outlierRatio: s.ratio, authorHandle: s.handle, capturedAt: Date.now() },
      });
      setSavedUrls((u) => new Set(u).add(s.url));
      toast.success(tr("ajouteeAuxInspirations"));
    } catch (err) {
      toast.error(showError(err, tr("ajoutImpossible")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={s !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[480px]">
        {s && (
          <>
            <SheetHeader>
              <SheetTitle>@{s.handle}</SheetTitle>
              <SheetDescription>
                {formatPublished(s.publishedAt, loc)}
                {s.durationSec !== null && ` · ${formatDuration(s.durationSec)}`}
                {s.app && ` · ${s.app}`}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              {s.platform === "instagram" ? (
                // Pas de lecteur Instagram intégrable sans compte : le lien suffit.
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="block min-h-11 rounded-lg border border-slate-300 px-4 py-3 text-center text-sm font-semibold hover:bg-slate-50">
                  {tr("voirSurInstagram")}
                </a>
              ) : (
                <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-lg border border-slate-200 bg-black">
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

              <div className="grid grid-cols-2 gap-3">
                <Stat label={tr("vues")} value={formatCount(s.views, loc)} />
                <Stat label={tr("vuesSurAbonnes")} value={formatOutlierRatio(s.ratio, loc)} accent />
                <Stat label={tr("vitesse")} value={tr("parHeure", { n: formatCount(viewsPerHour(s.views, s.publishedAt, now), loc) })} />
                <Stat label={tr("abonnes")} value={formatCount(s.fans, loc)} />
                {s.multiplier !== null && <Stat label={tr("vuesSurMediane")} value={formatOutlierRatio(s.multiplier, loc)} accent />}
              </div>

              <section aria-labelledby="radar-courbe" className="space-y-2">
                <h3 id="radar-courbe" className="text-sm font-semibold">{tr("courbe")}</h3>
                {curve.length < 2 ? (
                  <p className="text-sm text-slate-500">{s.inCurve ? tr("courbeAttendue") : tr("courbeUnReleve")}</p>
                ) : null}
                <ol className="space-y-1.5" data-testid="radar-courbe">
                  {curve.map((c, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="w-14 shrink-0 tabular-nums text-slate-500">{tr("hPlus", { h: c.h })}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                        <span className="block h-2 rounded-full bg-orange-500" style={{ width: `${Math.max(2, (c.views / maxViews) * 100)}%` }} />
                      </span>
                      <span className="w-16 shrink-0 text-right font-semibold tabular-nums">{formatCount(c.views, loc)}</span>
                      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-500">
                        {c.growth === null ? "" : `+${Math.round(c.growth * 100)} %`}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>

              {(s.hook || s.musicTitle) && (
                <section className="space-y-1">
                  <h3 className="text-sm font-semibold">{tr("texteALEcran")}</h3>
                  {s.hook && <p className="text-sm font-medium text-slate-900">{s.hook}</p>}
                  {s.musicTitle && <p className="text-xs text-slate-500">{tr("son", { titre: s.musicTitle })}</p>}
                </section>
              )}

              {s.transcript && (
                <section className="space-y-1">
                  <h3 className="text-sm font-semibold">{tr("ceQuiEstDit")}</h3>
                  <p className="text-sm text-slate-700" data-testid="radar-transcription">{s.transcript}</p>
                </section>
              )}

              {s.caption && (
                <section className="space-y-1">
                  <h3 className="text-sm font-semibold">{tr("legende")}</h3>
                  <p className="whitespace-pre-line text-sm text-slate-700">{s.caption}</p>
                </section>
              )}

              <section aria-labelledby="radar-statut" className="space-y-2">
                <h3 id="radar-statut" className="text-sm font-semibold">{tr("statutTitre")}</h3>
                <div role="radiogroup" aria-labelledby="radar-statut" className="flex flex-wrap gap-1.5">
                  {STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      role="radio"
                      aria-checked={s.status === st}
                      onClick={() => onStatus(st)}
                      className={cn(
                        "min-h-9 rounded-full border px-3 text-sm",
                        s.status === st ? "border-slate-900 bg-slate-900 font-semibold text-white" : "border-slate-300 bg-white",
                      )}
                    >
                      {tr(k(`statut.${st}`))}
                    </button>
                  ))}
                </div>
              </section>

              <div className="flex flex-wrap gap-2">
                {droits.has("library.manage") && (
                  <button
                    type="button"
                    onClick={saveInspiration}
                    disabled={saving || savedUrls.has(s.url)}
                    className="min-h-11 flex-[1_1_180px] rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {savedUrls.has(s.url) ? tr("dansLesInspirations") : tr("ajouterAuxInspirations")}
                  </button>
                )}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 flex-[1_1_180px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-900"
                >
                  <ExternalLinkIcon className="size-4" aria-hidden />
                  {tr("ouvrirSurTiktok")}
                </a>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn("text-xl font-bold tabular-nums", accent && "text-orange-700")}>{value}</div>
    </div>
  );
}
