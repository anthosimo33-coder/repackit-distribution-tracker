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
  /** Page illisible (blocage, réseau, payload absent ou cassé). */
  | { kind: "unreadable"; reason: string };

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

/**
 * Lit les compteurs du Spotlight `snapId` dans le HTML de sa page.
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
