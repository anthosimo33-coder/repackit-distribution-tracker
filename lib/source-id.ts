/**
 * Normalisation d'un sourceId de Short (anti-shadowban).
 *
 * Le sourceId identifie la vidéo source (typiquement un nom de fichier Drive,
 * ex: "short_042.mp4"). La normalisation garantit qu'un même fichier saisi
 * avec une casse, des espaces ou une extension différents matche toujours la
 * même clé — sinon le garde-fou anti-doublon TikTok aurait des faux négatifs.
 *
 * Règle (ordre) : trim → strip extension vidéo en fin de chaîne (.mp4 / .mov
 * / .webm / .avi, insensible à la casse) → lowercase. Pas de fuzzy matching
 * (trop risqué sur un garde-fou). Une extension non vidéo (ex: ".something")
 * n'est PAS retirée.
 *
 * ⚠️ Dupliqué côté serveur dans convex/publications.ts (cross-tsconfig : un
 * module Convex ne peut pas importer lib/, cf isFormatAllowedOnPlatform). Toute
 * évolution de cette règle doit être répliquée dans les deux fichiers.
 */
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".avi"] as const;

export function normalizeSourceId(raw: string): string {
  const lower = raw.trim().toLowerCase();
  for (const ext of VIDEO_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return lower.slice(0, lower.length - ext.length);
    }
  }
  return lower;
}
