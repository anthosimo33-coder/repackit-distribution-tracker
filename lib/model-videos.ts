/**
 * Vidéos MODÈLES (liens à reproduire) liées à un assignment — logique PURE
 * (validation d'URL + retrait par id), testée Vitest. Aucune dépendance
 * Convex/React.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. `normalizeModelVideoUrl` est
 * RÉPLIQUÉE côté serveur (convex/assignments.ts) ; toute évolution ici doit
 * l'être là-bas. La détection de plateforme pour l'affichage réutilise
 * lib/inspiration-url.ts (detectInspirationType) côté UI.
 */

export interface ModelVideo {
  id: string;
  url: string;
  title?: string;
  note?: string;
  addedAt: number;
}

/**
 * Valide + normalise (trim) une URL de vidéo modèle. Renvoie l'URL nettoyée, ou
 * `null` si invalide : vide après trim, ou ne commence pas par http(s)://. On
 * reste volontairement permissif (un lien TikTok/YT/Insta OU tout autre lien de
 * référence est accepté) — la plateforme précise est dérivée à l'affichage.
 */
export function normalizeModelVideoUrl(raw: string): string | null {
  const url = raw.trim();
  if (url.length === 0) return null;
  if (!/^https?:\/\/\S+/i.test(url)) return null;
  return url;
}

/** Retire une vidéo modèle par id (immuable — ne mute pas la liste source). */
export function removeModelVideoById(
  list: readonly ModelVideo[],
  id: string,
): ModelVideo[] {
  return list.filter((v) => v.id !== id);
}
