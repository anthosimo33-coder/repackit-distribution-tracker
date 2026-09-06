/**
 * FENÊTRAGE de l'attribution — logique PURE (testée Vitest, aucune dép React).
 *
 * `getAttribution` rend des agrégats CUMULÉS plus une liste de lignes (une par
 * vidéo) qui, elle, porte son jour. Tout ce que les onglets affichent en dérive :
 * les coûts, les jours solo, l'efficacité par créatrice. Ce module refait ces
 * dérivations sur une FENÊTRE, à partir des mêmes lignes.
 *
 * ⚠️ POINT UNIQUE DU COÛT SUR UNE FENÊTRE. Il existait déjà une version de ce
 * calcul dans OverviewTab (`aggregatesFor`) ; l'écrire une seconde fois pour les
 * autres onglets aurait garanti la divergence — deux écrans montrant deux coûts
 * pour la même période, comme le hub et l'écran Paiements l'ont déjà fait pour le
 * revenu Whop. `aggregatesFor` consomme désormais `windowCosts`.
 */

import {
  computeCreatorEfficiency,
  computeSoloDays,
  type CreatorEfficiency,
  type DailyBehavior,
  type PromoVideo,
  type SoloDay,
} from "../convex/soloDays";
import {
  rowsInWindow,
  sumInWindow,
  type AnalyticsWindow,
} from "./analytics-window";

/** Une ligne de vidéo, telle que `getAttribution` la rend. */
export interface AttributionRowLike {
  day: string;
  creatorId: string;
  creatorName: string;
  promoViews: number;
  payableViews: number;
  hasPromoPost: boolean;
  /** `null` = coût par vidéo INCONNU (assignation legacy sans barème). */
  cost: number | null;
  promoCost: number | null;
}

export interface WindowCosts<T extends AttributionRowLike = AttributionRowLike> {
  /** Fixe + CPM des vidéos PROMO. `null` si un coût par vidéo manque. */
  promo: number | null;
  /** Fixe + CPM de TOUTES les vidéos (warmup inclus). `null` idem. */
  full: number | null;
  /** Bonus de paliers + primes de défi attribués dans la fenêtre. */
  bonus: number | null;
  /** Σ des vues promo des vidéos publiées dans la fenêtre. */
  promoViews: number;
  /**
   * Les lignes retenues — pour que l'appelant n'ait pas à refiltrer. Le type
   * d'ENTRÉE est préservé : l'onglet Acquisition lit des champs (format, langue,
   * plateformes) que ce module n'a pas à connaître, et les lui rendre amputées
   * l'obligerait à refaire le filtrage lui-même.
   */
  rows: T[];
}

/**
 * Coûts d'une fenêtre.
 *
 * Une SEULE vidéo à coût inconnu rend la somme `null` : on refuse le chiffre
 * plutôt que de sommer autour du trou. C'est la règle déjà appliquée côté
 * serveur par `costs.promo`, et la répéter ici est délibéré — un total partiel
 * se lirait comme un total.
 */
export function windowCosts<T extends AttributionRowLike>(
  rows: readonly T[],
  bonusByDay: readonly { day: string; amount: number }[],
  w: AnalyticsWindow | null,
): WindowCosts<T> {
  const kept = rowsInWindow(rows, w, (r) => r.day);
  const promoRows = kept.filter((r) => r.hasPromoPost);
  return {
    promo: promoRows.some((r) => r.promoCost === null)
      ? null
      : promoRows.reduce((t, r) => t + (r.promoCost ?? 0), 0),
    full: kept.some((r) => r.cost === null)
      ? null
      : kept.reduce((t, r) => t + (r.cost ?? 0), 0),
    bonus: sumInWindow(bonusByDay, w, (b) => b.day, (b) => b.amount),
    promoViews: promoRows.reduce((t, r) => t + r.promoViews, 0),
    rows: kept,
  };
}

/**
 * Vidéos promo d'une fenêtre, au format attendu par `computeSoloDays`.
 *
 * Une vidéo dont AUCUN post n'est en promo n'a rien à faire dans un jour solo :
 * le jour solo mesure une présence PROMO, et c'est ce que `hasPromoPost` dit —
 * y compris à zéro vue, où la présence compte quand même.
 */
export function promoVideosOf(
  rows: readonly AttributionRowLike[],
): PromoVideo[] {
  return rows
    .filter((r) => r.hasPromoPost)
    .map((r) => ({
      day: r.day,
      creatorId: r.creatorId,
      creatorName: r.creatorName,
      promoViews: r.promoViews,
    }));
}

export interface WindowedAttribution<T extends AttributionRowLike = AttributionRowLike> {
  rows: T[];
  soloDays: SoloDay[];
  creators: CreatorEfficiency[];
  costs: WindowCosts<T>;
}

/**
 * Toute l'attribution, refaite sur la fenêtre.
 *
 * `daily` est passé TEL QUEL, sans filtrage : `computeSoloDays` ne s'en sert que
 * comme table de correspondance jour → compteurs, et les jours produits viennent
 * des VIDÉOS, déjà fenêtrées. Le filtrer serait du code mort — vérifié en le
 * cassant : aucune assertion ne bougeait.
 */
export function windowedAttribution<T extends AttributionRowLike>(
  rows: readonly T[],
  bonusByDay: readonly { day: string; amount: number }[],
  daily: readonly DailyBehavior[],
  w: AnalyticsWindow | null,
): WindowedAttribution<T> {
  const costs = windowCosts(rows, bonusByDay, w);
  const videos = promoVideosOf(costs.rows);
  return {
    rows: costs.rows,
    soloDays: computeSoloDays(videos, daily),
    creators: computeCreatorEfficiency(videos),
    costs,
  };
}
