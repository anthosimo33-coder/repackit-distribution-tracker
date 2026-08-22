"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Id } from "@/convex/_generated/dataModel";
import {
  QUADRANT_KEYS,
  type QuadrantKey,
  type QuadrantQualification,
} from "@/convex/quadrant";
import {
  BASELINE_MIN_POSTS,
  BASELINE_WINDOW_DAYS,
  BREAKOUT_MIN_VIEWS,
  BREAKOUT_WINDOW_HOURS,
  DEFAULT_QUADRANT_PERIOD_DAYS,
  MIN_SAMPLE_VIEWS,
  DISTRIBUTION_MULTIPLIER,
  INTENT_SAVE_RATE,
  MATURITY_HOURS,
  QUADRANT_PERIOD_DAYS,
  type QuadrantPeriodDays,
} from "@/convex/quadrantSettings";
import {
  buildQuadrantView,
  buildCoverage,
  xDomain,
  xTicks,
  yDomain,
  type QuadrantDatum,
} from "@/lib/quadrant-view";
import { InfoTip } from "@/components/InfoTip";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TrackerPost } from "./PostsList";

/**
 * Carte « Vues × Intent » — chaque post publié devient un point sur deux axes
 * indépendants : à quel point il est sorti par rapport à son compte (X, échelle
 * log) et à quel point il a donné envie d'y revenir (Y, save rate). Les deux
 * lignes de seuil découpent les quatre décisions.
 *
 * ── Ce que cette carte NE FAIT PAS ───────────────────────────────────────────
 * Elle ne calcule rien. Les scores et la case sont écrits par le relevé nocturne
 * (`convex/quadrantSync.ts`) via le module pur `convex/quadrant.ts`, et lus tels
 * quels : deux personnes qui ouvrent la page au même moment voient le même
 * verdict pour un post donné, quels que soient leurs filtres.
 *
 * ── Filtres ──────────────────────────────────────────────────────────────────
 * Créatrice, compte et qualification (le tri-état warmup) viennent de la BARRE
 * DE LA PAGE — la carte consomme la même liste que les autres graphes, donc les
 * mêmes filtres, sans état dupliqué. Seule la fenêtre d'affichage (7/14/30 j)
 * est locale : c'est un réglage de lecture de cette carte, pas un filtre de page.
 *
 * ⚠️ Le tri-état warmup vaut « hors warmup » par DÉFAUT sur cette page : sans
 * changement, les points de chauffe ne sont pas là et la carte le dit.
 */

const COLORS: Record<QuadrantQualification | "pending", string> = {
  // Ambre = warmup, la couleur déjà associée à « hors paie » (PostWarmupBadge).
  warmup: "#d97706",
  promo: "#4f46e5",
  autre: "#0891b2",
  // Gris = « on ne juge pas encore », jamais une catégorie de contenu.
  pending: "#94a3b8",
};

type SeriesKey = QuadrantQualification | "pending";
const SERIES: readonly SeriesKey[] = ["promo", "warmup", "autre", "pending"];

/** Couleur de fond de chaque case, pour la légende des verdicts. */
const QUADRANT_TONE: Record<QuadrantKey, string> = {
  scale: "border-emerald-200 bg-emerald-50",
  intent_faible: "border-amber-200 bg-amber-50",
  distribution_faible: "border-sky-200 bg-sky-50",
  archiver: "border-slate-200 bg-slate-50",
};

export function QuadrantChart({
  posts,
  hiddenByWarmup,
  onSelectPost,
}: {
  posts: TrackerPost[];
  /**
   * Posts que le filtre warmup de la PAGE a retirés avant que la carte les voie
   * (cf. `trackerWarmupHidden`). `null` = pas encore connu : la ligne de
   * couverture attend plutôt que d'annoncer un total qu'elle devra corriger.
   */
  hiddenByWarmup: number | null;
  onSelectPost: (id: Id<"publications">) => void;
}) {
  const t = useTranslations("tracker.quadrant");
  const [periodDays, setPeriodDays] = useState<QuadrantPeriodDays>(
    DEFAULT_QUADRANT_PERIOD_DAYS,
  );

  // Horloge figée au montage : la fenêtre d'affichage ne doit pas glisser d'un
  // rendu à l'autre pendant qu'on lit la carte.
  const [now] = useState(() => Date.now());

  const view = useMemo(
    () => buildQuadrantView(posts, now, periodDays),
    [posts, now, periodDays],
  );

  const thresholdPct = INTENT_SAVE_RATE * 100;
  const xd = useMemo(
    () => xDomain(view.points, DISTRIBUTION_MULTIPLIER),
    [view.points],
  );
  const yd = useMemo(() => yDomain(view.points, thresholdPct), [view.points, thresholdPct]);
  const ticks = useMemo(() => xTicks(xd), [xd]);

  const bySeries = useMemo(() => {
    const map = new Map<SeriesKey, QuadrantDatum[]>();
    for (const key of SERIES) map.set(key, []);
    for (const p of view.points) {
      map.get(p.pending ? "pending" : p.qualification)?.push(p);
    }
    return map;
  }, [view.points]);

  const coverage = useMemo(
    () => (hiddenByWarmup === null ? null : buildCoverage(view, hiddenByWarmup)),
    [view, hiddenByWarmup],
  );

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="flex items-center gap-1.5 text-base font-semibold text-slate-900">
              {t("title")}
              <InfoTip label={t("info.aria", { sujet: t("title") })} side="bottom">
                {t("info.title")}
              </InfoTip>
            </h3>
            <p className="max-w-2xl text-xs text-slate-500">
              {t("subtitle", {
                multiplier: DISTRIBUTION_MULTIPLIER,
                minViews: formatNumber(MIN_SAMPLE_VIEWS),
                saveRate: formatPercent(INTENT_SAVE_RATE, 1),
              })}
            </p>
          </div>
          <PeriodSelect value={periodDays} onChange={setPeriodDays} />
        </div>

        {view.points.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center rounded-md border border-dashed border-slate-200 text-sm text-slate-400">
            {t("empty")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                type="number"
                dataKey="x"
                scale="log"
                domain={xd}
                ticks={ticks}
                allowDataOverflow
                tick={{ fontSize: 11, fill: "#475569" }}
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
                tickFormatter={(v: number) => `×${v}`}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={yd}
                tick={{ fontSize: 11, fill: "#475569" }}
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
                width={56}
                tickFormatter={(v: number) => `${v.toFixed(1).replace(".", ",")} %`}
              />
              {/* ZAxis figé : sans lui recharts fait varier la taille des points
                  sur une 3e dimension qu'on ne veut pas raconter ici. */}
              <ZAxis type="number" range={[70, 70]} />
              <ReferenceLine
                x={DISTRIBUTION_MULTIPLIER}
                stroke="#64748b"
                strokeDasharray="4 4"
              />
              <ReferenceLine
                y={thresholdPct}
                stroke="#64748b"
                strokeDasharray="4 4"
              />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={<QuadrantTooltip />}
              />
              {SERIES.flatMap((key) => {
                const rows = bySeries.get(key) ?? [];
                // Deux séries par couleur : les points en fenêtre de breakout
                // prennent une ÉTOILE. La forme dit « distribution peut-être
                // empruntée » sans voler la couleur à la qualification.
                return [false, true].map((breakout) => (
                  <Scatter
                    key={`${key}-${breakout}`}
                    name={key}
                    data={rows.filter((r) => r.breakout === breakout)}
                    fill={COLORS[key]}
                    fillOpacity={0.75}
                    shape={breakout ? "star" : "circle"}
                    legendType="none"
                    onClick={(entry: unknown) => {
                      const datum = extractDatum(entry);
                      if (datum) onSelectPost(datum.id as Id<"publications">);
                    }}
                    className="cursor-pointer"
                  />
                ));
              })}
            </ScatterChart>
          </ResponsiveContainer>
        )}

        <AxisCaptions />

        <Legend />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {QUADRANT_KEYS.map((key) => (
            <div
              key={key}
              className={cn(
                "rounded-md border px-3 py-2 text-xs",
                QUADRANT_TONE[key],
              )}
            >
              <div className="flex items-baseline justify-between gap-2 font-medium text-slate-900">
                <span className="flex items-center gap-1.5">
                  {t(`name.${key}`)}
                  <InfoTip
                    label={t("info.aria", { sujet: t(`name.${key}`) })}
                  >
                    {t(`info.${key}`)}
                  </InfoTip>
                </span>
                <span className="tabular-nums">
                  {t("count", { count: view.counts[key] })}
                </span>
              </div>
              <p className="mt-0.5 text-slate-600">{t(`verdict.${key}`)}</p>
            </div>
          ))}
        </div>

        {/* COUVERTURE — permanente, et c'est le point. « 3 Scale » ne dit pas
            s'il s'agit de 3 sur 5 ou de 3 sur 126 ; cette ligne donne la
            population, ce qui en sort, et pourquoi. Chaque post publié y est
            soit classé, soit dans une et une seule cause (invariant testé). */}
        {coverage !== null && (
          <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p className="font-medium text-slate-700">
              {coverage.unclassified === 0
                ? t("coverage.allClassified", { published: coverage.published })
                : t("coverage.summary", {
                    classified: coverage.classified,
                    published: coverage.published,
                    unclassified: coverage.unclassified,
                  })}
            </p>
            {coverage.causes.length > 0 && (
              <ul className="space-y-0.5">
                {/* Les seuils cités viennent des réglages, jamais d'un chiffre
                    recopié : changer un seuil doit changer le texte qui l'explique. */}
                {coverage.causes.map((c) => (
                  <li key={c.cause}>
                    {t(`coverage.cause.${c.cause}`, {
                      count: c.count,
                      minPosts: BASELINE_MIN_POSTS,
                      windowDays: BASELINE_WINDOW_DAYS,
                      hours: MATURITY_HOURS,
                    })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * recharts remonte au clic les props du symbole rendu, dont la donnée d'origine
 * sous `payload`. Extraction DÉFENSIVE : selon la série et la version, l'objet
 * reçu est tantôt le symbole, tantôt la donnée elle-même. On ne veut pas qu'un
 * clic ouvre la mauvaise fiche parce qu'une forme a changé.
 */
function extractDatum(entry: unknown): QuadrantDatum | null {
  if (!entry || typeof entry !== "object") return null;
  const withPayload = entry as { payload?: unknown; id?: unknown };
  const candidate =
    withPayload.payload && typeof withPayload.payload === "object"
      ? (withPayload.payload as QuadrantDatum)
      : (entry as QuadrantDatum);
  return typeof candidate.id === "string" ? candidate : null;
}

function PeriodSelect({
  value,
  onChange,
}: {
  value: QuadrantPeriodDays;
  onChange: (v: QuadrantPeriodDays) => void;
}) {
  const t = useTranslations("tracker.quadrant");
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-slate-600">
        {t("period.label")}
      </label>
      <Select
        value={String(value)}
        onValueChange={(v) =>
          v !== null && onChange(Number(v) as QuadrantPeriodDays)
        }
      >
        <SelectTrigger className="w-44">
          <SelectValue>{t("period.days", { days: value })}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {QUADRANT_PERIOD_DAYS.map((d) => (
            <SelectItem key={d} value={String(d)}>
              {t("period.days", { days: d })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Légendes des axes, rendues en HTML sous le graphe plutôt qu'en `label`
 * recharts. Un label recharts est du `<text>` SVG : on ne peut pas y accrocher
 * un bouton atteignable au clavier. Les sortir du SVG rend l'explication de
 * chaque axe accessible — et le texte sélectionnable au passage.
 */
function AxisCaptions() {
  const t = useTranslations("tracker.quadrant");
  const captions = [
    {
      caption: t("axisX"),
      sujet: t("info.subjectX"),
      body: t("info.axisX", {
        windowDays: BASELINE_WINDOW_DAYS,
        multiplier: DISTRIBUTION_MULTIPLIER,
      }),
    },
    {
      caption: t("axisY"),
      sujet: t("info.subjectY"),
      body: t("info.axisY", { saveRate: formatPercent(INTENT_SAVE_RATE, 1) }),
    },
  ];
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs text-slate-500">
      {captions.map((c) => (
        <span key={c.sujet} className="inline-flex items-center gap-1.5">
          {c.caption}
          <InfoTip label={t("info.aria", { sujet: c.sujet })}>{c.body}</InfoTip>
        </span>
      ))}
    </div>
  );
}

/**
 * Séries de la légende qui portent une explication ; les deux autres (promo,
 * warmup) se lisent seules. Le prédicat RESSERRE le type pour que la clé de
 * message soit vérifiée par le compilateur — `info.warmup` n'existe pas, et
 * c'est next-intl qui doit le dire, pas l'écran.
 */
const LEGEND_INFO = ["autre", "pending"] as const;
type LegendInfoKey = (typeof LEGEND_INFO)[number];
function hasLegendInfo(key: SeriesKey): key is LegendInfoKey {
  return (LEGEND_INFO as readonly string[]).includes(key);
}

function Legend() {
  const t = useTranslations("tracker.quadrant");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      {SERIES.map((key) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: COLORS[key] }}
          />
          {t(`legend.${key}`)}
          {hasLegendInfo(key) && (
            <InfoTip label={t("info.aria", { sujet: t(`legend.${key}`) })}>
              {key === "pending"
                ? t("info.pending", { hours: MATURITY_HOURS })
                : t("info.autre")}
            </InfoTip>
          )}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <StarMark />
        {t("legend.breakout")}
        <InfoTip label={t("info.aria", { sujet: t("legend.breakout") })}>
          {t("info.breakout", {
            windowHours: BREAKOUT_WINDOW_HOURS,
            minViews: `${Math.round(BREAKOUT_MIN_VIEWS / 1000)}K`,
          })}
        </InfoTip>
      </span>
    </div>
  );
}

/** Le même symbole que la série « fenêtre de breakout », pour la légende. */
function StarMark() {
  return (
    <svg viewBox="0 0 12 12" className="size-3 fill-slate-500" aria-hidden>
      <path d="M6 0.5 7.4 4.3 11.5 4.5 8.3 7 9.4 11 6 8.8 2.6 11 3.7 7 0.5 4.5 4.6 4.3Z" />
    </svg>
  );
}

function QuadrantTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: QuadrantDatum }>;
}) {
  const t = useTranslations("tracker.quadrant");
  const datum = active ? payload?.[0]?.payload : undefined;
  if (!datum) return null;

  return (
    <div className="max-w-xs rounded-md border border-slate-200 bg-white p-2.5 text-xs shadow-sm">
      <p className="font-medium text-slate-900">
        {datum.creatorName ?? t("tooltip.noCreator")}
      </p>
      <p className="text-slate-500">
        {datum.compte} · {datum.plateforme} · {formatDate(datum.datePubli)}
      </p>
      <p className="mt-1 line-clamp-3 text-slate-700">
        {datum.label.length > 0 ? datum.label : t("tooltip.noLabel")}
      </p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-600">
        <dt>{t("tooltip.views")}</dt>
        <dd className="text-right tabular-nums">{formatNumber(datum.vues)}</dd>
        <dt>{t("tooltip.saves")}</dt>
        <dd className="text-right tabular-nums">{formatNumber(datum.saves)}</dd>
        <dt>{t("tooltip.saveRate")}</dt>
        <dd className="text-right tabular-nums">
          {formatPercent(datum.scoreIntent, 2)}
        </dd>
        <dt>{t("tooltip.distribution")}</dt>
        <dd className="text-right tabular-nums">
          {t("tooltip.distributionValue", {
            score: datum.x.toFixed(1).replace(".", ","),
            baseline: formatNumber(datum.baselineViews),
          })}
        </dd>
      </dl>
      <p className="mt-1.5 border-t border-slate-100 pt-1.5 font-medium text-slate-900">
        {datum.pending
          ? t("tooltip.pending", { hours: MATURITY_HOURS })
          : datum.quadrant
            ? t(`name.${datum.quadrant}`)
            : t("tooltip.unclassified")}
      </p>
      {!datum.pending && datum.quadrant && (
        <p className="text-slate-600">{t(`verdict.${datum.quadrant}`)}</p>
      )}
      {datum.breakout && (
        <p className="mt-1 text-slate-500">{t("tooltip.breakout")}</p>
      )}
    </div>
  );
}
