/**
 * Vidéos modèles (« à reproduire ») — helpers PURS pour l'embed in-app, testés
 * Vitest. Le composant <VideoExample> (formats) sait déjà rendre un embed
 * officiel YouTube / TikTok / Instagram ; ici on fournit le mapping + la
 * détection des shortlinks TikTok (qui doivent être résolus en URL canonique
 * avant l'oEmbed).
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. `isTikTokHost` reste RÉPLIQUÉ
 * côté serveur dans convex/modelVideoEmbeds.ts (où vit l'I/O réseau de l'action) :
 * toute évolution doit être faite des DEUX côtés. `isTikTokShortlink`, lui, n'est
 * plus une réplique — il vit dans le module pur convex/postUrlDate.ts et n'est que
 * ré-exporté ici. Les tests vivent dans ce fichier dans les deux cas.
 */

import type { Plateforme } from "./inspiration-url";

/** Identifiant de plateforme attendu par <VideoExample> (kind "url"). */
export type EmbedPlatform = "tiktok" | "instagram" | "youtube";

/** Plateforme détectée (detectInspirationType) → identifiant <VideoExample>. */
export function videoExamplePlatform(plateforme: Plateforme): EmbedPlatform {
  return plateforme === "TikTok"
    ? "tiktok"
    : plateforme === "Instagram"
      ? "instagram"
      : "youtube";
}

/**
 * Shortlink TikTok : pointe vers une vidéo via un redirect, mais l'oEmbed / la
 * sync métriques exigent l'URL canonique (/@user/video/ID) → doit être résolu
 * serveur (suivi du redirect) avant l'embed. DEUX formats de partage TikTok :
 *   - sous-domaine : vm.tiktok.com/CODE, vt.tiktok.com/CODE
 *   - chemin /t/   : (www.)tiktok.com/t/CODE  ← ajouté (sinon jamais résolu ni
 *     tracké : tiktokPostId renvoie null sur /t/, le post reste à 0 vue).
 *
 * Plus une réplique : la DÉFINITION vit dans `convex/postUrlDate.ts` (module pur,
 * A6 autorise lib/ → convex/), ré-exportée ici pour ses appelants existants. Les
 * tests de ce fichier valent donc pour l'unique implémentation.
 */
export { isTikTokShortlink } from "../convex/postUrlDate";

/**
 * Host TikTok légitime — garde ANTI-SSRF : la résolution d'un shortlink ne doit
 * accepter comme cible finale qu'une URL d'un host tiktok.com (jamais suivre un
 * redirect vers un host arbitraire).
 */
export function isTikTokHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "tiktok.com" || h.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}
