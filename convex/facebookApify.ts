/**
 * RELEVÉ FACEBOOK — via l'actor OFFICIEL `apify/facebook-posts-scraper`.
 *
 * Module sans import `_generated` : la lecture (clé de rapprochement, parsing)
 * est pure et testée depuis `lib/`, l'appel réseau n'est fait que depuis une
 * action (convex/nightlyViewsSync, convex/apifySync).
 *
 * ── Pourquoi Apify, et pas la page publique comme TikTok ou Snapchat ─────────
 * Une page Facebook lue anonymement répond HTTP 400 (mur de connexion, relevé le
 * 2026-09-25). Il n'y a pas de lecture gratuite : chaque post relevé coûte
 * 0,005 $ (tarif « post » de l'actor, palier gratuit d'Apify, 25/09). D'où le
 * PLAFOND par nuit (cf `planFacebookBudget`) et, par run, `maxTotalChargeUsd` :
 * même un actor qui rendrait plus de posts que demandé ne peut pas dépasser la
 * somme fixée ici.
 *
 * ── La forme de la sortie (schéma du dataset de l'actor, build du 25/09) ─────
 *   { url, postId, inputUrl, viewsCount, videoPostViewCount, likes, comments,
 *     shares, text, timestamp, time, isVideo, user: { name, profileUrl } }
 *  - `viewsCount` = « le nombre de vues affiché par Facebook » : c'est lui qu'on
 *    retient. `videoPostViewCount` (vues de 3 s) ne sert que de repli.
 *  - `likes` = TOTAL des réactions (j'aime, j'adore, haha…).
 *  - `postId` ≠ l'identifiant du Reel dans son URL (`/reel/895509256298494/`
 *    porte le postId 1441693187314472) : on ne rapproche JAMAIS par postId.
 *  - `inputUrl` = l'URL qu'on a envoyée : c'est la clé de rapprochement ;
 *    l'identifiant de vidéo de `url` sert de repli.
 *
 * ⚠️ NON VÉRIFIÉ au 2026-09-25 (aucun run réel) :
 *  - que les liens de PARTAGE (`/share/r/…`) et `fb.watch/…` soient rendus ;
 *  - les Reels de PROFILS PERSONNELS : la description de l'entrée dit « pages
 *    publiques uniquement », le README « pages et profils ». Un post non rendu
 *    est inscrit en échec avec son motif, jamais laissé à « 0 vue ».
 */

const APIFY_ACTS_BASE = "https://api.apify.com/v2/acts";
const DEFAULT_FACEBOOK_ACTOR = "apify~facebook-posts-scraper";

/** Posts par run : même borne que TikTok/Instagram (coût ET durée du run). */
export const FACEBOOK_URLS_PER_RUN = 25;

const RUN_TIMEOUT_SECS = 180;

/**
 * Prix maximal retenu par post pour borner un run (le tarif est 0,005 $ au
 * palier gratuit ; la marge couvre le démarrage facturé du run).
 */
const MAX_CHARGE_PER_POST_USD = 0.008;

/**
 * Posts Facebook relevés au plus par NUIT, tous projets confondus. Réglable par
 * `APIFY_FACEBOOK_NIGHTLY_BUDGET` sans redéploiement. 40 × 0,005 $ = 0,20 $ la
 * nuit au pire, ~6 $ par mois.
 */
export const DEFAULT_FACEBOOK_NIGHTLY_BUDGET = 40;

export function facebookNightlyBudget(raw: string | undefined): number {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_FACEBOOK_NIGHTLY_BUDGET;
}

const TITLE_MAX = 500;

function parse(url: string): URL | null {
  const raw = url.trim();
  if (raw === "") return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

function isFacebookHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "facebook.com" ||
    h.endsWith(".facebook.com") ||
    h === "fb.com" ||
    h.endsWith(".fb.com") ||
    h === "fb.watch" ||
    h.endsWith(".fb.watch")
  );
}

/**
 * CLÉ DE RAPPROCHEMENT d'une URL de post Facebook : hôte canonique + chemin sans
 * barre finale, en minuscules, et `?v=` quand c'est lui qui désigne la vidéo
 * (`/watch/?v=…`). Les paramètres de partage (`mibextid`, `rdid`…) sont
 * ignorés : `m.facebook.com/reel/1/?mibextid=x` et `www.facebook.com/reel/1`
 * désignent le même post. `null` hors de Facebook.
 */
export function facebookMatchKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = parse(url);
  if (!u || !isFacebookHost(u.hostname)) return null;
  const host = u.hostname.toLowerCase().endsWith("fb.watch") ? "fb.watch" : "facebook.com";
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();
  if (path === "" || path === "/") return null;
  const v = u.searchParams.get("v");
  return v && /^(\/watch|\/video\.php)$/.test(path) ? `${host}${path}?v=${v}` : `${host}${path}`;
}

/** Identifiant NUMÉRIQUE de la vidéo dans une URL (`/reel/…`, `/videos/…`, `?v=`). */
export function facebookVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = parse(url);
  if (!u || !isFacebookHost(u.hostname)) return null;
  const m = u.pathname.match(/\/(?:reel|reels|videos)\/(\d{6,})/);
  if (m) return m[1];
  const v = u.searchParams.get("v");
  return v && /^\d{6,}$/.test(v) ? v : null;
}

/** Un négatif est un code d'absence, pas un compteur (même règle que `toCount`). */
function count(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

export type FacebookPostStat = {
  views: number;
  /** Total des réactions. */
  likes: number | null;
  comments: number | null;
  shares: number | null;
  title: string | null;
  /** Instant de publication servi par Facebook, ms. */
  publishedAt: number | null;
};

/**
 * Rapproche les items rendus par l'actor des clés demandées. Un item sans
 * compteur de vues (photo, texte) n'est PAS retenu : Facebook n'en affiche pas,
 * et en inscrire 0 peindrait une vidéo à zéro vue.
 */
export function parseFacebookPosts(
  items: unknown,
  requested: readonly { key: string; url: string }[],
): { stats: Record<string, FacebookPostStat>; unavailable: string[] } {
  const parKle = new Map(requested.map((r) => [r.key, r]));
  const parVideo = new Map<string, string>();
  for (const r of requested) {
    const id = facebookVideoId(r.url);
    if (id) parVideo.set(id, r.key);
  }

  const stats: Record<string, FacebookPostStat> = {};
  for (const raw of Array.isArray(items) ? items : []) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const parEntree = facebookMatchKey(typeof item.inputUrl === "string" ? item.inputUrl : null);
    const idVideo = facebookVideoId(typeof item.url === "string" ? item.url : null);
    const key =
      (parEntree !== null && parKle.has(parEntree) ? parEntree : null) ??
      (idVideo !== null ? (parVideo.get(idVideo) ?? null) : null);
    if (key === null || key in stats) continue;

    const views = count(item.viewsCount) ?? count(item.videoPostViewCount);
    if (views === null) continue;
    const text = typeof item.text === "string" ? item.text.trim() : "";
    const ts = count(item.timestamp);
    stats[key] = {
      views,
      likes: count(item.likes),
      comments: count(item.comments),
      shares: count(item.shares),
      title: text === "" ? null : text.slice(0, TITLE_MAX),
      publishedAt: ts === null ? null : ts * 1000,
    };
  }
  return {
    stats,
    unavailable: requested.map((r) => r.key).filter((k) => !(k in stats)),
  };
}

export type FacebookFetchResult = {
  stats: Record<string, FacebookPostStat>;
  unavailable: string[];
  errors: { status: number | "network"; message: string; batchSize: number }[];
  /** Runs lancés — l'unité de démarrage facturée. */
  runs: number;
};

async function readApiError(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    const msg = (body as { error?: { message?: unknown } })?.error?.message;
    if (typeof msg === "string" && msg !== "") return msg.slice(0, 200);
  } catch {
    // corps non JSON : le statut suffit
  }
  return `HTTP ${res.status}`;
}

/**
 * Relève une liste de posts Facebook, par lots de `FACEBOOK_URLS_PER_RUN`. Un
 * lot en erreur est consigné et n'arrête pas les suivants. Ne lève JAMAIS.
 */
export async function fetchFacebookViews(
  targets: readonly { key: string; url: string }[],
  apiToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FacebookFetchResult> {
  const out: FacebookFetchResult = { stats: {}, unavailable: [], errors: [], runs: 0 };
  // Une URL par clé : deux publications peuvent désigner le même post.
  const uniques = [...new Map(targets.map((t) => [t.key, t])).values()];
  const actor = process.env.APIFY_FACEBOOK_ACTOR || DEFAULT_FACEBOOK_ACTOR;

  for (let i = 0; i < uniques.length; i += FACEBOOK_URLS_PER_RUN) {
    const lot = uniques.slice(i, i + FACEBOOK_URLS_PER_RUN);
    // Borne de COÛT du run : Apify arrête l'actor quand la somme est atteinte.
    const plafond = (lot.length * MAX_CHARGE_PER_POST_USD).toFixed(3);
    const endpoint =
      `${APIFY_ACTS_BASE}/${actor}/run-sync-get-dataset-items` +
      `?timeout=${RUN_TIMEOUT_SECS}&maxItems=${lot.length}&maxTotalChargeUsd=${plafond}`;
    out.runs += 1;
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          startUrls: lot.map((t) => ({ url: t.url })),
          // Ignoré pour une URL de post ; borne le cas d'une URL de page.
          resultsLimit: 1,
          captionText: false,
        }),
      });
      if (!res.ok) {
        out.errors.push({ status: res.status, message: await readApiError(res), batchSize: lot.length });
        out.unavailable.push(...lot.map((t) => t.key));
        continue;
      }
      const parsed = parseFacebookPosts(await res.json(), lot);
      Object.assign(out.stats, parsed.stats);
      out.unavailable.push(...parsed.unavailable);
    } catch (e) {
      out.errors.push({
        status: "network",
        message: e instanceof Error ? e.message : String(e),
        batchSize: lot.length,
      });
      out.unavailable.push(...lot.map((t) => t.key));
    }
  }
  return out;
}

/**
 * PLAFOND DE LA NUIT — quels posts relever, lesquels reporter. Pur, testé.
 *
 * Les MOINS récemment mesurés d'abord (jamais mesurés en tête) : sous le
 * plafond, la collecte tourne sur tout le catalogue au lieu de relever toujours
 * les mêmes. À égalité, les plus récemment publiés, qui bougent le plus.
 */
export function planFacebookBudget<
  T extends { lastSyncAt?: number; datePubli: number },
>(due: readonly T[], budget: number): { retenus: T[]; reportes: T[] } {
  const ordre = [...due].sort(
    (a, b) =>
      (a.lastSyncAt ?? -1) - (b.lastSyncAt ?? -1) || b.datePubli - a.datePubli,
  );
  const n = Math.max(0, budget);
  return { retenus: ordre.slice(0, n), reportes: ordre.slice(n) };
}
