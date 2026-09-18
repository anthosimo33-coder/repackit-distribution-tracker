"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EyeIcon, EyeOffIcon, ExternalLinkIcon, LockIcon } from "lucide-react";
import type { PublicSharePayload } from "@/convex/publicShares";
import type { PublicCreatorRef, ShareBlock } from "@/convex/publicShare";
import { formatNumber, formatPercent } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { cn } from "@/lib/utils";

/**
 * LE rendu d'un lien public. Deux montages, un seul composant :
 *   - la page `/s/<token>`, pour le visiteur ;
 *   - l'aperçu du mode partage, pour l'équipe (`edit` fourni).
 *
 * Il ne reçoit que la réponse projetée par le serveur (convex/publicShare.ts) :
 * un bloc absent de `payload.blocks` n'a pas de données ici, et n'en aura pas.
 * En édition, il est dessiné en pointillés avec son œil barré — c'est un
 * emplacement, pas un contenu caché.
 */

type EditProps = {
  /** Blocs activés dans la configuration en cours. */
  enabled: ReadonlySet<ShareBlock>;
  /** Blocs proposables pour cette audience, dans l'ordre canonique. */
  available: readonly ShareBlock[];
  onToggle: (block: ShareBlock) => void;
  labels: {
    include: string;
    exclude: string;
    internalTitle: string;
    internalBody: string;
  };
};

export function PublicTrackerView({
  payload,
  edit,
  compact = false,
}: {
  payload: PublicSharePayload;
  edit?: EditProps;
  /** Rendu téléphone (aperçu) : une colonne, même sur grand écran. */
  compact?: boolean;
}) {
  const t = useTranslations("publicShare");
  const loc = useIntlLocale();
  const served = new Set(payload.blocks);
  const view = payload.view;

  /** Un bloc est dessiné s'il est servi, ou s'il est proposable en édition. */
  const shows = (b: ShareBlock) =>
    served.has(b) || (edit?.available.includes(b) ?? false);
  const isOn = (b: ShareBlock) => (edit ? edit.enabled.has(b) : served.has(b));

  const creatorLabel = (c: PublicCreatorRef): string => {
    if (c === null) return t("noCreator");
    if (c.kind === "named") return c.name;
    return t("creatorAnon", { letter: anonLetter(c.index) });
  };

  const kpis: { block: ShareBlock; label: string; value: string | null }[] = [
    {
      block: "kpi_views",
      label: t("kpi.views"),
      value: view.kpi?.views !== undefined ? formatNumber(view.kpi.views, loc) : null,
    },
    {
      block: "kpi_likes",
      label: t("kpi.likes"),
      value: view.kpi?.likes !== undefined ? formatNumber(view.kpi.likes, loc) : null,
    },
    {
      block: "kpi_comments",
      label: t("kpi.comments"),
      value:
        view.kpi?.comments !== undefined ? formatNumber(view.kpi.comments, loc) : null,
    },
    {
      block: "kpi_engagement",
      label: t("kpi.engagement"),
      value:
        view.kpi && "engagement" in view.kpi
          ? formatPercent(view.kpi.engagement ?? null, 2, loc)
          : null,
    },
  ];
  const visibleKpis = kpis.filter((k) => shows(k.block));

  const twoCols = !compact;

  return (
    <div className="space-y-4">
      <Header payload={payload} />

      {visibleKpis.length > 0 && (
        <div
          className={cn(
            "grid gap-3",
            // Autant de colonnes que de chiffres : deux chiffres partagés
            // prennent la largeur, pas la moitié d'une grille à quatre.
            visibleKpis.length === 1 ? "grid-cols-1" : "grid-cols-2",
            twoCols && visibleKpis.length === 3 && "md:grid-cols-3",
            twoCols && visibleKpis.length === 4 && "md:grid-cols-4",
          )}
        >
          {visibleKpis.map((k) => (
            <Block
              key={k.block}
              block={k.block}
              edit={edit}
              on={isOn(k.block)}
              title={k.label}
            >
              <p className="text-xs font-medium text-slate-500">{k.label}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
                {k.value ?? "—"}
              </p>
            </Block>
          ))}
        </div>
      )}

      {shows("daily") && (
        <Block block="daily" edit={edit} on={isOn("daily")} title={t("daily.title")}>
          <h3 className="text-sm font-semibold text-slate-900">{t("daily.title")}</h3>
          {payload.daily === null ? null : payload.daily.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">{t("daily.empty")}</p>
          ) : (
            <div className="mt-3 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={payload.daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="share-daily" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={payload.accentColor} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={payload.accentColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                    tickFormatter={(d: string) => shortDay(d, loc)}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                    tickFormatter={(v: number) => compactNumber(v, loc)}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                    formatter={(v) => [formatNumber(Number(v), loc), t("kpi.views")]}
                    labelFormatter={(l) => longDay(String(l), loc)}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={payload.accentColor}
                    strokeWidth={2}
                    fill="url(#share-daily)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Block>
      )}

      {(shows("by_platform") || shows("by_creator")) && (
        <div
          className={cn(
            "grid gap-3",
            twoCols && shows("by_platform") && shows("by_creator") && "md:grid-cols-2",
          )}
        >
          {shows("by_platform") && (
            <Block
              block="by_platform"
              edit={edit}
              on={isOn("by_platform")}
              title={t("byPlatform.title")}
            >
              <h3 className="text-sm font-semibold text-slate-900">{t("byPlatform.title")}</h3>
              {view.byPlatform && (
                <Bars
                  rows={view.byPlatform.map((r) => ({ label: r.label, value: r.vues }))}
                  color={payload.accentColor}
                  locale={loc}
                />
              )}
            </Block>
          )}
          {shows("by_creator") && (
            <Block
              block="by_creator"
              edit={edit}
              on={isOn("by_creator")}
              title={t("byCreator.title")}
            >
              <h3 className="text-sm font-semibold text-slate-900">{t("byCreator.title")}</h3>
              {view.byCreator && (
                <Bars
                  rows={view.byCreator.map((r) => ({
                    label: creatorLabel(r.creator),
                    value: r.vues,
                  }))}
                  color={payload.accentColor}
                  locale={loc}
                />
              )}
            </Block>
          )}
        </div>
      )}

      {edit && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
          <LockIcon className="size-4 shrink-0 text-slate-400" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500">{edit.labels.internalTitle}</p>
            <p className="text-xs text-slate-400">{edit.labels.internalBody}</p>
          </div>
        </div>
      )}

      {shows("posts") && (
        <Block block="posts" edit={edit} on={isOn("posts")} title={t("posts.title")}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">{t("posts.title")}</h3>
            <p className="text-xs text-slate-500">
              {t("posts.count", { count: view.postCount })}
            </p>
          </div>
          {view.posts && view.posts.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">{t("posts.empty")}</p>
          )}
          {view.posts && view.posts.length > 0 && (
            <ol className="mt-2 divide-y divide-slate-100">
              {view.posts.map((p, i) => (
                <li key={i} className="flex items-center gap-3 py-2.5">
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-900">
                      {p.label.trim() === "" ? t("posts.untitled") : p.label}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {[
                        p.plateforme,
                        shortDate(p.datePubli, loc),
                        p.creator ? creatorLabel(p.creator) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {compactNumber(p.vues, loc)}
                    </p>
                    <p className="text-[11px] tabular-nums text-slate-400">
                      {t("posts.interactions", {
                        likes: compactNumber(p.likes, loc),
                        comments: compactNumber(p.comments, loc),
                      })}
                    </p>
                  </div>
                  {p.url !== null && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label={t("posts.open")}
                      title={t("posts.open")}
                    >
                      <ExternalLinkIcon className="size-4" />
                    </a>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Block>
      )}

      <p className="pt-2 text-center text-xs text-slate-400">{t("poweredBy")}</p>
    </div>
  );
}

function Header({ payload }: { payload: PublicSharePayload }) {
  const t = useTranslations("publicShare");
  const loc = useIntlLocale();
  const period =
    payload.period.kind === "all" || payload.period.from === null
      ? t("period.all")
      : t("period.range", {
          from: shortDate(payload.period.from, loc),
          to: shortDate(payload.period.to ?? payload.period.from, loc),
        });
  return (
    <header className="flex items-center gap-3">
      {payload.projectLogoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={payload.projectLogoUrl}
          alt=""
          className="size-11 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-semibold text-white"
          style={{ backgroundColor: payload.accentColor }}
          aria-hidden
        >
          {payload.projectName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900">
          {payload.name}
        </h1>
        <p className="truncate text-xs text-slate-500">
          {[payload.projectName, period, payload.updatedAt !== null ? t("updated", { ago: ago(payload.updatedAt, loc) }) : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </header>
  );
}

/** Une carte de bloc. En édition : œil pour l'inclure ou l'exclure, pointillés si exclu. */
function Block({
  block,
  edit,
  on,
  title,
  children,
}: {
  block: ShareBlock;
  edit?: EditProps;
  on: boolean;
  title: string;
  children: ReactNode;
}) {
  const off = edit !== undefined && !on;
  return (
    <section
      className={cn(
        "relative rounded-xl border bg-white p-4 transition-opacity",
        off ? "border-dashed border-slate-300 bg-slate-50" : "border-slate-200",
        edit && "pr-12",
      )}
      data-share-block={block}
      data-share-on={edit ? String(on) : undefined}
    >
      {off ? (
        <p className="text-sm font-medium text-slate-400">{title}</p>
      ) : (
        children
      )}
      {edit && (
        <button
          type="button"
          onClick={() => edit.onToggle(block)}
          aria-pressed={on}
          aria-label={`${on ? edit.labels.exclude : edit.labels.include} — ${title}`}
          title={on ? edit.labels.exclude : edit.labels.include}
          className={cn(
            "absolute top-3 right-3 flex size-8 items-center justify-center rounded-full border transition-colors",
            on
              ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
              : "border-slate-300 bg-white text-slate-400 hover:text-slate-600",
          )}
        >
          {on ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
        </button>
      )}
    </section>
  );
}

function Bars({
  rows,
  color,
  locale,
}: {
  rows: { label: string; value: number }[];
  color: string;
  locale: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <ul className="mt-3 space-y-2.5">
      {rows.slice(0, 8).map((r, i) => (
        <li key={i}>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-slate-700">{r.label}</span>
            <span className="shrink-0 tabular-nums text-slate-500">
              {compactNumber(r.value, locale)}
              {total > 0 && (
                <span className="ml-1.5 text-slate-400">
                  {formatPercent(r.value / total, 0, locale)}
                </span>
              )}
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-100">
            <div
              className="h-1.5 rounded-full"
              style={{ width: `${(r.value / max) * 100}%`, backgroundColor: color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Formats ────────────────────────────────────────────────────────────────

/** 0 → A, 25 → Z, 26 → AA : au-delà de 26 créatrices, on ne recommence pas à A. */
function anonLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function compactNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: n >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(n);
}

// Les jours de la courbe sont des jours calendaires Europe/Paris, déjà découpés
// par le serveur ("YYYY-MM-DD") : on les lit à midi UTC pour ne jamais glisser
// d'un jour, quel que soit le fuseau du visiteur.
function dayFromKey(d: string): Date {
  return new Date(`${d}T12:00:00Z`);
}
function shortDay(d: string, locale: string): string {
  return dayFromKey(d).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
}
function longDay(d: string, locale: string): string {
  return dayFromKey(d).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
function shortDate(ts: number, locale: string): string {
  return new Date(ts).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Paris",
  });
}
function ago(ts: number, locale: string): string {
  // Jamais dans le futur : une horloge de poste en retard afficherait
  // « mis à jour dans 3 minutes ».
  const diff = Math.min(0, ts - Date.now());
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const min = Math.round(diff / 60_000);
  if (Math.abs(min) < 60) return rtf.format(min, "minute");
  const h = Math.round(min / 60);
  if (Math.abs(h) < 48) return rtf.format(h, "hour");
  return rtf.format(Math.round(h / 24), "day");
}
