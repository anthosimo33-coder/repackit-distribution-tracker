/**
 * Vidéos modèles (« à reproduire ») — helpers PURS pour l'embed in-app, testés
 * Vitest. Le composant <VideoExample> (formats) sait déjà rendre un embed
 * officiel YouTube / TikTok / Instagram ; ici on fournit le mapping + la
 * détection des shortlinks TikTok (qui doivent être résolus en URL canonique
 * avant l'oEmbed).
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. isTikTokShortlink / isTikTokHost
 * sont RÉPLIQUÉS côté serveur dans convex/modelVideoEmbeds.ts (où vit l'I/O réseau
 * de l'action). Toute évolution doit être faite des DEUX côtés ; les tests vivent ici.
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
 * Shortlink TikTok (vm.tiktok.com / vt.tiktok.com) : pointe vers une vidéo via
 * un redirect, mais l'oEmbed TikTok exige l'URL canonique (/@user/video/ID) →
 * doit être résolu serveur (suivi du redirect) avant l'embed.
 */
export function isTikTokShortlink(url: string): boolean {
  return /^https?:\/\/(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9]+/i.test(url.trim());
}

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
