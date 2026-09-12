import type { MarketDerived } from "./market-aggregate";
import { VALUE_DAYS } from "../convex/marketValue";

/**
 * PLACER LES MARCHÉS — de deux montants vers une position dans le cadre.
 *
 * ── Module PUR, et c'est le point ───────────────────────────────────────────
 * Aucun import React : ce sont des mathématiques de placement, testées en
 * vitest. Le composant ne fait que poser des pourcentages. Même arrangement que
 * `lib/quadrant-plot` (carte « Vues × Intent »), et pour la même raison : une
 * projection réglée dans des options de bibliothèque ne se teste pas, une
 * fonction si.
 *
 * ── UNE SEULE ÉCHELLE POUR LES DEUX AXES DU QUADRANT ────────────────────────
 * Le quadrant oppose ce qu'un client COÛTE à ce qu'il RAPPORTE, et toute sa
 * lecture tient dans une diagonale : au-dessus, il rapporte plus qu'il n'a
 * coûté. Cette diagonale n'est la droite `y = x` que si les deux axes portent la
 * MÊME échelle. Deux échelles ajustées chacune à ses données la feraient
 * pencher, et un marché déficitaire se retrouverait du bon côté — le graphe
 * mentirait précisément sur ce qu'il existe pour dire.
 */

/** Marge intérieure du cadre, en fraction de sa taille. */
export const PADDING = 0.08;

export type Echelle = {
  /** Borne haute, commune aux deux axes. */
  max: number;
  /** Position horizontale d'une valeur, de 0 à 1 (gauche → droite). */
  x: (valeur: number) => number;
  /** Position verticale d'une valeur, de 0 à 1 (BAS → haut). */
  y: (valeur: number) => number;
  /** Les valeurs à graduer, bornes comprises. */
  ticks: number[];
};

/**
 * L'échelle du quadrant : une seule borne, arrondie vers le haut.
 *
 * Le maximum est pris sur les DEUX grandeurs (coût par client et valeur à
 * 90 jours), puis arrondi au multiple supérieur pour que les graduations
 * tombent juste. Une marge de 12 % laisse la bulle la plus haute entière dans
 * le cadre plutôt que collée au bord.
 */
export function quadrantScale(
  marches: readonly MarketDerived[],
  ticks = 4,
): Echelle {
  let plafond = 0;
  for (const m of marches) {
    if (m.cac !== null) plafond = Math.max(plafond, m.cac);
    const v90 = valeurA(m, 90);
    if (v90 !== null) plafond = Math.max(plafond, v90);
  }
  // Aucun marché mesurable : une échelle de 10 vaut mieux qu'une de 0, qui
  // ferait diviser par zéro et empilerait tout dans un coin.
  const { max, ticks: graduations } = echelleRonde(
    plafond > 0 ? plafond * 1.12 : 10,
    3,
    ticks + 1,
  );
  return {
    max,
    x: (v) => PADDING + (clamp01(v / max) * (1 - 2 * PADDING)),
    y: (v) => PADDING + (clamp01(v / max) * (1 - 2 * PADDING)),
    ticks: graduations,
  };
}

/**
 * L'échelle de la courbe de valeur : le temps en abscisse, l'argent en ordonnée.
 *
 * ⚠️ ELLE SE CALE SUR LES VALEURS SEULES, PAS SUR LES COÛTS D'ACQUISITION.
 * J'ai d'abord fait l'inverse, pour qu'aucune ligne de coût ne sorte du cadre.
 * Le rendu a tranché : un marché qui coûte 35 € par client pour une valeur de
 * 7 € tirait l'échelle à 40 €, et les cinq courbes se tassaient dans le tiers
 * bas — le seul franchissement utile du graphe (la France, à 6,67 €) devenait
 * invisible. Or c'est LUI que le panneau existe pour montrer.
 *
 * Une ligne de coût qui ne tient pas dans le cadre n'est donc pas tracée, et son
 * absence est DITE sous la courbe. Rien n'est caché pour autant : le
 * remboursement, juste au-dessus, affiche déjà « jamais » pour ce marché.
 */
export function curveScale(
  marches: readonly MarketDerived[],
  ticks = 4,
): Echelle & { jours: number[]; jourMax: number } {
  let plafond = 0;
  for (const m of marches) {
    for (const p of m.value) if (p.value !== null) plafond = Math.max(plafond, p.value);
  }
  const { max, ticks: graduations } = echelleRonde(
    plafond > 0 ? plafond * 1.12 : 10,
    3,
    ticks + 1,
  );
  const jourMax = VALUE_DAYS[VALUE_DAYS.length - 1];
  return {
    max,
    jourMax,
    jours: [...VALUE_DAYS],
    x: (jour) => PADDING + clamp01(jour / jourMax) * (1 - 2 * PADDING),
    y: (v) => PADDING + clamp01(v / max) * (1 - 2 * PADDING),
    ticks: graduations,
  };
}

/**
 * Rayon d'une bulle, en fraction de la largeur du cadre.
 *
 * En RACINE du nombre de clients, pas en proportion : l'œil compare des AIRES,
 * et un rayon proportionnel ferait lire un marché de cent clients cent fois plus
 * gros qu'un marché d'un seul, au lieu de dix. Le plancher garantit qu'un marché
 * d'un client reste cliquable.
 */
export function bubbleRadius(clients: number, maxClients: number): number {
  const MIN = 0.012;
  const MAX = 0.055;
  if (maxClients <= 0 || clients <= 0) return MIN;
  return MIN + Math.sqrt(clients / maxClients) * (MAX - MIN);
}

/** Un marché rapporte-t-il plus qu'il n'a coûté ? `null` si on ne sait pas. */
export function auDessusDuSeuil(m: MarketDerived): boolean | null {
  const v90 = valeurA(m, 90);
  if (m.cac === null || v90 === null) return null;
  return v90 >= m.cac;
}

/** La valeur de cohorte à un jalon, ou `null` sous le seuil d'effectif. */
export function valeurA(m: MarketDerived, jour: number): number | null {
  return m.value.find((v) => v.day === jour)?.value ?? null;
}

/**
 * LES MARCHÉS QUE LE QUADRANT PEUT PLACER.
 *
 * Il en faut DEUX coordonnées : un coût par client et une valeur à 90 jours. Un
 * marché sans client n'a ni l'une ni l'autre — il n'est pas « à zéro », il est
 * hors du plan. Le taire serait un oubli ; l'écran le dit sous le graphe, et le
 * remboursement, lui, le montre.
 */
export function marchesPlacables(
  marches: readonly MarketDerived[],
): MarketDerived[] {
  return marches.filter((m) => m.cac !== null && valeurA(m, 90) !== null);
}

/**
 * LES MARCHÉS QUE LA COURBE TRACE — les plus gros porteurs de clients.
 *
 * Vingt courbes côte à côte ne se lisent pas. On garde les cinq premiers par
 * nombre de clients acquis, et on écarte ceux dont aucun jalon n'est mesurable :
 * une courbe plate à zéro se lirait comme un marché qui ne rapporte rien, alors
 * qu'elle dit seulement qu'on ne sait pas encore.
 */
export function marchesTraces(
  marches: readonly MarketDerived[],
  combien = 5,
): MarketDerived[] {
  return marches
    .filter((m) => m.value.some((p) => p.value !== null))
    .slice()
    .sort((a, b) => b.clients - a.clients)
    .slice(0, combien);
}

/**
 * La largeur de la barre de remboursement, de 0 à 1.
 *
 * `jamais` et `inconnu` remplissent la piste : ce n'est pas « long », c'est
 * « hors mesure », et une barre courte se lirait comme un bon résultat. Le motif
 * de la barre, lui, dit lequel des deux — la largeur ne porte pas ce sens.
 */
export function largeurRemboursement(
  payback: MarketDerived["payback"],
  jourMax = VALUE_DAYS[VALUE_DAYS.length - 1],
): number {
  if (payback.state === "gratuit") return 0.03;
  if (payback.day === null) return 1;
  return Math.max(0.03, Math.min(1, payback.day / jourMax));
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Un pas de graduation « rond » : 1, 2, 2,5 ou 5 fois une puissance de dix.
 *
 * Sans lui, une échelle à 18,40 € graduerait 4,60 / 9,20 / 13,80 — trois
 * nombres qu'on ne lit pas. Le pas choisi est toujours SUPÉRIEUR ou égal au pas
 * brut, sinon le maximum sortirait du cadre.
 */
/**
 * L'ÉCHELLE RONDE : un pas lisible ET un plafond qui ne gaspille pas la hauteur.
 *
 * `joliPas` seul ne suffisait pas, et ça s'est vu au rendu : pour un plafond de
 * 20,60 €, il rendait un pas de 10 (la marche au-dessus de 5) et donc un maximum
 * de 40 € — le DOUBLE du nécessaire, et les cinq courbes tassées dans le tiers
 * bas du cadre.
 *
 * On essaie donc chaque pas de l'échelle (1, 2, 2,5, 5 × puissances de dix), on
 * ne garde que ceux qui découpent le cadre en 3 à 6 tranches — moins, on ne sait
 * plus lire une hauteur ; plus, la grille devient un grillage — et on retient
 * celui dont le plafond serre le plus les données.
 */
export function echelleRonde(
  brut: number,
  minDiv = 3,
  maxDiv = 6,
): { pas: number; max: number; ticks: number[] } {
  const cible = brut > 0 ? brut : 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(cible / maxDiv)));
  let meilleur: { pas: number; max: number } | null = null;
  for (const mult of [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50]) {
    const pas = mult * magnitude;
    if (!(pas > 0)) continue;
    const n = Math.ceil(cible / pas);
    if (n < minDiv || n > maxDiv) continue;
    const max = pas * n;
    if (meilleur === null || max < meilleur.max) meilleur = { pas, max };
  }
  // Aucun pas ne découpe proprement : on retombe sur le comportement simple
  // plutôt que de rendre une échelle vide.
  const { pas, max } = meilleur ?? { pas: joliPas(cible / 4), max: joliPas(cible / 4) * 4 };
  const n = Math.round(max / pas);
  return { pas, max, ticks: Array.from({ length: n + 1 }, (_, i) => pas * i) };
}

export function joliPas(brut: number): number {
  if (!(brut > 0)) return 1;
  const puissance = Math.pow(10, Math.floor(Math.log10(brut)));
  const norme = brut / puissance;
  const choix = norme <= 1 ? 1 : norme <= 2 ? 2 : norme <= 2.5 ? 2.5 : norme <= 5 ? 5 : 10;
  return choix * puissance;
}
