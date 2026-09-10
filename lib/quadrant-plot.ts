/**
 * PROJECTION du quadrant — de deux scores vers une position dans le cadre.
 *
 * ── Pourquoi des échelles sur mesure ─────────────────────────────────────────
 * Ce graphe sert à CLASSER, pas à comparer des magnitudes : la question posée
 * est « dans quelle case tombe ce post », et la valeur exacte est dans
 * l'infobulle du point. Une échelle fidèle aux magnitudes desservait cette
 * question — le seuil d'intent (0,5 %) sur un axe linéaire allant à 3,8 %
 * tombait à 13 % de la hauteur, et les deux cases du bas devenaient des bandes
 * où deux douzaines de points s'empilaient, illisibles.
 *
 * Les deux axes sont donc REPLIÉS sur leur seuil :
 *   - Y : linéaire PAR MORCEAUX. [0 ; seuil] occupe `SPLIT_Y` de la hauteur,
 *     [seuil ; max] le reste. Chaque moitié reste linéaire à l'intérieur, donc
 *     l'ordre des points et les écarts DANS une moitié sont préservés ; seul le
 *     rapport entre les deux moitiés est réglé pour la lisibilité.
 *   - X : l'échelle log est conservée (un ratio de distribution se lit en
 *     multiples), mais RECALÉE pour que le seuil tombe à `SPLIT_X`.
 *
 * Ce qu'on perd, assumé : on ne peut pas comparer à l'œil « deux fois plus haut
 * = deux fois plus de saves » d'une moitié à l'autre. Ce n'était pas la
 * question du graphe.
 *
 * ── Module PUR ───────────────────────────────────────────────────────────────
 * Aucun import React : ce sont des mathématiques de placement, testées en
 * vitest (`lib/quadrant-plot.test.ts`). Le composant ne fait que multiplier par
 * 100 et poser des pourcentages.
 */

import { QUADRANT_AXES, type QuadrantKey } from "../convex/quadrant";

/* ── Constantes de RENDU ──────────────────────────────────────────────────── */

/**
 * Position du seuil de distribution sur la largeur. 60 % et non 50 % : la
 * moitié « distribution faible » contient structurellement plus de points (la
 * plupart des posts ne sortent pas), elle a besoin de plus de place.
 */
export const SPLIT_X = 0.6;

/**
 * Part de la HAUTEUR donnée à la moitié basse de l'intent ([0 ; seuil]).
 * Un peu moins de la moitié : au-dessus du seuil les points sont plus rares et
 * plus dispersés, ils tolèrent d'être un peu plus au large.
 */
export const SPLIT_Y = 0.46;

/** Marge multiplicative autour des données, pour que rien ne colle au bord. */
const X_PAD = 1.35;

/**
 * Écart MINIMAL entre le seuil et une borne du domaine. Sans lui, un jeu dont
 * tous les points sont du même côté du seuil donnerait une borne égale au seuil
 * — donc une division par zéro dans la projection, et un axe replié sur un
 * point. On garantit toujours un vrai intervalle de chaque côté.
 */
const MIN_DECADE = 1.5;

export type Bounds = { min: number; max: number };

/**
 * Domaine de l'axe X (log), garanti STRICTEMENT de part et d'autre du seuil.
 * Les valeurs nulles ou négatives sont ignorées : une échelle log ne les place
 * pas (les posts concernés sont comptés dans la couverture, pas inventés ici).
 */
export function xBounds(
  scores: readonly number[],
  threshold: number,
): Bounds {
  const valides = scores.filter((s) => s > 0);
  const lo = valides.length ? Math.min(...valides) : threshold;
  const hi = valides.length ? Math.max(...valides) : threshold;
  return {
    min: Math.min(lo / X_PAD, threshold / MIN_DECADE),
    max: Math.max(hi * X_PAD, threshold * MIN_DECADE),
  };
}

/**
 * Borne haute de l'axe Y (en POURCENTS, comme `QuadrantDatum.y`). Toujours
 * au-dessus du seuil, même quand aucun point ne le dépasse — sinon la moitié
 * haute serait un intervalle vide et la ligne de seuil collerait au plafond.
 */
export function yMax(rates: readonly number[], thresholdPct: number): number {
  const hi = rates.length ? Math.max(...rates) : 0;
  return Math.max(hi * 1.08, thresholdPct * 2);
}

/* ── Projections ──────────────────────────────────────────────────────────── */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Score de distribution → abscisse dans [0, 1], le seuil tombant exactement sur
 * `SPLIT_X`. Log par morceaux : log dans chaque moitié, recalé sur le seuil.
 */
export function projectX(
  score: number,
  bounds: Bounds,
  threshold: number,
): number {
  const lo = Math.log10(bounds.min);
  const hi = Math.log10(bounds.max);
  const th = Math.log10(threshold);
  const v = Math.log10(Math.max(bounds.min, Math.min(bounds.max, score)));
  const pos =
    v <= th
      ? ((v - lo) / (th - lo)) * SPLIT_X
      : SPLIT_X + ((v - th) / (hi - th)) * (1 - SPLIT_X);
  return clamp01(pos);
}

/**
 * Save rate (en pourcents) → ordonnée dans [0, 1] MESURÉE DEPUIS LE BAS, le
 * seuil tombant exactement sur `SPLIT_Y`. Linéaire par morceaux.
 */
export function projectY(
  ratePct: number,
  max: number,
  thresholdPct: number,
): number {
  const pos =
    ratePct <= thresholdPct
      ? (ratePct / thresholdPct) * SPLIT_Y
      : SPLIT_Y + ((ratePct - thresholdPct) / (max - thresholdPct)) * (1 - SPLIT_Y);
  return clamp01(pos);
}

/* ── Géométrie des zones ──────────────────────────────────────────────────── */

/** Rectangle d'une zone, en fractions du cadre, coordonnées CSS (top depuis le haut). */
export type ZoneBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Le contenu se colle à ce bord, pour laisser le centre aux points. */
  align: "left" | "right";
};

/**
 * Rectangle d'une case, DÉDUIT de `QUADRANT_AXES` et jamais écrit à la main :
 * la position à l'écran suit la définition des axes, donc une inversion de
 * seuil ne peut pas laisser une zone au mauvais endroit sans que le test des
 * axes tombe d'abord.
 */
export function zoneBox(key: QuadrantKey): ZoneBox {
  const { distributionHigh, intentHigh } = QUADRANT_AXES[key];
  return {
    left: distributionHigh ? SPLIT_X : 0,
    width: distributionHigh ? 1 - SPLIT_X : SPLIT_X,
    top: intentHigh ? 0 : 1 - SPLIT_Y,
    height: intentHigh ? 1 - SPLIT_Y : SPLIT_Y,
    align: distributionHigh ? "right" : "left",
  };
}

/* ── Graduations ──────────────────────────────────────────────────────────── */

/** Graduations candidates, filtrées au domaine puis positionnées. */
const X_TICKS = [
  0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 3, 5, 10, 20, 50, 100, 200, 500,
] as const;

export type Tick = { value: number; pos: number };

/**
 * Graduations de l'axe X présentes dans le domaine. Le SEUIL n'en fait pas
 * partie : il a sa propre étiquette sur la ligne de séparation, et l'afficher
 * deux fois ferait croire à deux repères différents.
 */
export function xTicksFor(bounds: Bounds, threshold: number): Tick[] {
  return X_TICKS.filter(
    (v) => v >= bounds.min && v <= bounds.max && v !== threshold,
  ).map((value) => ({ value, pos: projectX(value, bounds, threshold) }));
}
