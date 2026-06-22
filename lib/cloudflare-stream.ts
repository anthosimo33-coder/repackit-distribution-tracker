/**
 * Cloudflare Stream — helpers PURS (sans I/O), testés Vitest et partagés
 * client/serveur. Le transcoding HEVC vit côté Cloudflare ; ici on ne dérive que
 * des chaînes et un mapping d'état.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. `mapStreamState` est RÉPLIQUÉ
 * dans convex/cloudflareStreamApi.ts (qui tourne dans le runtime action). Toute
 * évolution doit être faite des DEUX côtés. `streamIframeUrl` n'est utilisé que
 * côté client (le player React) → pas de réplique nécessaire.
 */

/**
 * État NORMALISÉ d'une vidéo Stream tel que stocké sur la soumission :
 *  - "processing" : uploadée, transcoding en cours (pas encore visionnable) ;
 *  - "ready"      : transcodée, le player Stream la lit (HEVC inclus) ;
 *  - "error"      : Cloudflare a échoué le transcoding (fallback Convex).
 */
export type StreamStatus = "processing" | "ready" | "error";

/**
 * Mappe l'état BRUT renvoyé par Cloudflare (`result.status.state`) vers notre
 * état normalisé. Cloudflare expose : pendingupload, downloading, queued,
 * inprogress, ready, error. Tout ce qui n'est ni "ready" ni "error" est encore
 * en cours → "processing".
 */
export function mapStreamState(state: string | null | undefined): StreamStatus {
  const s = (state ?? "").trim().toLowerCase();
  if (s === "ready") return "ready";
  if (s === "error") return "error";
  return "processing";
}

/**
 * URL d'embed du player Stream pour un UID. `iframe.videodelivery.net` est le
 * domaine d'embed UNIVERSEL (ne nécessite pas le sous-domaine `customer-<code>`
 * du compte) — le player officiel Cloudflare lit le HLS/DASH transcodé, donc
 * aussi les .mov HEVC iPhone. Le UID est encodé pour rester sûr en attribut src.
 */
export function streamIframeUrl(uid: string): string {
  return `https://iframe.videodelivery.net/${encodeURIComponent(uid)}`;
}
