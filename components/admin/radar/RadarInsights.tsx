"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatCount, formatRelative } from "@/components/admin/radar/radar-format";

type Insights = NonNullable<FunctionReturnType<typeof api.radarInsights.getInsights>>;
type Row = Insights["byLang"][number];

/** Échelle minimale des barres (en %) : 11 % ne doit pas remplir la ligne. */
const MIN_SCALE = 25;

/**
 * RADAR — CONCURRENTS › VUE D'ENSEMBLE : ce qui sort du lot chez les concurrents
 * du projet, par langue, par app et par façon de faire. Lu dans `radarInsights`,
 * tenu toutes les 6 h (convex/radarInsights) ; « Pas d'écart » sous 3 points.
 */
export function RadarInsights({ hrefForApp }: { hrefForApp: (appId: string) => string | null }) {
  const tr = useTranslations("admin.ops.RadarInsights");
  const tl = useTranslations("admin.ops.RadarUi");
  const key = (k: string) => k as Parameters<typeof tr>[0];
  const langKey = (k: string) => k as Parameters<typeof tl>[0];
  const loc = useIntlLocale();
  const d = useProjectQuery(api.radarInsights.getInsights, {});

  if (d === undefined) return <Skeleton className="h-[480px] w-full" />;
  if (d === null || d.n === 0) {
    return (
      <section className="flex flex-col gap-2 border-t border-slate-200 py-12" data-testid="radar-vue-ensemble">
        <h2 className="text-xl font-semibold tracking-tight">{tr("titre")}</h2>
        <p className="max-w-xl text-sm text-slate-500">{d === null ? tr("pasEncore") : tr("aucuneVideo")}</p>
      </section>
    );
  }

  const lang = (k: string) => tl(langKey(`langueLongue.${k}`));
  const scale = Math.max(MIN_SCALE, ...d.byLang.map((r) => r.pct), ...d.byApp.map((r) => r.pct));
  const h = d.headline;

  return (
    <section className="flex flex-col gap-10" data-testid="radar-vue-ensemble">
      <header className="flex max-w-3xl flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight">{tr("titre")}</h2>
        <p className="text-[15px] leading-relaxed text-slate-600">{tr("sousTitre", { n: formatCount(d.n, loc), pct: d.pct })}</p>
      </header>

      {h && (
        <p className="border-y border-slate-200 py-6 text-xl font-semibold leading-snug tracking-tight text-slate-900" data-testid="radar-ensemble-titre">
          {h.ratio !== null
            ? tr("titreRatio", { best: tr(key(`enLangue.${h.best}`)), worst: tr(key(`enLangue.${h.worst}`)), ratio: h.ratio })
            : tr("titreParts", { best: tr(key(`enLangue.${h.best}`)), worst: tr(key(`enLangue.${h.worst}`)), bestPct: h.bestPct, worstPct: h.worstPct })}
          {d.sameFacon && ` ${tr("faconPareille")}`}
        </p>
      )}

      <div className="grid items-start gap-x-16 gap-y-12 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
        <Bars title={tr("parLangue")} testId="radar-ensemble-langues" rows={d.byLang} scale={scale} name={(r) => lang(r.key)} />
        <Bars
          title={tr("parConcurrent")}
          testId="radar-ensemble-apps"
          rows={d.byApp}
          scale={scale}
          name={(r) => r.label ?? r.key}
          href={(r) => hrefForApp((r as Insights["byApp"][number]).appId)}
        />
      </div>

      {/* Les façons de faire : une rangée à part, trois colonnes sur la même grille. */}
      <section aria-labelledby="radar-ensemble-facon" className="flex flex-col gap-4" data-testid="radar-ensemble-facon">
        <h3 id="radar-ensemble-facon" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {tr("parFacon")}
        </h3>
        <ul className="grid gap-x-16 gap-y-6 border-t border-slate-200 pt-4 [grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))]">
          {d.attrs.map((a) => (
            <li key={a.key} className="flex flex-col gap-1.5" data-testid="radar-ensemble-attr">
              <span className="text-sm text-slate-500">{tr(key(`attr.${a.key}.nom`))}</span>
              <span className={cn("text-[17px] font-semibold tracking-tight", a.verdict === "ecart" ? "text-slate-900" : "text-slate-400")}>
                {a.verdict === "ecart" ? tr(key(`attr.${a.key}.mieux.${a.better}`), { pts: a.gapPts }) : tr(key(a.verdict))}
              </span>
              <span className="text-[13px] tabular-nums text-slate-500">
                  {tr("detail", {
                    a: tr(key(`attr.${a.key}.a`)),
                    pa: a.a.pct,
                    na: formatCount(a.a.n, loc),
                    b: tr(key(`attr.${a.key}.b`)),
                    pb: a.b.pct,
                  nb: formatCount(a.b.n, loc),
                })}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[13px] leading-relaxed text-slate-500">{tr("note", { quand: formatRelative(d.computedAt, loc) })}</p>
    </section>
  );
}

/** Une colonne de barres : le nom et le nombre de vidéos, la part à droite, la barre dessous. */
function Bars({ title, testId, rows, scale, name, href }: { title: string; testId: string; rows: Row[]; scale: number; name: (r: Row) => string; href?: (r: Row) => string | null }) {
  const tr = useTranslations("admin.ops.RadarInsights");
  const loc = useIntlLocale();
  const id = `${testId}-titre`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4" data-testid={testId}>
      <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{tr("tropPeu")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((r) => {
            const link = href?.(r) ?? null;
            return (
              <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-2" data-testid="radar-ensemble-ligne">
                <span className="min-w-0 truncate text-sm text-slate-900">
                  {link ? (
                    <Link href={link} prefetch={false} scroll={false} className="hover:underline">
                      {name(r)}
                    </Link>
                  ) : (
                    name(r)
                  )}
                  <span className="text-slate-400"> · {formatCount(r.n, loc)}</span>
                </span>
                <span className="text-right text-[15px] font-semibold tabular-nums">{tr("pct", { pct: r.pct })}</span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (r.pct / scale) * 100)}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
