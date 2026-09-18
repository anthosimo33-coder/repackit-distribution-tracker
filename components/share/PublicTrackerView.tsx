"use client";

import { useState, type ReactNode } from "react";
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
import {
  EyeIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  LockIcon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { tiktokAnonymousPlayerUrl } from "@/lib/embed";
import { pieSlices } from "@/lib/share-pie";
import type {
  PublicCreatorRef,
  PublicSharePayload,
  ShareBlock,
} from "@/convex/publicShare";
import { formatNumber, formatPercent } from "@/lib/format";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { cn } from "@/lib/utils";

/**
 * LE rendu d'un lien public. Deux montages, un seul composant :
 *   - la page `/s/<token>`, pour le visiteur ;
 *   - l'aperçu du mode partage, pour l'équipe (`edit` fourni).
 *
 * Mise en page (décision produit du 2026-09-18) : la bannière aux couleurs du
 * projet porte le chiffre de tête, puis le PODIUM des 3 vidéos les plus vues
 * (lisibles sur place), le CAMEMBERT des vues par créatrice, la répartition par
 * plateforme et la courbe.
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

type Post = NonNullable<PublicSharePayload["view"]["posts"]>[number];

/** Couleurs des parts : l'accent du projet en dégradé, « Autres » en gris. */
const SLICE_OPACITY = [1, 0.72, 0.5, 0.34, 0.2];
const OTHERS_COLOR = "#cbd5e1";

export function PublicTrackerView({
  payload,
  edit,
  compact = false,
  thumbs = {},
}: {
  payload: PublicSharePayload;
  edit?: EditProps;
  /** Rendu téléphone (aperçu) : une colonne, même sur grand écran. */
  compact?: boolean;
  /** Miniatures du podium, par id de vidéo TikTok (absentes = fond neutre). */
  thumbs?: Readonly<Record<string, string>>;
}) {
  const t = useTranslations("publicShare");
  const loc = useIntlLocale();
  const served = new Set(payload.blocks);
  const view = payload.view;
  const accent = payload.accentColor;
  // Vidéo ouverte dans le lecteur intégré (id TikTok), une à la fois.
  const [playing, setPlaying] = useState<{ id: string; label: string } | null>(null);

  /** Un bloc est dessiné s'il est servi, ou s'il est proposable en édition. */
  const shows = (b: ShareBlock) =>
    served.has(b) || (edit?.available.includes(b) ?? false);
  const isOn = (b: ShareBlock) => (edit ? edit.enabled.has(b) : served.has(b));

  const creatorLabel = (c: PublicCreatorRef): string => {
    if (c === null) return t("noCreator");
    if (c.kind === "named") return c.name;
    return t("creatorAnon", { letter: anonLetter(c.index) });
  };

  const strip: { block: ShareBlock; label: string; value: string | null }[] = [
    {
      block: "kpi_likes",
      label: t("kpi.likes"),
      value: view.kpi?.likes !== undefined ? compactNumber(view.kpi.likes, loc) : null,
    },
    {
      block: "kpi_comments",
      label: t("kpi.comments"),
      value:
        view.kpi?.comments !== undefined ? compactNumber(view.kpi.comments, loc) : null,
    },
    {
      block: "kpi_engagement",
      label: t("kpi.engagement"),
      value:
        view.kpi && "engagement" in view.kpi
          ? formatPercent(view.kpi.engagement ?? null, 1, loc)
          : null,
    },
  ];
  const stripCells = strip.filter((k) => shows(k.block));

  return (
    <div className="space-y-4">
      <Banner
        payload={payload}
        edit={edit}
        viewsShown={shows("kpi_views")}
        viewsOn={isOn("kpi_views")}
        hasStrip={stripCells.length > 0}
      />

      {stripCells.length > 0 && (
        <div
          className={cn(
            "relative z-10 mx-3 -mt-12 grid rounded-2xl border border-slate-200 bg-white py-3 shadow-sm",
            stripCells.length === 1 && "grid-cols-1",
            stripCells.length === 2 && "grid-cols-2",
            stripCells.length === 3 && "grid-cols-3",
          )}
        >
          {stripCells.map((k, i) => {
            const on = isOn(k.block);
            return (
              <div
                key={k.block}
                className={cn(
                  "relative px-2 text-center",
                  i > 0 && "border-l border-slate-100",
                  edit && !on && "opacity-40",
                )}
                data-share-block={k.block}
                data-share-on={edit ? String(on) : undefined}
              >
                <p className="text-lg font-semibold tabular-nums text-slate-900">
                  {edit && !on ? "—" : (k.value ?? "—")}
                </p>
                <p className="text-[11px] text-slate-500 lowercase">{k.label}</p>
                {edit && <EyeToggle edit={edit} block={k.block} on={on} title={k.label} small />}
              </div>
            );
          })}
        </div>
      )}

      {shows("posts") && (
        <Block
          // i18n-exempt: identifiant de bloc (clé de ShareBlock), pas du texte
          block="posts"
          edit={edit}
          on={isOn("posts")}
          title={t("top.title")}
          bare
        >
          <h2 className="px-1 text-sm font-semibold text-slate-900">{t("top.title")}</h2>
          {view.posts && view.posts.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">{t("posts.empty")}</p>
          )}
          {view.posts && view.posts.length > 0 && (
            <Podium
              posts={view.posts}
              thumbs={thumbs}
              compact={compact}
              creatorLabel={creatorLabel}
              onPlay={(p) =>
                p.video &&
                setPlaying({
                  id: p.video.id,
                  label: p.label.trim() === "" ? t("posts.untitled") : p.label,
                })
              }
            />
          )}
        </Block>
      )}

      {shows("by_creator") && (
        <Block
          // i18n-exempt: identifiant de bloc (clé de ShareBlock), pas du texte
          block="by_creator"
          edit={edit}
          on={isOn("by_creator")}
          title={t("byCreator.title")}
        >
          <h2 className="text-sm font-semibold text-slate-900">{t("byCreator.title")}</h2>
          {view.byCreator && (
            <CreatorPie
              rows={view.byCreator.map((r) => ({ label: creatorLabel(r.creator), value: r.vues }))}
              accent={accent}
            />
          )}
        </Block>
      )}

      {shows("by_platform") && (
        <Block
          // i18n-exempt: identifiant de bloc (clé de ShareBlock), pas du texte
          block="by_platform"
          edit={edit}
          on={isOn("by_platform")}
          title={t("byPlatform.title")}
        >
          <h2 className="text-sm font-semibold text-slate-900">{t("byPlatform.title")}</h2>
          {view.byPlatform && <PlatformBar rows={view.byPlatform} accent={accent} />}
        </Block>
      )}

      {shows("daily") && (
        <Block
          // i18n-exempt: identifiant de bloc (clé de ShareBlock), pas du texte
          block="daily"
          edit={edit}
          on={isOn("daily")}
          title={t("daily.title")}
        >
          <h2 className="text-sm font-semibold text-slate-900">{t("daily.title")}</h2>
          {payload.daily === null ? null : payload.daily.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">{t("daily.empty")}</p>
          ) : (
            <div className="mt-3 h-44">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={payload.daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="share-daily" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={accent} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={accent} stopOpacity={0} />
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
                  <Area type="monotone" dataKey="value" stroke={accent} strokeWidth={2} fill="url(#share-daily)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Block>
      )}

      {edit && (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
          <LockIcon className="size-4 shrink-0 text-slate-400" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500">{edit.labels.internalTitle}</p>
            <p className="text-xs text-slate-400">{edit.labels.internalBody}</p>
          </div>
        </div>
      )}

      <p className="pt-2 text-center text-xs text-slate-400">{t("poweredBy")}</p>

      <Dialog open={playing !== null} onOpenChange={(o) => !o && setPlaying(null)}>
        <DialogContent
          showCloseButton={false}
          // Largeur bornée aussi par la HAUTEUR de l'écran : une vidéo 9:16 de
          // 380 px de large ferait 675 px de haut, trop pour un téléphone à plat.
          className="w-[min(92vw,380px,calc((100dvh-4rem)*0.5625))] gap-0 overflow-hidden bg-black p-0 sm:max-w-[380px]"
        >
          <DialogTitle className="sr-only">{playing?.label ?? t("posts.watch")}</DialogTitle>
          <DialogClose
            className="absolute top-2 right-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
            aria-label={t("posts.closeVideo")}
          >
            <XIcon className="size-4" />
          </DialogClose>
          {playing && (
            <iframe
              // Seul l'id de la vidéo circule : pas d'URL, pas de @handle, pas
              // de nom de son (cf tiktokAnonymousPlayerUrl).
              src={tiktokAnonymousPlayerUrl(playing.id)}
              title={playing.label}
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              allowFullScreen
              className="aspect-[9/16] w-full bg-black"
              data-testid="share-video-player"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Bannière ───────────────────────────────────────────────────────────────

function Banner({
  payload,
  edit,
  viewsShown,
  viewsOn,
  hasStrip,
}: {
  payload: PublicSharePayload;
  edit?: EditProps;
  viewsShown: boolean;
  viewsOn: boolean;
  hasStrip: boolean;
}) {
  const t = useTranslations("publicShare");
  const loc = useIntlLocale();
  const views = payload.view.kpi?.views;
  const period =
    payload.period.kind === "all" || payload.period.from === null
      ? t("period.all")
      : t("period.range", {
          from: shortDate(payload.period.from, loc),
          to: shortDate(payload.period.to ?? payload.period.from, loc),
        });
  return (
    <header
      className={cn("relative overflow-hidden rounded-3xl px-5 pt-5 text-white", hasStrip ? "pb-16" : "pb-6")}
      style={{ backgroundColor: payload.accentColor }}
      // i18n-exempt: identifiant de bloc (clé de ShareBlock), pas du texte
      data-share-block="kpi_views"
      data-share-on={edit ? String(viewsOn) : undefined}
    >
      <div className="flex items-center gap-2 text-xs text-white/85">
        {payload.projectLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={payload.projectLogoUrl} alt="" className="size-6 rounded-md object-cover" />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-md bg-white/25 text-[11px] font-semibold" aria-hidden>
            {payload.projectName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="truncate">{payload.projectName}</span>
      </div>
      <h1 className="mt-3 text-lg font-semibold leading-snug">{payload.name}</h1>
      <p className="text-xs text-white/75">
        {[period, payload.updatedAt !== null ? t("updated", { ago: ago(payload.updatedAt, loc) }) : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {viewsShown && (
        <div className={cn("mt-4", edit && !viewsOn && "opacity-40")}>
          <p className="text-5xl font-semibold leading-none tracking-tight tabular-nums">
            {edit && !viewsOn ? "—" : views !== undefined ? compactNumber(views, loc) : "—"}
          </p>
          <p className="mt-1.5 text-sm text-white/85">
            {t("videosCount", { count: payload.view.postCount })}
          </p>
        </div>
      )}
      {edit && viewsShown && (
        <EyeToggle
          edit={edit}
          // i18n-exempt: identifiant de bloc (clé de ShareBlock), pas du texte
          block="kpi_views"
          on={viewsOn}
          title={t("kpi.views")}
          onDark
        />
      )}
    </header>
  );
}

// ─── Podium du top 3 ────────────────────────────────────────────────────────

const RANK_STYLE = [
  "bg-amber-300 text-amber-950", // or
  "bg-slate-200 text-slate-800", // argent
  "bg-orange-200 text-orange-900", // bronze
];

function Podium({
  posts,
  thumbs,
  compact,
  creatorLabel,
  onPlay,
}: {
  posts: Post[];
  thumbs: Readonly<Record<string, string>>;
  compact: boolean;
  creatorLabel: (c: PublicCreatorRef) => string;
  onPlay: (p: Post) => void;
}) {
  const t = useTranslations("publicShare");
  const loc = useIntlLocale();
  const ranked = posts.slice(0, 3).map((p, i) => ({ p, rank: i + 1 }));
  // Podium : le n°1 au centre quand il y a trois marches.
  const order = ranked.length === 3 ? [ranked[1], ranked[0], ranked[2]] : ranked;
  return (
    <ol
      className={cn(
        "mx-auto mt-3 grid items-end gap-2 sm:gap-3",
        // Vignettes 9:16 bornées : sur ordinateur, trois colonnes pleines
        // feraient des vidéos de 800 px de haut.
        ranked.length === 1 && "max-w-[170px] grid-cols-1",
        ranked.length === 2 && "max-w-[350px] grid-cols-2",
        ranked.length === 3 && (compact ? "grid-cols-3" : "max-w-[520px] grid-cols-3"),
      )}
    >
      {order.map(({ p, rank }) => {
        const thumb = p.video ? thumbs[p.video.id] : undefined;
        const label = p.label.trim() === "" ? t("posts.untitled") : p.label;
        const tile = (
          <>
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" className="absolute inset-0 size-full object-cover" />
            ) : null}
            <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <span
              className={cn(
                "absolute top-2 left-2 flex size-6 items-center justify-center rounded-full text-xs font-bold",
                RANK_STYLE[rank - 1],
              )}
            >
              {rank}
            </span>
            {p.video && (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-white/25 backdrop-blur-sm">
                  <PlayIcon className="size-4 translate-x-px fill-white text-white" />
                </span>
              </span>
            )}
            <span className="absolute bottom-2 left-2 text-sm font-semibold text-white tabular-nums">
              {compactNumber(p.vues, loc)}
            </span>
          </>
        );
        return (
          <li key={rank} className={cn(rank !== 1 && ranked.length === 3 && "origin-bottom scale-90")}>
            {p.video ? (
              <button
                type="button"
                onClick={() => onPlay(p)}
                className="relative block aspect-[9/16] w-full overflow-hidden rounded-2xl bg-slate-800 ring-offset-2 focus-visible:ring-2"
                aria-label={`${t("posts.watch")} — ${t("top.rank", { rank })} — ${label}`}
                title={label}
              >
                {tile}
              </button>
            ) : (
              <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-slate-800" title={label}>
                {tile}
              </div>
            )}
            <div className="mt-1.5 flex items-center justify-center gap-1 text-center">
              <p className="truncate text-xs text-slate-500">
                {[p.plateforme, p.creator ? creatorLabel(p.creator) : null].filter(Boolean).join(" · ")}
              </p>
              {p.url !== null && (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-slate-400 hover:text-slate-700"
                  aria-label={t("posts.open")}
                  title={t("posts.open")}
                >
                  <ExternalLinkIcon className="size-3.5" />
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Camembert par créatrice ────────────────────────────────────────────────

function CreatorPie({ rows, accent }: { rows: { label: string; value: number }[]; accent: string }) {
  const t = useTranslations("publicShare");
  const loc = useIntlLocale();
  const [hover, setHover] = useState<number | null>(null);
  const slices = pieSlices(rows.map((r, i) => ({ key: i, value: r.value })));
  if (slices.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">{t("posts.empty")}</p>;
  }
  const total = slices.reduce((s, x) => s + x.value, 0);
  const colorOf = (i: number) => (slices[i].key === null ? OTHERS_COLOR : accent);
  const opacityOf = (i: number) => (slices[i].key === null ? 1 : (SLICE_OPACITY[i] ?? 0.2));
  const labelOf = (i: number) => {
    const k = slices[i].key;
    return k === null ? t("pie.others") : rows[k].label;
  };

  // Anneau : on trace chaque part comme un arc épais (pas de dépendance).
  const R = 54;
  const r = 32;
  const START = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const before = slices.slice(0, i).reduce((acc, x) => acc + x.value, 0) / total;
    const frac = s.value / total;
    const a0 = START + before * 2 * Math.PI;
    const a1 = a0 + frac * 2 * Math.PI;
    return { i, d: donutArc(60, 60, R, r, a0, a1, frac) };
  });
  const center = hover === null ? null : slices[hover];

  return (
    <div className="mt-3 flex items-center gap-4 sm:justify-center sm:gap-8">
      <svg viewBox="0 0 120 120" className="size-32 shrink-0" role="img" aria-label={t("byCreator.title")}>
        {arcs.map(({ i, d }) => (
          <path
            key={i}
            d={d}
            fill={colorOf(i)}
            fillOpacity={opacityOf(i)}
            stroke="white"
            strokeWidth={1.5}
            opacity={hover === null || hover === i ? 1 : 0.35}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="transition-opacity"
          />
        ))}
        {/* i18n-exempt: attribut SVG d'alignement, pas du texte */}
        <text x="60" y="58" textAnchor="middle" className="fill-slate-900 text-[15px] font-semibold">
          {center === null ? compactNumber(total, loc) : `${center.percent} %`}
        </text>
        {/* i18n-exempt: attribut SVG d'alignement, pas du texte */}
        <text x="60" y="73" textAnchor="middle" className="fill-slate-500 text-[9px]">
          {center === null ? t("pie.center") : compactNumber(center.value, loc)}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs" data-testid="share-pie-legend">
        {slices.map((s, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-2 text-xs"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorOf(i), opacity: opacityOf(i) }}
              />
              <span className="truncate text-slate-700">{labelOf(i)}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-900">
              {formatPercent(s.percent / 100, 0, loc)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function donutArc(cx: number, cy: number, R: number, r: number, a0: number, a1: number, frac: number): string {
  // Une part unique (100 %) : deux demi-arcs, un arc SVG ne sait pas boucler.
  if (frac >= 0.9999) {
    return [
      `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx} ${cy + R} A ${R} ${R} 0 1 1 ${cx} ${cy - R}`,
      `M ${cx} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy + r} A ${r} ${r} 0 1 0 ${cx} ${cy - r} Z`,
    ].join(" ");
  }
  const P = (a: number, rad: number) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${P(a0, R)} A ${R} ${R} 0 ${large} 1 ${P(a1, R)} L ${P(a1, r)} A ${r} ${r} 0 ${large} 0 ${P(a0, r)} Z`;
}

// ─── Répartition par plateforme ─────────────────────────────────────────────

function PlatformBar({ rows, accent }: { rows: { label: string; vues: number }[]; accent: string }) {
  const loc = useIntlLocale();
  const slices = pieSlices(rows.map((r, i) => ({ key: i, value: r.vues })), 3);
  if (slices.length === 0) return null;
  const opacity = [1, 0.5, 0.25];
  return (
    <div className="mt-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        {slices.map((s, i) => (
          <div key={i} style={{ width: `${s.percent}%`, backgroundColor: accent, opacity: opacity[i] }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ backgroundColor: accent, opacity: opacity[i] }} />
            <span className="text-slate-600">{s.key === null ? "—" : rows[s.key].label}</span>
            <span className="font-semibold tabular-nums text-slate-900">{formatPercent(s.percent / 100, 0, loc)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Blocs et œil d'édition ─────────────────────────────────────────────────

/** Une carte de bloc. En édition : œil pour l'inclure ou l'exclure, pointillés si exclu. */
function Block({
  block,
  edit,
  on,
  title,
  bare = false,
  children,
}: {
  block: ShareBlock;
  edit?: EditProps;
  on: boolean;
  title: string;
  /** Sans cadre (le podium respire mieux sans carte autour). */
  bare?: boolean;
  children: ReactNode;
}) {
  const off = edit !== undefined && !on;
  return (
    <section
      className={cn(
        "relative transition-opacity",
        bare && !off ? "px-1" : "rounded-2xl border bg-white p-4",
        off ? "border-dashed border-slate-300 bg-slate-50" : !bare && "border-slate-200",
        edit && "pr-12",
      )}
      data-share-block={block}
      data-share-on={edit ? String(on) : undefined}
    >
      {off ? <p className="text-sm font-medium text-slate-400">{title}</p> : children}
      {edit && <EyeToggle edit={edit} block={block} on={on} title={title} />}
    </section>
  );
}

function EyeToggle({
  edit,
  block,
  on,
  title,
  small = false,
  onDark = false,
}: {
  edit: EditProps;
  block: ShareBlock;
  on: boolean;
  title: string;
  small?: boolean;
  onDark?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => edit.onToggle(block)}
      aria-pressed={on}
      aria-label={`${on ? edit.labels.exclude : edit.labels.include} — ${title}`}
      title={on ? edit.labels.exclude : edit.labels.include}
      className={cn(
        "absolute flex items-center justify-center rounded-full border transition-colors",
        small ? "-top-1 right-1 size-6" : "top-3 right-3 size-8",
        onDark
          ? "border-white/40 bg-white/15 text-white hover:bg-white/25"
          : on
            ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
            : "border-slate-300 bg-white text-slate-400 hover:text-slate-600",
      )}
    >
      {on ? <EyeIcon className={small ? "size-3" : "size-4"} /> : <EyeOffIcon className={small ? "size-3" : "size-4"} />}
    </button>
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
    maximumFractionDigits: n >= 1_000_000 ? 2 : 1,
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
