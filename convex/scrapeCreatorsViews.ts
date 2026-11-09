/**
 * RELEVÉS DE VUES par ScrapeCreators — Instagram, Facebook et le secours TikTok.
 *
 * Remplace Apify le 09/11/2026 : le compte Apify gratuit (5 $/mois) a tenu trois
 * jours (05 → 07/11, 5,06 $), puis la nuit du 08/11 a rendu 346 posts Instagram
 * et 5 Facebook en 403, jusqu'au 26/11. Apify facture chaque post rendu ;
 * ScrapeCreators facture la REQUÊTE (1 crédit, 47 $ les 25 000).
 *
 * INSTAGRAM PAR COMPTE. `/v1/instagram/user/reels` rend 12 reels d'un compte,
 * avec leurs vues, pour 1 crédit : on lit les reels du @ de la publication et on
 * rapproche par shortcode (unique au monde, donc aucun risque de prendre le
 * reel d'un autre). Mesuré la nuit du 08/11 : 346 posts sur 22 comptes, 59
 * pages au lieu de 346 requêtes. On descend page à page jusqu'à avoir tout
 * trouvé, et on s'arrête dès que la page passe sous la date du plus vieux post
 * cherché (la date se lit dans le shortcode). Ce qui n'est pas retrouvé (reel
 * épinglé, absent de cette liste ; lien d'un autre compte ; @ mal saisi) est lu
 * par son lien, `/v1/instagram/post` (1 crédit) — c'est aussi ce qui rend
 * l'auteur d'un lien étranger à la garde de propriété (cf convex/postOwner.ts).
 *
 * Facebook et TikTok : par lien, 1 crédit par post (`/v1/facebook/post`,
 * `/v2/tiktok/video`). Formes relevées sur de vrais posts le 09/11/2026.
 *
 * CLÉ : `SCRAPECREATORS_RELEVES_API_KEY` si posée, sinon celle du Radar
 * (`SCRAPECREATORS_API_KEY`). Une clé à part met la paie à l'abri du Radar : le
 * 23/10, le Radar partageait le jeton Apify des relevés et l'a vidé. Elle part
 * en en-tête `x-api-key`, jamais dans une URL, un motif ou un journal.
 *
 * CRÉDIT ÉPUISÉ (HTTP 402) : plus aucun appel dans ce passage — chaque requête
 * suivante échouerait de même — et le motif le dit.
 *
 * Ne lève JAMAIS : une erreur est rendue dans `errors`, le post dans
 * `unavailable`.
 */
import { tiktokPostId, type ApifyPostStat } from "./apifyApi";
import type { FacebookFetchResult, FacebookPostStat } from "./facebookApify";
import { normalizeHandle } from "./postOwner";

const BASE = "https://api.scrapecreators.com";
const TIMEOUT_MS = 60_000;
const TITLE_MAX = 500;

/**
 * Pages de reels lues au plus par compte et par passage (12 reels chacune).
 * 15 pages = 180 reels : un compte à 2 reels par jour remonte 90 jours, toute
 * la fenêtre relevée (cf convex/syncScope.ts). Borne de coût, pas d'usage :
 * l'arrêt par date tombe bien avant.
 */
export const IG_REELS_MAX_PAGES = 15;

/** Marge sous la date du plus vieux post cherché avant d'arrêter de descendre. */
const IG_PAGE_DATE_MARGIN_MS = 6 * 3_600_000;

/** La clé des relevés — jamais imprimée. `undefined` = aucun relevé payant. */
export function releveScKey(): string | undefined {
  return (
    process.env.SCRAPECREATORS_RELEVES_API_KEY || process.env.SCRAPECREATORS_API_KEY || undefined
  );
}

export type ScError = { status: number | "network"; message: string; batchSize: number };

export type ScViewsResult = {
  /** clé de post (shortcode Instagram / id TikTok) → compteurs. */
  stats: Record<string, ApifyPostStat>;
  /** clés demandées et non rendues. */
  unavailable: string[];
  errors: ScError[];
  /** Requêtes envoyées — 1 crédit chacune : l'unité de coût. */
  calls: number;
};

/** Ce que l'écran dit d'un post non relevé à cause de ScrapeCreators. */
export function scFailureReason(e: { status: number | "network"; message: string }): string {
  if (e.status === 402) return "crédit ScrapeCreators épuisé";
  return `ScrapeCreators en erreur (${e.status}) — ${e.message}`.slice(0, 200);
}

// ─── Lecture des réponses (pur) ──────────────────────────────────────────────

function obj(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
}

function str(x: unknown): string | null {
  return typeof x === "string" && x.trim() !== "" ? x.trim() : null;
}

/** Un négatif est un code d'absence, pas un compteur (cf `toCount`, apifyApi). */
function count(x: unknown): number | null {
  const n = typeof x === "string" && x.trim() !== "" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

function idOf(x: unknown): string | null {
  if (typeof x === "number" && Number.isSafeInteger(x)) return String(x);
  return str(x);
}

/**
 * Légende bornée sans couper un emoji en deux : une moitié seule est refusée
 * par Convex et fait tomber toute l'écriture (vu le 07/11/2026, Radar).
 */
function caption(x: unknown): string | null {
  const t = str(x);
  if (t === null) return null;
  const chars = Array.from(t);
  return chars.length > TITLE_MAX ? chars.slice(0, TITLE_MAX).join("") : t;
}

const IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** Origine des identifiants Instagram (ms) : l'id porte l'instant sur ses bits hauts. */
const IG_EPOCH_MS = 1_314_220_021_721;

/**
 * L'instant de mise en ligne lu dans un shortcode Instagram (ms), ou `null`.
 * Le shortcode est l'id du média en base 64 ; l'id porte l'instant, en ms
 * depuis l'origine Instagram, au-dessus de ses 23 bits bas. Vérifié le
 * 09/11/2026 : DffxsW5KXEb → 22 s avant son `taken_at` (début de l'envoi).
 * Les shortcodes longs (comptes privés) ne se décodent pas ainsi : `null`.
 */
export function instagramShortcodeTime(code: string): number | null {
  if (!/^[A-Za-z0-9_-]{6,11}$/.test(code)) return null;
  let id = BigInt(0);
  for (const ch of code) id = id * BigInt(64) + BigInt(IG_ALPHABET.indexOf(ch));
  const ms = Number(id / BigInt(2 ** 23)) + IG_EPOCH_MS;
  // Plausible : après le lancement des reels, avant demain.
  return ms > Date.UTC(2016, 0, 1) && ms < Date.now() + 86_400_000 ? ms : null;
}

type IgItem = { key: string; publishedAt: number | null; stat: ApifyPostStat };

/** Un reel de `/v1/instagram/user/reels` (`items[i].media`), ou `null` sans vues. */
export function parseIgReelItem(raw: unknown): IgItem | null {
  const top = obj(raw);
  const m = obj(top?.media) ?? top;
  if (!m) return null;
  const key = str(m.code);
  const views = count(m.play_count) ?? count(m.ig_play_count);
  if (key === null || views === null) return null;
  const user = obj(m.user);
  const takenAt = count(m.taken_at);
  return {
    key,
    publishedAt: takenAt === null ? null : takenAt * 1000,
    stat: {
      views,
      likes: count(m.like_count),
      comments: count(m.comment_count),
      title: caption(obj(m.caption)?.text),
      // Instagram n'expose AUCUNE métrique de saves : null est définitif.
      saves: null,
      author: null,
      ownerUsername: str(user?.username),
      ownerId: idOf(user?.id) ?? idOf(user?.pk),
    },
  };
}

/**
 * Un post de `/v1/instagram/post` (`data.xdt_shortcode_media`), ou `null`. Une
 * photo n'a pas de vues : non retenue, comme chez Apify — l'inscrire à 0
 * peindrait le post à zéro vue.
 */
export function parseIgPost(body: unknown): IgItem | null {
  const m = obj(obj(obj(body)?.data)?.xdt_shortcode_media);
  if (!m) return null;
  const key = str(m.shortcode);
  const views = count(m.video_play_count) ?? count(m.video_view_count);
  if (key === null || views === null) return null;
  const owner = obj(m.owner);
  const edges = obj(m.edge_media_to_caption)?.edges;
  const firstCaption = Array.isArray(edges) ? obj(obj(edges[0])?.node)?.text : null;
  const takenAt = count(m.taken_at_timestamp);
  return {
    key,
    publishedAt: takenAt === null ? null : takenAt * 1000,
    stat: {
      views,
      likes: count(obj(m.edge_media_preview_like)?.count),
      comments:
        count(obj(m.edge_media_to_parent_comment)?.count) ??
        count(obj(m.edge_media_to_comment)?.count),
      title: caption(firstCaption),
      saves: null,
      author: null,
      ownerUsername: str(owner?.username),
      ownerId: idOf(owner?.id),
    },
  };
}

/** Une vidéo de `/v2/tiktok/video` (`aweme_detail`), ou `null`. */
export function parseTikTokVideo(body: unknown): { key: string; stat: ApifyPostStat } | null {
  const v = obj(obj(body)?.aweme_detail);
  if (!v) return null;
  const key = idOf(v.aweme_id);
  const s = obj(v.statistics) ?? {};
  const views = count(s.play_count);
  if (key === null || views === null) return null;
  const author = obj(v.author);
  return {
    key,
    stat: {
      views,
      likes: count(s.digg_count),
      comments: count(s.comment_count),
      title: caption(v.desc),
      saves: count(s.collect_count),
      author: null,
      ownerUsername: str(author?.unique_id),
      ownerId: idOf(author?.uid),
    },
  };
}

/**
 * Un post de `/v1/facebook/post`, ou `null` sans compteur de vues (photo,
 * texte). La doc prévient : le compteur d'un reel peut être arrondi.
 */
export function parseFacebookPost(body: unknown): FacebookPostStat | null {
  const b = obj(body);
  if (!b) return null;
  const views = count(b.view_count);
  if (views === null) return null;
  const created = typeof b.creation_time === "string" ? Date.parse(b.creation_time) : NaN;
  return {
    views,
    likes: count(b.like_count),
    comments: count(b.comment_count),
    shares: count(b.share_count),
    title: caption(b.description),
    publishedAt: Number.isFinite(created) ? created : null,
  };
}

// ─── Appels (I/O) ────────────────────────────────────────────────────────────

type ScReply = { ok: true; body: Record<string, unknown> } | { ok: false; error: ScError };

async function scGet(
  apiKey: string,
  path: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<ScReply> {
  const url = `${BASE}${path}?${new URLSearchParams(params).toString()}`;
  try {
    const res = await fetchImpl(url, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = (obj(JSON.parse(text)) ?? {}) as Record<string, unknown>;
    } catch {
      // Corps non JSON : le statut suffit.
    }
    if (!res.ok || body.success === false) {
      const msg = str(body.message) ?? str(body.error) ?? `HTTP ${res.status}`;
      return { ok: false, error: { status: res.status, message: msg.slice(0, 200), batchSize: 1 } };
    }
    return { ok: true, body };
  } catch (e) {
    return {
      ok: false,
      error: { status: "network", message: e instanceof Error ? e.message : String(e), batchSize: 1 },
    };
  }
}

/**
 * Vues Instagram : par compte d'abord, par lien pour le reste. Cf l'en-tête.
 * `compte` = le @ de la publication, tel qu'en base.
 */
export async function fetchInstagramViewsSc(
  targets: readonly { key: string; url: string; compte: string }[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ScViewsResult> {
  const out: ScViewsResult = { stats: {}, unavailable: [], errors: [], calls: 0 };
  const uniques = [...new Map(targets.map((t) => [t.key, t])).values()];
  let exhausted = false;
  const fail = (e: ScError) => {
    out.errors.push(e);
    if (e.status === 402) exhausted = true;
  };

  // Les clés à chercher, par @ (un @ illisible : lien direct).
  const byHandle = new Map<string, string[]>();
  for (const t of uniques) {
    const h = normalizeHandle(t.compte);
    if (h === null) continue;
    byHandle.set(h, [...(byHandle.get(h) ?? []), t.key]);
  }

  for (const [handle, keys] of byHandle) {
    if (exhausted) break;
    const wanted = new Set(keys);
    let maxId: string | undefined;
    for (let page = 0; page < IG_REELS_MAX_PAGES && wanted.size > 0; page += 1) {
      // Sans date lisible, la page ne sait pas quand s'arrêter : lien direct.
      const times = [...wanted].map(instagramShortcodeTime).filter((t): t is number => t !== null);
      if (times.length === 0) break;
      const oldest = Math.min(...times);
      const r = await scGet(
        apiKey,
        "/v1/instagram/user/reels",
        { handle, ...(maxId !== undefined ? { max_id: maxId } : {}) },
        fetchImpl,
      );
      out.calls += 1;
      if (!r.ok) {
        // Un @ introuvable ou une page en erreur : le lien direct prend le
        // relais ; seul le crédit épuisé est une erreur du passage.
        if (r.error.status === 402) fail(r.error);
        break;
      }
      const items = (Array.isArray(r.body.items) ? r.body.items : [])
        .map(parseIgReelItem)
        .filter((x): x is IgItem => x !== null);
      for (const it of items) {
        if (!wanted.has(it.key)) continue;
        out.stats[it.key] = it.stat;
        wanted.delete(it.key);
      }
      const paging = obj(r.body.paging_info);
      const next = str(paging?.max_id);
      if (paging?.more_available !== true || next === null) break;
      const dates = items.map((it) => it.publishedAt).filter((t): t is number => t !== null);
      if (dates.length > 0 && Math.min(...dates) < oldest - IG_PAGE_DATE_MARGIN_MS) break;
      maxId = next;
    }
  }

  for (const t of uniques) {
    if (exhausted) break;
    if (t.key in out.stats) continue;
    const r = await scGet(apiKey, "/v1/instagram/post", { url: t.url }, fetchImpl);
    out.calls += 1;
    if (!r.ok) {
      fail(r.error);
      continue;
    }
    const item = parseIgPost(r.body);
    if (item !== null && item.key === t.key) out.stats[t.key] = item.stat;
  }

  out.unavailable = uniques.map((t) => t.key).filter((k) => !(k in out.stats));
  return out;
}

/** Vues TikTok par lien (secours de la page publique) — 1 crédit par vidéo. */
export async function fetchTikTokViewsSc(
  postUrls: readonly string[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ScViewsResult> {
  const out: ScViewsResult = { stats: {}, unavailable: [], errors: [], calls: 0 };
  const urlByKey = new Map<string, string>();
  for (const url of postUrls) {
    const key = tiktokPostId(url);
    if (key !== null && !urlByKey.has(key)) urlByKey.set(key, url);
  }
  for (const [key, url] of urlByKey) {
    const r = await scGet(apiKey, "/v2/tiktok/video", { url, trim: "true" }, fetchImpl);
    out.calls += 1;
    if (!r.ok) {
      out.errors.push(r.error);
      if (r.error.status === 402) break;
      continue;
    }
    const v = parseTikTokVideo(r.body);
    if (v !== null && v.key === key) out.stats[key] = v.stat;
  }
  out.unavailable = [...urlByKey.keys()].filter((k) => !(k in out.stats));
  return out;
}

/**
 * Vues Facebook par lien — 1 crédit par post. Même forme de résultat que
 * l'ancien relevé Apify (`runs` = requêtes), pour que les appelants n'aient
 * qu'une source à changer.
 */
export async function fetchFacebookViewsSc(
  targets: readonly { key: string; url: string }[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FacebookFetchResult> {
  const out: FacebookFetchResult = { stats: {}, unavailable: [], errors: [], runs: 0 };
  const uniques = [...new Map(targets.map((t) => [t.key, t])).values()];
  for (const t of uniques) {
    const r = await scGet(apiKey, "/v1/facebook/post", { url: t.url }, fetchImpl);
    out.runs += 1;
    if (!r.ok) {
      out.errors.push(r.error);
      if (r.error.status === 402) break;
      continue;
    }
    const stat = parseFacebookPost(r.body);
    if (stat !== null) out.stats[t.key] = stat;
  }
  out.unavailable = uniques.map((t) => t.key).filter((k) => !(k in out.stats));
  return out;
}
