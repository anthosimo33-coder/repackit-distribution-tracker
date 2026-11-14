/**
 * Client ScrapeCreators (https://api.scrapecreators.com) pour le nouveau Radar.
 *
 * Clé : `process.env.SCRAPECREATORS_API_KEY`, envoyée en en-tête `x-api-key`. Elle
 * n'entre JAMAIS dans une URL, un message d'erreur ou un journal. Sans clé, rien
 * ne part : les tâches le disent et s'arrêtent (dev, e2e, preview).
 *
 * Chaque réponse porte `credits_charged` et `credits_remaining` : la dépense est
 * relevée sur ce que l'API dit avoir facturé, pas estimée.
 */
import { parseScVideo, type SignalInput } from "./radarSignalsMath";
import { igFollowers, parseIgReel, parseMetaAd, parseTikTokAd, transcriptText, type AdInput, type IgReel } from "./radarSourcesMath";

const BASE = "https://api.scrapecreators.com";
const TIMEOUT_MS = 60_000;

export const scKeyPresent = () => !!process.env.SCRAPECREATORS_API_KEY;

export type ScCall<T> =
  | { ok: true; value: T; credits: number; creditsRemaining?: number }
  // Un refus faute de crédits (HTTP 402) dit le solde : 0. Sans ça, l'écran et les alertes garderaient le dernier lu.
  | { ok: false; credits: number; noCredits: boolean; error: string; creditsRemaining?: number };

async function scGet(path: string, params: Record<string, string>): Promise<ScCall<Record<string, unknown>>> {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) return { ok: false, credits: 0, noCredits: false, error: "SCRAPECREATORS_API_KEY absente" };
  const url = `${BASE}${path}?${new URLSearchParams(params).toString()}`;
  try {
    const res = await fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Corps non JSON : on garde le statut, jamais l'URL.
    }
    const charged = typeof body.credits_charged === "number" ? body.credits_charged : 0;
    if (!res.ok || body.success === false) {
      const msg = typeof body.message === "string" ? body.message : text.slice(0, 200);
      return { ok: false, credits: charged, noCredits: res.status === 402, error: `HTTP ${res.status} ${path} : ${msg}`, ...(res.status === 402 ? { creditsRemaining: 0 } : {}) };
    }
    return {
      ok: true,
      value: body,
      credits: typeof body.credits_charged === "number" ? body.credits_charged : 1,
      ...(typeof body.credits_remaining === "number" ? { creditsRemaining: body.credits_remaining } : {}),
    };
  } catch (e) {
    return { ok: false, credits: 0, noCredits: false, error: `${path} : ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Les réponses NON allégées (sans `trim`) coûtent le même crédit et portent le
// texte incrusté (le hook), le son et les mentions (vérifié le 06/11/2026 :
// ~70 Ko par vidéo). Seul le relevé de courbe, qui ne lit que les vues, s'allège.

/** Recherche TikTok par mot-clé, vidéos de la semaine les plus aimées (30 par crédit). */
export async function scSearchKeyword(query: string, region: string, lang: string): Promise<ScCall<SignalInput[]>> {
  const r = await scGet("/v1/tiktok/search/keyword", {
    query,
    date_posted: "this-week",
    sort_by: "most-liked",
    region,
  });
  if (!r.ok) return r;
  const list = Array.isArray(r.value.search_item_list) ? r.value.search_item_list : [];
  const videos = list.map((it) => parseScVideo(it, lang)).filter((x): x is SignalInput => x !== null);
  return { ...r, value: videos };
}

/**
 * Recherche TikTok par mot-clé, vidéos de la semaine les plus RÉCENTES d'abord (30 par crédit) : pour trouver ce
 * que publient de petits comptes, que le tri par « j'aime » ne remonte jamais (convex/radarNaming).
 */
export async function scSearchRecent(query: string, region: string, lang: string): Promise<ScCall<SignalInput[]>> {
  const r = await scGet("/v1/tiktok/search/keyword", { query, date_posted: "this-week", sort_by: "date-posted", region });
  if (!r.ok) return r;
  const list = Array.isArray(r.value.search_item_list) ? r.value.search_item_list : [];
  return { ...r, value: list.map((it) => parseScVideo(it, lang)).filter((x): x is SignalInput => x !== null) };
}

/** Les dernières vidéos d'un compte (9 par crédit, vérifié le 06/11/2026). */
export async function scProfileVideos(handle: string): Promise<ScCall<SignalInput[]>> {
  const r = await scGet("/v3/tiktok/profile/videos", { handle, sort_by: "latest" });
  if (!r.ok) return r;
  const list = Array.isArray(r.value.aweme_list) ? r.value.aweme_list : [];
  return { ...r, value: list.map((it) => parseScVideo(it)).filter((x): x is SignalInput => x !== null) };
}

/**
 * La requête d'une page de recherche de réseau. `region` : code pays à deux
 * lettres du relais (doc ScrapeCreators, les deux recherches l'acceptent) ; sans
 * région, la requête est celle d'avant le 11/11/2026, à l'identique.
 */
export function networkPageRequest(
  kind: "keyword" | "hashtag",
  value: string,
  cursor: number | undefined,
  region?: string,
  // « date » : les plus récentes d'abord (recherche complète d'une app) ; sinon par pertinence, comme toujours.
  sort?: "date",
): { path: string; params: Record<string, string> } {
  const more = { ...(region ? { region } : {}), ...(cursor !== undefined ? { cursor: String(cursor) } : {}) };
  return kind === "keyword"
    ? { path: "/v1/tiktok/search/keyword", params: { query: value, date_posted: "last-3-months", sort_by: sort === "date" ? "date-posted" : "relevance", ...more } }
    : { path: "/v1/tiktok/search/hashtag", params: { hashtag: value, ...more } };
}

/**
 * Une page de recherche pour le réseau d'une app : mot-clé (3 derniers mois, par
 * pertinence, 30 vidéos) ou hashtag (environ 20). `cursor` = page suivante.
 */
export async function scNetworkPage(
  kind: "keyword" | "hashtag",
  value: string,
  cursor: number | undefined,
  region?: string,
  sort?: "date",
): Promise<ScCall<{ videos: SignalInput[]; cursor: number | undefined }>> {
  const q = networkPageRequest(kind, value, cursor, region, sort);
  const r = await scGet(q.path, q.params);
  if (!r.ok) return r;
  const raw = Array.isArray(r.value.search_item_list) ? r.value.search_item_list : Array.isArray(r.value.aweme_list) ? r.value.aweme_list : [];
  const next = typeof r.value.cursor === "number" ? r.value.cursor : typeof r.value.cursor === "string" ? Number(r.value.cursor) : undefined;
  return { ...r, value: { videos: raw.map((it) => parseScVideo(it)).filter((x): x is SignalInput => x !== null), cursor: Number.isFinite(next) ? next : undefined } };
}

/** Bibliothèque de pubs TikTok, par mot-clé (1 crédit). */
export async function scTikTokAds(query: string, now: number): Promise<ScCall<AdInput[]>> {
  const r = await scGet("/v1/tiktok/ad-library/search", { query });
  if (!r.ok) return r;
  return { ...r, value: (Array.isArray(r.value.ads) ? r.value.ads : []).map((a) => parseTikTokAd(a, now)).filter((x): x is AdInput => x !== null) };
}

/** Bibliothèque de pubs Meta, par mot-clé, actives et passées, les plus vues d'abord (1 crédit). */
export async function scMetaAds(query: string): Promise<ScCall<AdInput[]>> {
  const r = await scGet("/v1/facebook/adLibrary/search/ads", { query, status: "ALL", sort_by: "total_impressions" });
  if (!r.ok) return r;
  return { ...r, value: (Array.isArray(r.value.searchResults) ? r.value.searchResults : []).map(parseMetaAd).filter((x): x is AdInput => x !== null) };
}

/** Les derniers Reels d'un compte Instagram, avec leurs vues (1 crédit, ~12 Reels). */
export async function scIgReels(handle: string): Promise<ScCall<IgReel[]>> {
  const r = await scGet("/v1/instagram/user/reels", { handle });
  if (!r.ok) return r;
  return { ...r, value: (Array.isArray(r.value.items) ? r.value.items : []).map(parseIgReel).filter((x): x is IgReel => x !== null) };
}

/** Abonnés d'un compte Instagram (1 crédit) : lu une fois, au premier relevé. */
export async function scIgFollowers(handle: string): Promise<ScCall<number | undefined>> {
  const r = await scGet("/v1/instagram/profile", { handle });
  if (!r.ok) return r;
  return { ...r, value: igFollowers(r.value) };
}

/**
 * Ce qui est dit dans une vidéo TikTok : sous-titres natifs, sinon l'IA jusqu'à
 * 2 minutes (1 crédit ; 0 s'il n'y a rien à transcrire).
 */
export async function scTranscript(url: string): Promise<ScCall<string | null>> {
  const r = await scGet("/v1/tiktok/video/transcript", { url, use_ai_as_fallback: "true" });
  if (!r.ok) return r;
  return { ...r, value: transcriptText(r.value) };
}

/** Infos d'une vidéo (vues à jour, abonnés du compte) — 1 crédit. */
export async function scVideoInfo(url: string): Promise<ScCall<SignalInput | null>> {
  const r = await scGet("/v2/tiktok/video", { url, trim: "true" });
  if (!r.ok) return r;
  return { ...r, value: parseScVideo(r.value.aweme_detail) };
}
