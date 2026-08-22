import { describe, expect, it } from "vitest";

import { QUADRANT_AXES, QUADRANT_KEYS } from "../convex/quadrant";
import {
  DISTRIBUTION_MULTIPLIER,
  INTENT_SAVE_RATE,
} from "../convex/quadrantSettings";
import {
  projectX,
  projectY,
  SPLIT_X,
  SPLIT_Y,
  xBounds,
  xTicksFor,
  yMax,
  zoneBox,
} from "./quadrant-plot";

/**
 * PROJECTION du quadrant. Les deux axes sont repliés sur leur seuil : c'est ce
 * repli qui rend les quatre cases lisibles, et c'est donc lui qu'il faut
 * verrouiller. Une projection qui dérive d'un pour cent ne se voit pas à
 * l'écran — elle décale juste les points par rapport aux plaques colorées, et
 * un point se met à mentir sur sa case.
 *
 * Scores de la forme de la prod : médianes de compte entre 250 et 16 700, donc
 * des scores de 0,02 à ~100, et des save rates de 0 à ~3,5 %.
 */

const TH_X = DISTRIBUTION_MULTIPLIER;
const TH_Y = INTENT_SAVE_RATE * 100;
const SCORES = [0.02, 0.31, 0.87, 1.04, 2.8, 6.16, 22.4, 98.2];

describe("axe X — log replié sur le seuil", () => {
  const bounds = xBounds(SCORES, TH_X);

  it("le seuil tombe EXACTEMENT sur la ligne de séparation", () => {
    expect(projectX(TH_X, bounds, TH_X)).toBeCloseTo(SPLIT_X, 12);
  });

  it("les deux moitiés sont du bon côté de la ligne", () => {
    expect(projectX(0.31, bounds, TH_X)).toBeLessThan(SPLIT_X);
    expect(projectX(TH_X - 0.001, bounds, TH_X)).toBeLessThan(SPLIT_X);
    expect(projectX(TH_X + 0.001, bounds, TH_X)).toBeGreaterThan(SPLIT_X);
    expect(projectX(98.2, bounds, TH_X)).toBeGreaterThan(SPLIT_X);
  });

  it("est monotone croissante et reste dans le cadre", () => {
    const positions = SCORES.map((s) => projectX(s, bounds, TH_X));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    for (const p of positions) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("borne les valeurs hors domaine au lieu de sortir du cadre", () => {
    expect(projectX(1e-9, bounds, TH_X)).toBe(0);
    expect(projectX(1e9, bounds, TH_X)).toBe(1);
  });

  it("garde un vrai intervalle de CHAQUE côté, même sans point d'un côté", () => {
    // Tous les scores sous le seuil : sans garde, la borne haute vaudrait le
    // seuil et la projection diviserait par zéro (NaN, points hors cadre).
    const tousBas = xBounds([0.12, 0.34, 0.51], TH_X);
    expect(tousBas.max).toBeGreaterThan(TH_X);
    expect(Number.isFinite(projectX(0.34, tousBas, TH_X))).toBe(true);
    expect(projectX(TH_X, tousBas, TH_X)).toBeCloseTo(SPLIT_X, 12);

    const tousHauts = xBounds([12.4, 30.1], TH_X);
    expect(tousHauts.min).toBeLessThan(TH_X);
    expect(Number.isFinite(projectX(12.4, tousHauts, TH_X))).toBe(true);

    // Et le cas dégénéré total : aucun point du tout.
    const vide = xBounds([], TH_X);
    expect(vide.min).toBeLessThan(TH_X);
    expect(vide.max).toBeGreaterThan(TH_X);
    expect(projectX(TH_X, vide, TH_X)).toBeCloseTo(SPLIT_X, 12);
  });

  it("ignore les scores nuls — une échelle log ne les place pas", () => {
    const avecZero = xBounds([0, 0.31, 6.16], TH_X);
    expect(avecZero).toEqual(xBounds([0.31, 6.16], TH_X));
  });
});

describe("axe Y — linéaire par morceaux, replié sur le seuil", () => {
  const rates = [0, 0.12, 0.34, 0.5, 0.82, 1.94, 3.29];
  const max = yMax(rates, TH_Y);

  it("le seuil tombe EXACTEMENT sur la ligne de séparation", () => {
    expect(projectY(TH_Y, max, TH_Y)).toBeCloseTo(SPLIT_Y, 12);
  });

  it("un save rate nul est au plancher, pas au-dessous", () => {
    expect(projectY(0, max, TH_Y)).toBe(0);
  });

  it("la moitié BASSE occupe la part annoncée, et reste linéaire dedans", () => {
    // Mi-chemin du seuil ⇒ mi-chemin de la moitié basse.
    expect(projectY(TH_Y / 2, max, TH_Y)).toBeCloseTo(SPLIT_Y / 2, 12);
  });

  it("est monotone croissante et reste dans le cadre", () => {
    const positions = rates.map((r) => projectY(r, max, TH_Y));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    expect(positions[positions.length - 1]).toBeLessThanOrEqual(1);
  });

  it("garde une moitié haute non vide même si aucun point ne dépasse le seuil", () => {
    const bas = yMax([0.02, 0.11, 0.3], TH_Y);
    expect(bas).toBeGreaterThan(TH_Y);
    expect(projectY(TH_Y, bas, TH_Y)).toBeCloseTo(SPLIT_Y, 12);
    expect(Number.isFinite(projectY(0.3, bas, TH_Y))).toBe(true);
  });

  it("le repli DONNE de la place au bas : 0,5 % monte à 46 % au lieu de 13 %", () => {
    // Sans repli (linéaire de 0 au max), le seuil serait ici à ~14 % de la
    // hauteur — les deux cases du bas seraient des bandes. C'est l'écart que
    // cette échelle existe pour créer.
    const lineaire = TH_Y / max;
    expect(lineaire).toBeLessThan(0.2);
    expect(projectY(TH_Y, max, TH_Y)).toBeCloseTo(0.46, 12);
  });
});

describe("géométrie des zones", () => {
  it("chaque case est du côté que ses axes annoncent", () => {
    for (const key of QUADRANT_KEYS) {
      const { distributionHigh, intentHigh } = QUADRANT_AXES[key];
      const box = zoneBox(key);
      // Distribution haute ⇒ colonne de DROITE.
      expect(box.left).toBe(distributionHigh ? SPLIT_X : 0);
      expect(box.align).toBe(distributionHigh ? "right" : "left");
      // Intent haut ⇒ rangée du HAUT (top = 0 en coordonnées CSS).
      expect(box.top).toBe(intentHigh ? 0 : 1 - SPLIT_Y);
    }
  });

  it("les quatre cases pavent le cadre sans trou ni recouvrement", () => {
    const aire = QUADRANT_KEYS.reduce((s, k) => {
      const b = zoneBox(k);
      return s + b.width * b.height;
    }, 0);
    expect(aire).toBeCloseTo(1, 12);
  });

  it("un point tombe dans la zone de SA case", () => {
    const bounds = xBounds(SCORES, TH_X);
    const max = yMax([0.34, 2.2], TH_Y);
    // Distribution haute + intent haut ⇒ « scale », en haut à droite.
    const x = projectX(6.16, bounds, TH_X);
    const y = projectY(2.2, max, TH_Y);
    const box = zoneBox("scale");
    expect(x).toBeGreaterThanOrEqual(box.left);
    // `y` est mesuré DEPUIS LE BAS, la boîte depuis le haut.
    expect(1 - y).toBeGreaterThanOrEqual(box.top);
    expect(1 - y).toBeLessThanOrEqual(box.top + box.height);
  });
});

describe("graduations", () => {
  it("restent dans le domaine et n'y remettent pas le seuil", () => {
    const bounds = xBounds(SCORES, TH_X);
    const ticks = xTicksFor(bounds, TH_X);
    expect(ticks.length).toBeGreaterThan(3);
    for (const tick of ticks) {
      expect(tick.value).toBeGreaterThanOrEqual(bounds.min);
      expect(tick.value).toBeLessThanOrEqual(bounds.max);
      expect(tick.pos).toBeGreaterThanOrEqual(0);
      expect(tick.pos).toBeLessThanOrEqual(1);
    }
    // Le seuil a sa propre étiquette sur la ligne : l'afficher aussi comme
    // graduation ferait croire à deux repères différents.
    expect(ticks.some((tick) => tick.value === TH_X)).toBe(false);
    // Présence appariée : les graduations voisines, elles, sont bien là.
    expect(ticks.some((tick) => tick.value === 1)).toBe(true);
    expect(ticks.some((tick) => tick.value === 5)).toBe(true);
  });
});
