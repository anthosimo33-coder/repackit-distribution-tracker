/**
 * Le ratio « vues / abonnés » des Inspirations. Repris du Radar (lib/radarParsing, components/admin/radar/radar-format)
 * quand il a quitté Jarvia pour Kopycat, le 20/11/2026 : la bibliothèque d'Inspirations s'en sert toujours.
 */

/**
 * Outlier ratio = vues / abonnés. GARDE-FOU : null si abonnés absent ou ≤ 0
 * (vidéo exclue du classement plutôt que division par zéro). Jamais NaN/Infinity.
 */
export function computeOutlierRatio(views: number, fans: number | null): number | null {
  if (fans === null || !Number.isFinite(fans) || fans <= 0) return null;
  if (!Number.isFinite(views) || views < 0) return null;
  return views / fans;
}

/** Outlier ratio vues/abonnés → "47×", "3,2×" (< 10 = 1 décimale). */
export function formatOutlierRatio(ratio: number, locale: string = "fr-FR"): string {
  if (!Number.isFinite(ratio) || ratio < 0) return "—";
  if (ratio >= 10) return `${Math.round(ratio)}×`;
  const v = ratio.toFixed(1);
  return `${locale.startsWith("en") ? v : v.replace(".", ",")}×`;
}
