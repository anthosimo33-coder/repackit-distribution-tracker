/**
 * RELEVÉ SNAPCHAT — lecture des compteurs d'un Spotlight dans le payload PUBLIC
 * de sa page, et des abonnés d'un compte dans celui de son profil. Gratuit, sans
 * connexion, sans Apify. Même principe que `convex/tiktokPublicPage.ts`.
 *
 * ── Ce qui est mesurable, et ce qui ne l'est pas ────────────────────────────
 * Seuls les SPOTLIGHT portent des compteurs publics. Les Stories n'en ont pas
 * (leurs vues ne sont visibles que de leur autrice) : arbitrage du 2026-09-25,
 * on ne suit que les Spotlight.
 *
 * ── La forme du payload, relevée le 2026-09-25 ───────────────────────────────
 * Page `snapchat.com/spotlight/<id>` (ou `/@user/spotlight/<id>`) :
 *   <script id="__NEXT_DATA__" type="application/json">{ props: { pageProps: {
 *     videoMetadata: { viewCount: "339002", uploadDateMs: "1789420663702",
 *                      creator: { personCreator: { username } } },
 *     spotlightFeed: { spotlightStories: [ {
 *       story: { storyId: { value: <id> }, snapList: [{ snapId: { value: <id> } }] },
 *       metadata: {
 *         videoMetadata: { uploadDateMs, creator: { personCreator: { username } } },
 *         engagementStats: { viewCount, boostCount, commentCount,
 *                            shareCount, recommendCount } } }, … ] } } } }</script>
 *
 * `boostCount` EST le nombre de likes : c'est lui que la page affiche sous le
 * cœur (47k pour 46 735). Les compteurs sont des CHAÎNES — d'où `toCount`.
 * `videoMetadata.shareCount` vaut « 0 » quand `engagementStats.shareCount` en
 * porte 799 : on lit `engagementStats`, qui est ce que la page affiche.
 *
 * ⚠️ La page porte AUSSI d'autres Spotlight (le fil qui suit, les « rerank »).
 * On retrouve le NÔTRE par son identifiant, jamais « le premier venu ».
 *
 * Un Spotlight supprimé rend un HTTP 404 : c'est une RÉPONSE de Snapchat, pas un
 * blocage — il ne doit pas faire sauter le coupe-circuit.
 *
 * ── Nouvelle forme, relevée le 2026-11-09 (en service depuis le 02/11) ──────
 * Snapchat est passé à l'App Router de Next : plus de `__NEXT_DATA__` sur les
 * pages Spotlight (le profil, lui, le garde). Les données sont dans le flux RSC,
 * des morceaux de chaîne à RECOLLER avant de lire — un morceau peut couper un
 * objet en deux :
 *   <script>self.__next_f.push([1,"…"])</script>  (×18 environ)
 * Le flux recollé porte le composant principal
 *   {"username":"thekellychapter","videoId":<id>,"video":{"id":<id>,
 *    "rawSnapId":<id>,"postingUsername":"thekellychapter",
 *    "uploadTimestampMs":"1793553807572","viewCount":12467,"likeCount":275,
 *    "commentCount":0,"recommendCount":23,"shareCount":24}, …}
 * puis le fil « à suivre », dont les `"video":{…}` d'AUTRES autrices (id
 * « 35::… », rawSnapId distinct). Compteurs en NOMBRES ; `likeCount` est le
 * cœur (l'ancien `boostCount`). Du 02 au 09/11, chaque nuit est tombée sur
 * « payload __NEXT_DATA__ absent » : 5 pages, coupe-circuit, plus rien.
 *
 * Deux réponses de Snapchat qui ne sont PAS des vues, vues sur les posts de
 * Kelly le 09/11 :
 * - `viewCount: 0` sur des Spotlight aimés ~20 fois : Snapchat masque les vues
 *   sous 1 000 (cf `SNAPCHAT_VIEWS_MASKED_BELOW`). Un zéro écrit serait faux
 *   (et payé zéro) ; on rend `hidden` avec `viewsBelow`, l'écran dit « < 1 000 ».
 * - la page servie SANS la vidéo (composant principal sans `video`, og:title
 *   « Snapchat ») : Spotlight retiré ou pas encore public. `hidden` aussi.
 * Ni l'une ni l'autre n'alimente le coupe-circuit : la page a été servie.
 */

import { toCount } from "./apifyItem";
import {
  isSnapchatHost,
  parseSnapchatUrl as parse,
  snapchatSpotlightId,
} from "./snapchatPostUrl";

// Lecture de l'URL : module à part, importable côté client sans le scraper.
export { isSnapchatShortlink, snapchatSpotlightId } from "./snapchatPostUrl";

export type SnapchatSpotlightStats = {
  views: number;
  /** `boostCount` — les likes (le cœur). */
  likes: number | null;
  comments: number | null;
  shares: number | null;
  /** Instant de publication servi par Snapchat, ms. */
  uploadedAt: number | null;
  /** `username` de l'autrice, pour le journal. */
  creatorHandle: string | null;
};

export type SnapchatPageResult =
  | { kind: "stats"; stats: SnapchatSpotlightStats }
  /**
   * Snapchat répond que le Spotlight n'existe pas (404) : supprimé, ou retiré
   * de Spotlight par son autrice. Un fait à AFFICHER, pas un aléa à réessayer.
   */
  | { kind: "gone"; reason: string }
  /**
   * Page servie normalement, mais Snapchat n'y montre pas les vues de CE
   * Spotlight (compteur à 0, ou vidéo absente de sa propre page). Un échec
   * motivé, pas un blocage : il ne fait pas avancer le coupe-circuit.
   */
  | {
      kind: "hidden";
      reason: string;
      /**
       * Compteur masqué : ce qu'on sait quand même, « moins de N vues »
       * (`SNAPCHAT_VIEWS_MASKED_BELOW`). Absent quand la vidéo manque à sa page :
       * là, on ne sait rien de ses vues.
       */
      viewsBelow?: number;
    }
  /** Page illisible (blocage, réseau, payload absent ou cassé). */
  | { kind: "unreadable"; reason: string };

/**
 * Sous ce nombre de vues, Snapchat MASQUE le compteur d'un Spotlight : 0 sur sa
 * page, -1 dans la liste du profil (`spotlightStoryMetadata`). Constaté le
 * 09/11/2026 : sur les 33 posts Snapchat de la prod, le plus petit relevé est
 * 1 036, et aucune des 224 vidéos des pages lues ne montre un compteur entre 1
 * et 999. Un post masqué a donc moins de 1 000 vues — c'est tout ce qu'on sait.
 */
export const SNAPCHAT_VIEWS_MASKED_BELOW = 1000;

const NEXT_DATA_RE =
  /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `{ value: "…" }` → "…" (les identifiants Snapchat sont emballés). */
function wrapped(value: unknown): string | null {
  const v = asRecord(value).value;
  return typeof v === "string" && v !== "" ? v : null;
}

function usernameOf(videoMetadata: Record<string, unknown>): string | null {
  const u = asRecord(asRecord(videoMetadata.creator).personCreator).username;
  return typeof u === "string" && u !== "" ? u : null;
}

/** Les identifiants que porte une entrée du fil (story + chaque snap). */
function idsOf(entry: Record<string, unknown>): string[] {
  const story = asRecord(entry.story);
  const ids = [wrapped(story.storyId)];
  for (const snap of asArray(story.snapList)) {
    ids.push(wrapped(asRecord(snap).snapId));
  }
  return ids.filter((x): x is string => x !== null);
}

function pagePropsOf(html: string): Record<string, unknown> | string {
  const m = NEXT_DATA_RE.exec(html);
  if (!m) return "payload __NEXT_DATA__ absent";
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return "payload JSON illisible";
  }
  const pp = asRecord(asRecord(asRecord(data).props).pageProps);
  return Object.keys(pp).length === 0 ? "pageProps absent" : pp;
}

/** Un morceau du flux RSC : `self.__next_f.push([1,"…"])`. */
const FLIGHT_PUSH_RE = /self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g;

/**
 * Le flux RSC recollé, ou null si la page n'en porte pas. Seuls les morceaux
 * `[1, chaîne]` sont des données (`[0]` ouvre le flux, `[2,…]` le formulaire).
 */
function flightOf(html: string): string | null {
  let flight = "";
  let found = false;
  for (const m of html.matchAll(FLIGHT_PUSH_RE)) {
    let push: unknown;
    try {
      push = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (Array.isArray(push) && push[0] === 1 && typeof push[1] === "string") {
      flight += push[1];
      found = true;
    }
  }
  return found ? flight : null;
}

/**
 * L'objet JSON qui s'ouvre à `start` (une `{`), lu jusqu'à son accolade
 * fermante — les accolades DANS les chaînes (légendes, URL) ne comptent pas.
 */
function objectAt(text: string, start: number): Record<string, unknown> | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return asRecord(JSON.parse(text.slice(start, i + 1)));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Tous les `"video":{…}` du flux : la vidéo principale ET celles du fil. */
function flightVideos(flight: string): Record<string, unknown>[] {
  const videos: Record<string, unknown>[] = [];
  for (const m of flight.matchAll(/"video":\{/g)) {
    const v = objectAt(flight, m.index + m[0].length - 1);
    if (v !== null) videos.push(v);
  }
  return videos;
}

/** Compteurs du Spotlight `snapId` dans le flux RSC (forme du 2026-11-09). */
function parseSpotlightFlight(
  flight: string,
  snapId: string | null,
): SnapchatPageResult {
  // Lien court sans id : la vidéo que la page annonce comme la sienne.
  const id = snapId ?? /"videoId":"([^"]+)"/.exec(flight)?.[1] ?? null;
  if (id === null) {
    return { kind: "unreadable", reason: "Spotlight principal introuvable dans le flux" };
  }
  const video = flightVideos(flight).find((v) => v.id === id || v.rawSnapId === id);
  if (video === undefined) {
    // Garde-fou dur : plutôt rien que les compteurs d'un autre Spotlight.
    return flight.includes(`"videoId":${JSON.stringify(id)}`)
      ? {
          kind: "hidden",
          reason: "Snapchat sert la page sans la vidéo (Spotlight retiré ou pas encore public)",
        }
      : { kind: "unreadable", reason: `Spotlight ${id.slice(0, 12)}… absent de sa propre page` };
  }
  const views = toCount(video.viewCount);
  if (views === null) {
    return { kind: "unreadable", reason: "viewCount absent ou illisible" };
  }
  const likes = toCount(video.likeCount);
  if (views === 0) {
    return {
      kind: "hidden",
      reason:
        likes !== null && likes > 0
          ? `Snapchat masque les vues de ce Spotlight (0 affiché pour ${likes} j'aime)`
          : "Snapchat masque les vues de ce Spotlight (0 affiché)",
      viewsBelow: SNAPCHAT_VIEWS_MASKED_BELOW,
    };
  }
  const handle = video.postingUsername;
  return {
    kind: "stats",
    stats: {
      views,
      likes,
      comments: toCount(video.commentCount),
      shares: toCount(video.shareCount),
      uploadedAt: toCount(video.uploadTimestampMs),
      creatorHandle: typeof handle === "string" && handle !== "" ? handle : null,
    },
  };
}

/**
 * Lit les compteurs du Spotlight `snapId` dans le HTML de sa page — forme
 * `__NEXT_DATA__` (jusqu'au 02/11/2026) ou flux RSC (depuis), selon ce que la
 * page porte.
 *
 * `snapId` null = lien court dont la redirection n'a pas livré l'identifiant :
 * on lit alors la vidéo PRINCIPALE de la page (`pageProps.videoMetadata`), et on
 * ne lui rattache une entrée du fil que si sa date de publication ET son autrice
 * coïncident — jamais sur la seule position.
 */
export function parseSnapchatSpotlightPage(
  html: string,
  snapId: string | null,
): SnapchatPageResult {
  if (!NEXT_DATA_RE.test(html)) {
    const flight = flightOf(html);
    return flight !== null
      ? parseSpotlightFlight(flight, snapId)
      : { kind: "unreadable", reason: "payload absent (ni __NEXT_DATA__ ni flux __next_f)" };
  }
  const pp = pagePropsOf(html);
  if (typeof pp === "string") return { kind: "unreadable", reason: pp };

  const principale = asRecord(pp.videoMetadata);
  const fil = [
    ...asArray(asRecord(pp.spotlightFeed).spotlightStories),
  ].map(asRecord);

  let entree: Record<string, unknown> | undefined;
  if (snapId !== null) {
    entree = fil.find((e) => idsOf(e).includes(snapId));
    if (entree === undefined) {
      // Garde-fou dur : plutôt rien que les compteurs d'un autre Spotlight.
      return {
        kind: "unreadable",
        reason: `Spotlight ${snapId.slice(0, 12)}… absent de sa propre page`,
      };
    }
  } else {
    const date = principale.uploadDateMs;
    const auteur = usernameOf(principale);
    entree = fil.find((e) => {
      const vm = asRecord(asRecord(e.metadata).videoMetadata);
      return date !== undefined && vm.uploadDateMs === date && usernameOf(vm) === auteur;
    });
  }

  const meta = asRecord(entree?.metadata);
  const stats = asRecord(meta.engagementStats);
  const vm = entree ? asRecord(meta.videoMetadata) : principale;
  const views =
    toCount(stats.viewCount) ?? toCount(vm.viewCount) ?? toCount(principale.viewCount);
  if (views === null) {
    return { kind: "unreadable", reason: "viewCount absent ou illisible" };
  }
  return {
    kind: "stats",
    stats: {
      views,
      likes: toCount(stats.boostCount),
      comments: toCount(stats.commentCount),
      shares: toCount(stats.shareCount),
      uploadedAt: toCount(vm.uploadDateMs),
      creatorHandle: usernameOf(vm) ?? usernameOf(principale),
    },
  };
}

/** Compteurs publics d'un compte Snapchat. */
export type SnapchatProfile = {
  subscribers: number | null;
  avatarUrl: string | null;
};

export type SnapchatProfileResult =
  | { kind: "profile"; profile: SnapchatProfile }
  | { kind: "gone"; reason: string }
  | { kind: "unreadable"; reason: string };

/**
 * Abonnés et photo d'un profil PUBLIC (`userProfile.publicProfileInfo`). Un
 * compte privé n'a pas cette section : on rend des compteurs `null` — absent
 * n'est pas zéro.
 */
export function parseSnapchatProfilePage(html: string): SnapchatProfileResult {
  const pp = pagePropsOf(html);
  if (typeof pp === "string") return { kind: "unreadable", reason: pp };
  const info = asRecord(asRecord(pp.userProfile).publicProfileInfo);
  const photo = info.profilePictureUrl;
  return {
    kind: "profile",
    profile: {
      subscribers: toCount(info.subscriberCount),
      avatarUrl:
        typeof photo === "string" && photo.startsWith("https://") ? photo : null,
    },
  };
}

/**
 * Adresse publique du profil d'un compte Snapchat : son URL si elle en désigne
 * un (`/add/<user>`, `/@user`), sinon reconstruite depuis le handle. `null` si
 * ni l'une ni l'autre ne donne un nom de compte.
 */
export function snapchatProfileUrl(
  handle: string,
  url?: string | null,
): string | null {
  const nomValide = (n: string) => /^[A-Za-z0-9._-]+$/.test(n);
  const u = url ? parse(url) : null;
  if (u && isSnapchatHost(u.hostname)) {
    const seg = u.pathname.split("/").filter(Boolean);
    const nom =
      seg[0]?.toLowerCase() === "add" ? seg[1] : seg[0]?.startsWith("@") ? seg[0].slice(1) : undefined;
    if (nom && nomValide(nom)) return `https://www.snapchat.com/add/${nom}`;
  }
  const nom = handle.trim().replace(/^@+/, "");
  return nomValide(nom) ? `https://www.snapchat.com/add/${nom}` : null;
}

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml",
};

export const PAGE_TIMEOUT_MS = 20_000;

/**
 * Va chercher une page Snapchat. Ne lève JAMAIS : un 404 est `gone`, tout autre
 * échec est `unreadable` avec son motif. Rend aussi l'URL FINALE (après
 * redirection), qui porte l'identifiant d'un lien court.
 */
async function fetchPage(
  url: string,
  fetchImpl: typeof fetch,
): Promise<
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; result: { kind: "gone" | "unreadable"; reason: string } }
> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
  } catch (e) {
    return {
      ok: false,
      result: { kind: "unreadable", reason: `réseau : ${String(e).slice(0, 120)}` },
    };
  }
  if (res.status === 404) {
    return {
      ok: false,
      result: { kind: "gone", reason: "introuvable sur Snapchat (supprimé ou retiré de Spotlight)" },
    };
  }
  if (!res.ok) {
    return { ok: false, result: { kind: "unreadable", reason: `HTTP ${res.status}` } };
  }
  try {
    return { ok: true, html: await res.text(), finalUrl: res.url || url };
  } catch (e) {
    return {
      ok: false,
      result: { kind: "unreadable", reason: `corps illisible : ${String(e).slice(0, 80)}` },
    };
  }
}

/**
 * Compteurs d'un Spotlight depuis sa page. `snapId` null = lien court : on suit
 * la redirection, et l'identifiant est relu dans l'URL finale.
 *
 * Seuls les liens snapchat.com sont demandés : la publication a été validée sur
 * son hôte à la saisie (cf `convex/postUrlShape.ts`), et on le revérifie ici —
 * une URL de publication ne doit jamais faire appeler un autre hôte.
 */
export async function fetchSnapchatSpotlightStats(
  postUrl: string,
  snapId: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<SnapchatPageResult> {
  const u = parse(postUrl);
  if (!u || !isSnapchatHost(u.hostname)) {
    return { kind: "unreadable", reason: "lien hors de snapchat.com" };
  }
  // Paramètres de partage (`?share_id=…&locale=…`) retirés, sauf pour un lien
  // court qu'on doit suivre tel quel.
  const cible = snapId === null ? u.toString() : `${u.origin}${u.pathname}`;
  const page = await fetchPage(cible, fetchImpl);
  if (!page.ok) return page.result;
  const id = snapId ?? snapchatSpotlightId(page.finalUrl);
  return parseSnapchatSpotlightPage(page.html, id);
}

/** Abonnés d'un compte depuis son profil public. */
export async function fetchSnapchatProfile(
  profileUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SnapchatProfileResult> {
  const u = parse(profileUrl);
  if (!u || !isSnapchatHost(u.hostname)) {
    return { kind: "unreadable", reason: "lien hors de snapchat.com" };
  }
  const page = await fetchPage(`${u.origin}${u.pathname}`, fetchImpl);
  if (!page.ok) {
    return page.result.kind === "gone"
      ? { kind: "gone", reason: "profil introuvable sur Snapchat" }
      : page.result;
  }
  return parseSnapchatProfilePage(page.html);
}
