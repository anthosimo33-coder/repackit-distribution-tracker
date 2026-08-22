"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterMultiSelect } from "@/components/filters/FilterMultiSelect";
import { InfoTip } from "@/components/InfoTip";
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
  DISTRIBUTION_MULTIPLIER,
  INTENT_SAVE_RATE,
  MATURITY_HOURS,
  MIN_SAMPLE_VIEWS,
  QUADRANT_PERIOD_DAYS,
  type QuadrantPeriodDays,
} from "@/convex/quadrantSettings";
import {
  buildCoverage,
  buildQuadrantView,
  type QuadrantDatum,
} from "@/lib/quadrant-view";
import {
  projectX,
  projectY,
  SPLIT_X,
  SPLIT_Y,
  xBounds,
  xTicksFor,
  yMax,
  zoneBox,
} from "@/lib/quadrant-plot";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TrackerPost } from "./PostsList";

/**
 * Carte « Vues × Intent ».
 *
 * ── Ce que la refonte a changé, et pourquoi ─────────────────────────────────
 * Les quatre cases étaient deux traits pointillés dans le graphe et quatre
 * encadrés SOUS le graphe : l'œil ne faisait pas le lien, et il fallait
 * traduire un diagnostic (« intent faible ») en décision. Les cases sont
 * devenues les FONDS du graphe, nommées par l'action à faire, et la couleur du
 * point porte son verdict au lieu de sa qualification — l'information
 * principale n'est plus portée par la seule position.
 *
 * ── Pourquoi pas recharts ici ────────────────────────────────────────────────
 * Les deux axes sont repliés sur leur seuil (cf. `lib/quadrant-plot.ts`), ce
 * qui demande des échelles sur mesure, et les zones portent du texte riche
 * aligné sur leur bord. Les deux se font contre recharts, pas avec. Le rendu
 * est donc du HTML positionné, et la contrepartie est heureuse : la projection
 * devient une fonction PURE, testée en vitest, au lieu d'un réglage d'options.
 *
 * ── Ce qui n'a pas changé ────────────────────────────────────────────────────
 * Aucun calcul, aucun seuil, aucune classification. La carte lit toujours le
 * classement écrit par le relevé nocturne, et la ligne de couverture reste la
 * garde contre la lecture d'un effectif comme un total.
 */

/** Teintes par case : plaque très claire, encre foncée (AA), point moyen. */
const ZONE_STYLE: Record<
  QuadrantKey,
  { plate: string; ink: string; dot: string }
> = {
  scale: { plate: "#ecfdf5", ink: "#065f46", dot: "#10b981" },
  distribution_faible: {
    plate: "#f0f9ff",
    ink: "#075985",
    dot: "#0ea5e9",
  },
  intent_faible: {
    plate: "#fffbeb",
    ink: "#92400e",
    dot: "#f59e0b",
  },
  archiver: { plate: "#f8fafc", ink: "#334155", dot: "#94a3b8" },
};

/** Gris des points « en attente » : ils n'ont pas encore de verdict à porter. */
const PENDING_EDGE = "#94a3b8";

const QUALIFICATIONS: readonly QuadrantQualification[] = [
  "promo",
  "warmup",
  "autre",
];

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
  // Set VIDE = aucun filtre (idiome des filtres de la page), pas « rien ».
  const [qualifications, setQualifications] = useState<Set<string>>(new Set());
  const [isolated, setIsolated] = useState<QuadrantKey | null>(null);
  const [hovered, setHovered] = useState<QuadrantDatum | null>(null);

  // Horloge figée au montage : la fenêtre d'affichage ne doit pas glisser d'un
  // rendu à l'autre pendant qu'on lit la carte.
  const [now] = useState(() => Date.now());

  const view = useMemo(
    () =>
      buildQuadrantView(
        posts,
        now,
        periodDays,
        qualifications.size
          ? (qualifications as ReadonlySet<QuadrantQualification>)
          : undefined,
      ),
    [posts, now, periodDays, qualifications],
  );

  const thresholdPct = INTENT_SAVE_RATE * 100;
  const bounds = useMemo(
    () => xBounds(view.points.map((p) => p.x), DISTRIBUTION_MULTIPLIER),
    [view.points],
  );
  const top = useMemo(
    () => yMax(view.points.map((p) => p.y), thresholdPct),
    [view.points, thresholdPct],
  );
  const ticks = useMemo(
    () => xTicksFor(bounds, DISTRIBUTION_MULTIPLIER),
    [bounds],
  );
  const coverage = useMemo(
    () => (hiddenByWarmup === null ? null : buildCoverage(view, hiddenByWarmup)),
    [view, hiddenByWarmup],
  );

  // Échap sort de l'isolement — la sortie clavier d'un état visuel qui, sans
  // elle, ne se quitterait qu'à la souris.
  useEffect(() => {
    if (isolated === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsolated(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isolated]);

  return (
    <Card className="relative">
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
          <div className="flex flex-wrap items-end gap-3">
            {/* La qualification a quitté la couleur des points : elle est
                devenue un filtre, la couleur portant désormais le verdict. */}
            <FilterMultiSelect
              label={t("qualification.label")}
              selectedValues={qualifications}
              onChange={setQualifications}
              options={QUALIFICATIONS.map((q) => ({
                value: q,
                label: t(`legendQualification.${q}`),
              }))}
              allLabel={t("qualification.all")}
              width="w-44"
            />
            <PeriodSelect value={periodDays} onChange={setPeriodDays} />
          </div>
        </div>

        {view.points.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center rounded-md border border-dashed border-slate-200 text-sm text-slate-400">
            {t("empty")}
          </div>
        ) : (
          <>
            <div className="relative h-[420px] overflow-hidden rounded-lg border border-slate-200 sm:h-[460px]">
              {QUADRANT_KEYS.map((key) => (
                <Zone
                  key={key}
                  zone={key}
                  count={view.counts[key]}
                  isolated={isolated}
                  onToggle={() =>
                    setIsolated((cur) => (cur === key ? null : key))
                  }
                />
              ))}

              {/* Les deux traits de seuil, chacun avec son étiquette. */}
              <div
                aria-hidden
                className="absolute top-0 bottom-0 z-20 w-px bg-slate-400"
                style={{ left: `${SPLIT_X * 100}%` }}
              />
              <div
                aria-hidden
                className="absolute right-0 left-0 z-20 h-px bg-slate-400"
                style={{ top: `${(1 - SPLIT_Y) * 100}%` }}
              />
              {/* En BAS de la ligne verticale, près des graduations de X
                  auxquelles elle se rapporte. En haut, elle percutait le titre
                  de la case de droite dès que le cadre se resserrait. */}
              <span
                className="absolute bottom-2 z-30 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500"
                style={{ left: `${SPLIT_X * 100}%` }}
              >
                {t("threshold.x", { multiplier: DISTRIBUTION_MULTIPLIER })}
              </span>
              {/* Au CROISEMENT des deux lignes : le seul endroit du cadre
                  qu'aucune zone n'utilise pour écrire. Au bord gauche, cette
                  étiquette recouvrait le nom technique de la case. */}
              <span
                className="absolute z-30 -translate-x-[calc(100%+6px)] -translate-y-1/2 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500"
                style={{
                  top: `${(1 - SPLIT_Y) * 100}%`,
                  left: `${SPLIT_X * 100}%`,
                }}
              >
                {t("threshold.y", {
                  saveRate: formatPercent(INTENT_SAVE_RATE, 1),
                })}
              </span>

              {view.points.map((p) => (
                <Point
                  key={p.id}
                  datum={p}
                  left={projectX(p.x, bounds, DISTRIBUTION_MULTIPLIER)}
                  bottom={projectY(p.y, top, thresholdPct)}
                  dimmed={isolated !== null && p.quadrant !== isolated}
                  onHover={setHovered}
                  onSelect={() => onSelectPost(p.id as Id<"publications">)}
                />
              ))}
            </div>

            {/* Graduations de X, posées aux mêmes positions que les points. */}
            <div className="relative h-4">
              {ticks.map((tick) => (
                <span
                  key={tick.value}
                  className="absolute -translate-x-1/2 text-[10px] text-slate-400"
                  style={{ left: `${tick.pos * 100}%` }}
                >
                  {`×${String(tick.value).replace(".", ",")}`}
                </span>
              ))}
            </div>
            <div className="flex justify-between text-[10px] font-medium tracking-wide text-slate-400 uppercase">
              <span>{t("axis.low")}</span>
              <span>{t("axis.high")}</span>
            </div>
          </>
        )}

        <AxisCaptions />
        <Legend />

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

      {hovered && <PointTip datum={hovered} />}
    </Card>
  );
}

/**
 * Une case, devenue le FOND du graphe.
 *
 * Le bouton d'isolement est posé SOUS le contenu et le contenu est en
 * `pointer-events-none` : cliquer n'importe où dans la case — texte compris —
 * atteint le bouton, sans imbriquer un bouton dans un bouton (l'infobulle « i »
 * en est un, et le HTML l'interdit). L'infobulle rétablit les événements pour
 * elle seule.
 */
function Zone({
  zone,
  count,
  isolated,
  onToggle,
}: {
  zone: QuadrantKey;
  count: number;
  isolated: QuadrantKey | null;
  onToggle: () => void;
}) {
  const t = useTranslations("tracker.quadrant");
  const box = zoneBox(zone);
  const style = ZONE_STYLE[zone];
  const dimmed = isolated !== null && isolated !== zone;
  const name = t(`name.${zone}`);

  return (
    <div
      className={cn(
        "absolute transition-opacity duration-150",
        dimmed && "opacity-30",
      )}
      style={{
        left: `${box.left * 100}%`,
        top: `${box.top * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
        backgroundColor: style.plate,
      }}
    >
      <button
        type="button"
        aria-pressed={isolated === zone}
        aria-label={
          isolated === zone ? t("zone.showAll") : t("zone.isolate", { zone: name })
        }
        onClick={onToggle}
        className="absolute inset-0 z-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none"
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-0 z-10 flex flex-col p-3",
          box.align === "right" && "items-end text-right",
        )}
        style={{ color: style.ink }}
      >
        {/* Titre et compteur COLLÉS, sur le bord extérieur. Les pousser aux
            deux extrémités de la zone (`justify-between`) plaquait le gros
            chiffre contre la ligne de séparation : les compteurs des deux
            cases voisines s'y rejoignaient, et percutaient l'étiquette de
            seuil posée au même endroit. */}
        <div
          className={cn(
            // EMPILÉ en dessous de `sm` : sur un cadre étroit le titre passe à
            // la ligne, et posé à côté de lui le compteur se retrouvait rejeté
            // contre la ligne de séparation — la collision qu'on vient de
            // corriger, revenue par la largeur.
            "flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-2",
            box.align === "right" && "items-end sm:flex-row-reverse",
          )}
        >
          <span className="pointer-events-auto flex items-center gap-1 text-[13px] leading-tight font-semibold sm:text-sm">
            {t(`action.${zone}`)}
            <InfoTip label={t("info.aria", { sujet: name })}>
              {t(`info.${zone}`)}
            </InfoTip>
          </span>
          <span className="text-2xl leading-none font-bold tabular-nums sm:text-3xl">
            {count}
          </span>
        </div>
        {/* Le texte se retire plutôt que de déborder sur les points : sous‑texte
            masqué en dessous de `sm`, nom technique en dessous de `md`. */}
        <p className="mt-1 hidden max-w-[15rem] text-[11px] leading-snug opacity-80 sm:block">
          {t(`actionSub.${zone}`)}
        </p>
        <span className="mt-auto hidden text-[9px] font-semibold tracking-wider uppercase opacity-60 md:block">
          {name}
        </span>
      </div>
    </div>
  );
}

/** Un post. Bouton : atteignable au clavier, et le clic ouvre sa fiche. */
function Point({
  datum,
  left,
  bottom,
  dimmed,
  onHover,
  onSelect,
}: {
  datum: QuadrantDatum;
  left: number;
  bottom: number;
  dimmed: boolean;
  onHover: (d: QuadrantDatum | null) => void;
  onSelect: () => void;
}) {
  const t = useTranslations("tracker.quadrant");
  const style = datum.quadrant ? ZONE_STYLE[datum.quadrant] : null;

  return (
    <button
      type="button"
      aria-label={t("point.aria", {
        label: datum.label.length > 0 ? datum.label : t("tooltip.noLabel"),
        compte: datum.compte,
        vues: formatNumber(datum.vues),
        saves: formatNumber(datum.saves),
      })}
      onPointerEnter={() => onHover(datum)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(datum)}
      onBlur={() => onHover(null)}
      onClick={onSelect}
      className={cn(
        "absolute z-10 size-3 -translate-x-1/2 translate-y-1/2 cursor-pointer border transition-transform hover:z-30 hover:scale-150 focus-visible:z-30 focus-visible:scale-150 focus-visible:outline-none",
        // Losange pour la fenêtre de breakout : la FORME, pas la couleur — la
        // couleur est prise par le verdict.
        datum.breakout ? "rotate-45 rounded-[2px]" : "rounded-full",
        dimmed && "opacity-20",
      )}
      style={{
        left: `${left * 100}%`,
        bottom: `${bottom * 100}%`,
        backgroundColor: style ? style.dot : "#ffffff",
        borderColor: style ? "rgba(255,255,255,.9)" : PENDING_EDGE,
        // Cercle vide à bord pointillé : un post en attente n'a pas de verdict,
        // il ne doit donc porter aucune couleur de verdict.
        borderStyle: style ? "solid" : "dashed",
      }}
    />
  );
}

/** Infobulle d'un point, ancrée en bas de carte (pas de suivi du curseur). */
function PointTip({ datum }: { datum: QuadrantDatum }) {
  const t = useTranslations("tracker.quadrant");
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 z-40 max-w-xs rounded-md border border-slate-200 bg-white p-2.5 text-xs shadow-lg">
      <p className="font-medium text-slate-900">
        {datum.label.length > 0 ? datum.label : t("tooltip.noLabel")}
      </p>
      <p className="text-slate-500">
        {datum.creatorName ?? t("tooltip.noCreator")} · {datum.compte} ·{" "}
        {formatDate(datum.datePubli)}
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
            ? t(`action.${datum.quadrant}`)
            : t("tooltip.unclassified")}
      </p>
      {datum.breakout && (
        <p className="mt-1 text-slate-500">{t("tooltip.breakout")}</p>
      )}
    </div>
  );
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
 * Légendes des axes, en HTML sous le graphe : elles portent une pastille « i »,
 * et un bouton ne s'accroche pas à du `<text>` SVG.
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
 * La légende ne décrit plus que ce que la couleur NE dit pas : la forme
 * (breakout), le cercle vide (en attente), et le fait que la couleur porte
 * désormais le verdict.
 */
function Legend() {
  const t = useTranslations("tracker.quadrant");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block size-2.5 rotate-45 rounded-[2px] bg-slate-500"
        />
        {t("legend.breakout")}
        <InfoTip label={t("info.aria", { sujet: t("legend.breakout") })}>
          {t("info.breakout", {
            windowHours: BREAKOUT_WINDOW_HOURS,
            minViews: `${Math.round(BREAKOUT_MIN_VIEWS / 1000)}K`,
          })}
        </InfoTip>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block size-2.5 rounded-full border border-dashed border-slate-400 bg-white"
        />
        {t("legend.pending")}
        <InfoTip label={t("info.aria", { sujet: t("legend.pending") })}>
          {t("info.pending", { hours: MATURITY_HOURS })}
        </InfoTip>
      </span>
      <span className="text-slate-500">{t("legend.colorIsVerdict")}</span>
    </div>
  );
}
