/**
 * S3 — Statistiques de distribution PURES pour l'analytics de scripts (par
 * brique / tier / combo). Aucune dépendance Convex/React → testé Vitest.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. Ces fonctions sont
 * RÉPLIQUÉES côté serveur (convex/scriptAnalytics.ts) pour les adminQuery ;
 * toute évolution ici doit l'être là-bas. Les tests vivent ici.
 *
 * Choix : la MÉDIANE est le repère principal (robuste aux outliers d'une vidéo
 * virale), pas la moyenne. Les quartiles (p25/p75) donnent la dispersion.
 */

/** Seuil de données : une brique/tier/combo n'est "jugeable" qu'à partir de ce
 *  nombre de posts mesurés. En-dessous → "en test", jamais déclaré gagnant. */
export const JUGEABLE_THRESHOLD = 50;

export type DataStatus = "en_test" | "jugeable";

export function statusForCount(postCount: number): DataStatus {
  return postCount >= JUGEABLE_THRESHOLD ? "jugeable" : "en_test";
}

/** Médiane d'un échantillon. `null` si vide. n pair → moyenne des 2 centraux. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Moyenne arithmétique. `null` si vide. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * Quantile q ∈ [0,1] par interpolation linéaire entre rangs (méthode numpy
 * "linear" / Excel PERCENTILE.INC). `null` si vide. Pour n=1 → la seule valeur.
 */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export interface Distribution {
  postCount: number;
  viewsMedian: number | null;
  viewsMean: number | null;
  viewsP25: number | null;
  viewsP75: number | null;
  status: DataStatus;
}

/** Résumé statistique complet d'un échantillon de vues. */
export function summarize(values: readonly number[]): Distribution {
  return {
    postCount: values.length,
    viewsMedian: median(values),
    viewsMean: mean(values),
    viewsP25: quantile(values, 0.25),
    viewsP75: quantile(values, 0.75),
    status: statusForCount(values.length),
  };
}
