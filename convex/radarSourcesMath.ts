/**
 * NOUVEAU RADAR — lecture PURE des sources ajoutées le 06/11/2026 (aucun accès
 * base, aucun réseau) : pubs des bibliothèques TikTok et Meta, Reels Instagram,
 * transcriptions TikTok. Formes relevées sur de vraies réponses ScrapeCreators
 * (lib/radar-sources.test.ts).
 */

const obj = (x: unknown): Record<string, unknown> | null =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const str = (x: unknown): string | undefined => (typeof x === "string" && x.trim() !== "" ? x : undefined);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

const DAY = 86_400_000;

// ─── Pubs ────────────────────────────────────────────────────────────────────

export type AdInput = {
  platform: "tiktok" | "meta";
  adId: string;
  advertiser: string;
  text?: string;
  firstShownAt?: number;
  lastShownAt?: number;
  active: boolean;
  /** TikTok : tranche d'audience (« 0-1K ») ; Meta : variantes de la même pub. */
  audience?: string;
  variants?: number;
  platforms: string[];
  url: string;
  videoUrl?: string;
  coverUrl?: string;
};

/**
 * Une pub de la bibliothèque TikTok (`ads[i]`). Les dates arrivent en
 * millisecondes ; une pub vue dans les 2 derniers jours est dite active. La
 * recherche ne rend pas le texte de la pub.
 */
export function parseTikTokAd(raw: unknown, now: number): AdInput | null {
  const a = obj(raw);
  const adId = str(a?.id);
  if (!a || !adId) return null;
  const first = num(a.first_shown_date) || undefined;
  const last = num(a.last_shown_date) || undefined;
  const video = obj(arr(a.videos)[0]);
  return {
    platform: "tiktok",
    adId,
    advertiser: str(a.name) ?? "",
    ...(first ? { firstShownAt: first } : {}),
    ...(last ? { lastShownAt: last } : {}),
    active: last !== undefined && now - last <= 2 * DAY,
    ...(str(a.estimated_audience) ? { audience: str(a.estimated_audience) } : {}),
    platforms: ["tiktok"],
    url: str(a.url) ?? `https://library.tiktok.com/ads/detail/?ad_id=${adId}`,
    ...(str(video?.video_url) ? { videoUrl: str(video?.video_url) } : {}),
    ...(str(video?.cover_img) ? { coverUrl: str(video?.cover_img) } : {}),
  };
}

/** Une pub de la bibliothèque Meta (`searchResults[i]` ou `results[i]`) : dates en secondes. */
export function parseMetaAd(raw: unknown): AdInput | null {
  const a = obj(raw);
  const adId = str(a?.ad_archive_id) ?? (typeof a?.ad_archive_id === "number" ? String(a.ad_archive_id) : undefined);
  if (!a || !adId) return null;
  const sn = obj(a.snapshot) ?? {};
  const body = obj(sn.body);
  const text = [str(body?.text) ?? str(sn.body), str(sn.title), str(sn.link_description)].filter(Boolean).join(" · ");
  const video = obj(arr(sn.videos)[0]);
  const image = obj(arr(sn.images)[0]);
  const start = num(a.start_date);
  const end = num(a.end_date);
  return {
    platform: "meta",
    adId,
    advertiser: str(sn.page_name) ?? str(a.page_name) ?? "",
    ...(text ? { text: text.slice(0, 600) } : {}),
    ...(start ? { firstShownAt: start * 1000 } : {}),
    ...(end ? { lastShownAt: end * 1000 } : {}),
    active: a.is_active === true,
    ...(num(a.collation_count) > 1 ? { variants: num(a.collation_count) } : {}),
    platforms: arr(a.publisher_platform).filter((p): p is string => typeof p === "string").map((p) => p.toLowerCase()),
    url: str(a.url) ?? `https://www.facebook.com/ads/library/?id=${adId}`,
    ...(str(video?.video_hd_url) ?? str(video?.video_sd_url) ? { videoUrl: str(video?.video_hd_url) ?? str(video?.video_sd_url) } : {}),
    ...(str(video?.video_preview_image_url) ?? str(image?.resized_image_url)
      ? { coverUrl: str(video?.video_preview_image_url) ?? str(image?.resized_image_url) }
      : {}),
  };
}

/** Jours de diffusion d'une pub : de sa première à sa dernière apparition (ou aujourd'hui si active). */
export function adRunDays(ad: Pick<AdInput, "firstShownAt" | "lastShownAt" | "active">, now: number): number | null {
  if (ad.firstShownAt === undefined) return null;
  const end = ad.active ? now : (ad.lastShownAt ?? ad.firstShownAt);
  return Math.max(1, Math.round((end - ad.firstShownAt) / DAY) + 1);
}

// ─── Instagram ───────────────────────────────────────────────────────────────

export type IgReel = {
  code: string;
  url: string;
  publishedAt: number;
  views: number;
  likes: number;
  comments: number;
  durationSec?: number;
  coverUrl?: string;
  /** Texte incrusté avec l'outil d'Instagram (le hook), s'il y en a un. */
  hook?: string;
};

/** Un Reel de `/v1/instagram/user/reels` (`items[i].media`). La légende n'y est pas. */
export function parseIgReel(raw: unknown): IgReel | null {
  const m = obj(obj(raw)?.media) ?? obj(raw);
  const code = str(m?.code);
  const takenAt = num(m?.taken_at);
  if (!m || !code || takenAt <= 0) return null;
  const clips = obj(m.clips_metadata);
  const hook = str(clips?.reusable_text_attribute_string)?.replace(/\s+/g, " ").trim().slice(0, 200);
  const cover = obj(arr(obj(m.image_versions2)?.candidates)[0]);
  const duration = num(m.video_duration);
  return {
    code,
    url: `https://www.instagram.com/reel/${code}/`,
    publishedAt: takenAt * 1000,
    views: num(m.play_count) || num(m.ig_play_count),
    likes: num(m.like_count),
    comments: num(m.comment_count),
    ...(duration > 0 ? { durationSec: Math.round(duration * 10) / 10 } : {}),
    ...(str(cover?.url) ? { coverUrl: str(cover?.url) } : {}),
    ...(hook ? { hook } : {}),
  };
}

/** Abonnés d'un profil Instagram (`/v1/instagram/profile`), `undefined` s'il est illisible. */
export function igFollowers(body: unknown): number | undefined {
  const user = obj(obj(obj(body)?.data)?.user);
  const n = obj(user?.edge_followed_by)?.count;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

// ─── Transcriptions ──────────────────────────────────────────────────────────

/**
 * Le texte dit dans une vidéo (`/v1/tiktok/video/transcript`) : les segments mis
 * bout à bout, sinon le WebVTT sans ses horodatages. `null` s'il n'y a rien.
 */
export function transcriptText(body: unknown): string | null {
  const b = obj(body);
  const segs = arr(b?.transcript_with_timestamp)
    .map((x) => str(obj(x)?.text)?.trim())
    .filter((x): x is string => !!x);
  let text = segs.join(" ");
  if (!text) {
    const vtt = str(b?.transcript) ?? "";
    text = vtt
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l !== "WEBVTT" && !/-->/.test(l) && !/^\d+$/.test(l))
      .join(" ");
  }
  text = text.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 3_000) : null;
}

/** Transcrite si elle dure au plus 2 minutes (au-delà, l'IA coûte 10 crédits la minute). */
export const TRANSCRIPT_MAX_SEC = 120;
