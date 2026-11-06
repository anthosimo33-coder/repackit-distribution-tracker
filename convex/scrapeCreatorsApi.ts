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

const BASE = "https://api.scrapecreators.com";
const TIMEOUT_MS = 60_000;

export const scKeyPresent = () => !!process.env.SCRAPECREATORS_API_KEY;

export type ScCall<T> =
  | { ok: true; value: T; credits: number; creditsRemaining?: number }
  | { ok: false; credits: number; noCredits: boolean; error: string };

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
      return { ok: false, credits: charged, noCredits: res.status === 402, error: `HTTP ${res.status} ${path} : ${msg}` };
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

/** Recherche TikTok par mot-clé, vidéos de la semaine les plus aimées (30 par crédit). */
export async function scSearchKeyword(query: string, region: string, lang: string): Promise<ScCall<SignalInput[]>> {
  const r = await scGet("/v1/tiktok/search/keyword", {
    query,
    date_posted: "this-week",
    sort_by: "most-liked",
    region,
    trim: "true",
  });
  if (!r.ok) return r;
  const list = Array.isArray(r.value.search_item_list) ? r.value.search_item_list : [];
  const videos = list.map((it) => parseScVideo(it, lang)).filter((x): x is SignalInput => x !== null);
  return { ...r, value: videos };
}

/** Les dernières vidéos d'un compte (9 par crédit, vérifié le 06/11/2026). */
export async function scProfileVideos(handle: string): Promise<ScCall<SignalInput[]>> {
  const r = await scGet("/v3/tiktok/profile/videos", { handle, sort_by: "latest", trim: "true" });
  if (!r.ok) return r;
  const list = Array.isArray(r.value.aweme_list) ? r.value.aweme_list : [];
  return { ...r, value: list.map((it) => parseScVideo(it)).filter((x): x is SignalInput => x !== null) };
}

/**
 * Une page de recherche pour le réseau d'une app : mot-clé (3 derniers mois, par
 * pertinence, 30 vidéos) ou hashtag (environ 20). `cursor` = page suivante.
 */
export async function scNetworkPage(
  kind: "keyword" | "hashtag",
  value: string,
  cursor: number | undefined,
): Promise<ScCall<{ videos: SignalInput[]; cursor: number | undefined }>> {
  const r =
    kind === "keyword"
      ? await scGet("/v1/tiktok/search/keyword", {
          query: value,
          date_posted: "last-3-months",
          sort_by: "relevance",
          trim: "true",
          ...(cursor !== undefined ? { cursor: String(cursor) } : {}),
        })
      : await scGet("/v1/tiktok/search/hashtag", { hashtag: value, trim: "true", ...(cursor !== undefined ? { cursor: String(cursor) } : {}) });
  if (!r.ok) return r;
  const raw = Array.isArray(r.value.search_item_list) ? r.value.search_item_list : Array.isArray(r.value.aweme_list) ? r.value.aweme_list : [];
  const next = typeof r.value.cursor === "number" ? r.value.cursor : typeof r.value.cursor === "string" ? Number(r.value.cursor) : undefined;
  return { ...r, value: { videos: raw.map((it) => parseScVideo(it)).filter((x): x is SignalInput => x !== null), cursor: Number.isFinite(next) ? next : undefined } };
}

/** Infos d'une vidéo (vues à jour, abonnés du compte) — 1 crédit. */
export async function scVideoInfo(url: string): Promise<ScCall<SignalInput | null>> {
  const r = await scGet("/v2/tiktok/video", { url, trim: "true" });
  if (!r.ok) return r;
  return { ...r, value: parseScVideo(r.value.aweme_detail) };
}
