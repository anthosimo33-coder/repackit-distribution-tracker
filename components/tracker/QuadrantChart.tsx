"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  hiddenWarmupDates,
  onSelectPost,
}: {
  posts: TrackerPost[];
  /**
   * DATES des posts que le filtre warmup de la PAGE a retirés avant que la carte
   * les voie (cf. `trackerWarmupHiddenDates`). La période leur est appliquée
   * dans `buildQuadrantView`, avec les posts visibles. `null` = pas encore
   * connu : la ligne de couverture attend plutôt que d'annoncer un total
   * qu'elle devra corriger.
   */
  hiddenWarmupDates: readonly number[] | null;
  onSelectPost: (id: Id<"publications">) => void;
}) {
  const t = useTranslations("tracker.quadrant");
  const [periodDays, setPeriodDays] = useState<QuadrantPeriodDays>(
    DEFAULT_QUADRANT_PERIOD_DAYS,
  );
  // Set VIDE = aucun filtre (idiome des filtres de la page), pas « rien ».
  const [qualifications, setQualifications] = useState<Set<string>>(new Set());
  const [isolated, setIsolated] = useState<QuadrantKey | null>(null);
  /**
   * Point survolé (ou focalisé) ET son point d'ancrage en coordonnées écran.
   * L'infobulle était posée à un coin FIXE de la carte : il fallait quitter le
   * point des yeux pour la lire, et elle recouvrait la ligne de couverture.
   */
  const [tip, setTip] = useState<{
    datum: QuadrantDatum;
    x: number;
    y: number;
  } | null>(null);
  /** Cadre du graphe : borne de repli de l'infobulle (cf. `PointTip`). */
  const plotRef = useRef<HTMLDivElement>(null);

  // Horloge figée au montage : la fenêtre d'affichage ne doit pas glisser d'un
  // rendu à l'autre pendant qu'on lit la carte.
  const [now] = useState(() => Date.now());

  const view = useMemo(
    () =>
      buildQuadrantView(posts, now, periodDays, {
        qualifications: qualifications.size
          ? (qualifications as ReadonlySet<QuadrantQualification>)
          : undefined,
        hiddenWarmupDates: hiddenWarmupDates ?? [],
      }),
    [posts, now, periodDays, qualifications, hiddenWarmupDates],
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
    () => (hiddenWarmupDates === null ? null : buildCoverage(view)),
    [view, hiddenWarmupDates],
  );

  // Échap ferme l'isolement ET l'infobulle — la sortie clavier de deux états
  // visuels qui, sans elle, ne se quitteraient qu'à la souris.
  useEffect(() => {
    if (isolated === null && tip === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setIsolated(null);
      setTip(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isolated, tip]);

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
            <div
              ref={plotRef}
              className="relative h-[420px] overflow-hidden rounded-lg border border-slate-200 sm:h-[460px]"
            >
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
                  active={tip?.datum.id === p.id}
                  onShow={setTip}
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

      {tip && (
        <PointTip
          datum={tip.datum}
          anchorX={tip.x}
          anchorY={tip.y}
          boundsRef={plotRef}
        />
      )}
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
  active,
  onShow,
  onSelect,
}: {
  datum: QuadrantDatum;
  left: number;
  bottom: number;
  dimmed: boolean;
  /** Ce point est celui que l'infobulle décrit. */
  active: boolean;
  onShow: (
    tip: { datum: QuadrantDatum; x: number; y: number } | null,
  ) => void;
  onSelect: () => void;
}) {
  const t = useTranslations("tracker.quadrant");
  const style = datum.quadrant ? ZONE_STYLE[datum.quadrant] : null;

  /** Ancre CLAVIER : pas de curseur, on vise le centre du point lui-même. */
  const ancrerSurLePoint = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    onShow({ datum, x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };

  return (
    <button
      type="button"
      aria-label={t("point.aria", {
        label: datum.label.length > 0 ? datum.label : t("tooltip.noLabel"),
        compte: datum.compte,
        vues: formatNumber(datum.vues),
        saves: formatNumber(datum.saves),
      })}
      // L'infobulle SUIT le curseur tant qu'il reste sur le point : sur une
      // cible de 12 px, l'écart entre le bord et le centre suffit à décaler la
      // boîte, et c'est le curseur qui doit la porter, pas le point.
      onPointerEnter={(e) => onShow({ datum, x: e.clientX, y: e.clientY })}
      onPointerMove={(e) => onShow({ datum, x: e.clientX, y: e.clientY })}
      onPointerLeave={() => onShow(null)}
      onFocus={(e) => ancrerSurLePoint(e.currentTarget)}
      onBlur={() => onShow(null)}
      onClick={onSelect}
      className={cn(
        "absolute size-3 -translate-x-1/2 translate-y-1/2 cursor-pointer border transition-transform focus-visible:outline-none",
        // Losange pour la fenêtre de breakout : la FORME, pas la couleur — la
        // couleur est prise par le verdict.
        datum.breakout ? "rotate-45 rounded-[2px]" : "rounded-full",
        // Le point DÉCRIT passe devant et grossit : entre deux points voisins,
        // rien ne disait auquel des deux l'infobulle se rapportait.
        active
          ? "z-30 scale-[1.6] ring-2 ring-slate-900/25"
          : "z-10 hover:z-30 hover:scale-[1.6]",
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

/** Décalage constant entre le point d'ancrage et le coin de l'infobulle. */
const TIP_GAP = 12;
/** Marge minimale au bord de la fenêtre — l'infobulle n'y touche jamais. */
const TIP_EDGE = 8;

/**
 * Infobulle d'un point, ANCRÉE au point.
 *
 * Elle était posée à un coin fixe de la carte : il fallait quitter le point des
 * yeux pour la lire, et elle recouvrait la ligne de couverture.
 *
 * Le placement est calculé en `useLayoutEffect` — donc AVANT la peinture, sans
 * scintillement — parce qu'il demande la taille RÉELLE de la boîte : le contenu
 * varie (légende sur une ou deux lignes, mention de breakout ou non), et une
 * hauteur estimée ferait basculer la boîte trop tôt ou pas assez.
 *
 * La limite BASSE est le bas du CADRE DU GRAPHE, pas celui de la fenêtre :
 * en dessous vivent la légende et la ligne de couverture, qu'on ne recouvre
 * jamais. Quand la place manque, la boîte remonte au-dessus du point.
 */
function PointTip({
  datum,
  anchorX,
  anchorY,
  boundsRef,
}: {
  datum: QuadrantDatum;
  anchorX: number;
  anchorY: number;
  boundsRef: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations("tracker.quadrant");
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tip = el.getBoundingClientRect();
    const cadre = boundsRef.current?.getBoundingClientRect();
    const basLimite = Math.min(
      cadre?.bottom ?? window.innerHeight,
      window.innerHeight - TIP_EDGE,
    );
    const droiteLimite = window.innerWidth - TIP_EDGE;

    // À droite du point par défaut ; à gauche si elle déborderait.
    let left = anchorX + TIP_GAP;
    if (left + tip.width > droiteLimite) left = anchorX - TIP_GAP - tip.width;
    left = Math.max(TIP_EDGE, Math.min(left, droiteLimite - tip.width));

    // En dessous par défaut ; au-dessus si elle déborderait.
    let top = anchorY + TIP_GAP;
    if (top + tip.height > basLimite) top = anchorY - TIP_GAP - tip.height;
    top = Math.max(TIP_EDGE, top);

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [anchorX, anchorY, datum, boundsRef]);

  return (
    <div
      ref={ref}
      data-slot="quadrant-point-tip"
      // `pointer-events-none` : sans lui, la boîte se glisserait sous le
      // curseur et volerait le survol du point voisin.
      className="pointer-events-none fixed z-50 rounded-md border border-slate-200 bg-white p-2.5 text-xs shadow-lg"
      // 280 px PLAFOND, mais jamais plus que la fenêtre : à 390 px de large,
      // une boîte de 280 ne laisse que ~100 px de jeu horizontal, et le repli
      // la plaquait loin du point qu'elle décrit. Sur un écran étroit elle
      // s'ancre donc verticalement, et couvre la largeur.
      style={{ width: "min(280px, calc(100vw - 2rem))" }}
    >
      {/* Deux lignes au maximum : une longue légende doit être coupée, pas
          étirer la boîte. */}
      <p className="line-clamp-2 font-medium text-slate-900">
        {datum.label.length > 0 ? datum.label : t("tooltip.noLabel")}
      </p>
      <p className="truncate text-slate-500">
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
