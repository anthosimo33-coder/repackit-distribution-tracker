import { computeOutlierRatio } from "./radarParsing";

/**
 * Sous-ensemble structurel des stats d'une inspiration nécessaire au calcul du
 * ratio outlier affiché (cf. schema `inspirations.stats`). Type minimal volontaire :
 * garde ce helper pur et testable sans coupler au Doc Convex.
 */
export interface OutlierRatioInput {
  views?: number;
  followers?: number;
  outlierRatio?: number;
}

/**
 * Ratio outlier À AFFICHER pour une inspiration. Source UNIQUE partagée par la
 * grille ET la liste → rendu identique dans les deux modes, et identique à
 * l'onglet Radar Outliers (même valeur, même format via formatOutlierRatio).
 *
 * Priorité :
 *   1. ratio STOCKÉ (`stats.outlierRatio`, provenance Radar Outliers) ;
 *   2. sinon FALLBACK calculé `views / followers` via computeOutlierRatio — la
 *      fonction pure déjà partagée avec Radar (décision fondateur A). On NE
 *      recalcule RIEN à la main : réutilisation stricte du helper existant ;
 *   3. `null` pour un compte (le ratio est par vidéo) ou données insuffisantes
 *      (followers absent/≤0 → computeOutlierRatio renvoie déjà null).
 */
export function resolveOutlierRatio(
  stats: OutlierRatioInput | undefined,
  type: "video" | "account",
): number | null {
  if (type !== "video" || !stats) return null;
  if (typeof stats.outlierRatio === "number") return stats.outlierRatio;
  if (typeof stats.views === "number" && typeof stats.followers === "number") {
    return computeOutlierRatio(stats.views, stats.followers);
  }
  return null;
}
