/**
 * NOUVEAU RADAR — APPS DES CLASSEMENTS : trouver seul des apps portées par des
 * comptes créateurs. Règles pures, serveur seul (les listes de mots ne sont pas
 * du texte d'écran) ; les appels réseau et les écritures sont dans
 * convex/radarStore.
 *
 * Pourquoi : le 12/11/2026, 48 des 51 apps suivies étaient entrées à la main, et
 * ce que le Radar repérait seul (les comptes et sites cités par les comptes
 * suivis) ne cherchait qu'AUTOUR d'elles. Le fondateur veut des centaines d'apps
 * de plus de niches.
 *
 * Comment :
 *  1. les classements publics de l'App Store (flux iTunes, 100 apps par liste)
 *     donnent des noms d'apps ;
 *  2. pour chaque app, on lit la page d'intégration publique de son hashtag
 *     TikTok (son nombre de vidéos et ses 10 vidéos les plus vues), puis celle
 *     du profil de leurs auteurs (bio, dernières légendes). Aucun crédit ;
 *  3. un auteur est un COMPTE CRÉATEUR de l'app quand son pseudo la porte comme
 *     un mot (« kate.drawly3 »), que sa bio la nomme avec un mot d'app (« Liven
 *     app ambassador »), ou que la moitié de ses vidéos la citent ;
 *  4. deux comptes créateurs ou plus : l'app est proposée à l'écran, où
 *     quelqu'un la suit ou l'ignore.
 *
 * Mesuré le 12/11/2026 sur 900 apps tirées au hasard des classements France et
 * États-Unis (5 770 apps), chaque app sortie relue à la main : la règle en
 * garde 69, dont 29 des 33 vrais réseaux trouvés (42 % de vrais ; 70 % à trois
 * comptes ou plus). Les faux positifs sont des homonymes (« Legit Check »,
 * « Shell », « Ford ») : d'où la relecture à l'écran, et le tri par nombre de
 * comptes. Sur les apps déjà suivies, lire les 10 vidéos les plus vues d'un
 * hashtag reconnaît 24 réseaux sur 38 : elle rate ceux portés par de gros
 * influenceurs payés une fois (Love8, Knowunity).
 */

// ─── Les classements ─────────────────────────────────────────────────────────

/** Pays lus. France et États-Unis : les deux mesurés le 12/11/2026 (16 099 apps avec sept pays de plus, non mesurés). */
export const STORE_COUNTRIES = ["fr", "us"] as const;
export const STORE_LISTS = ["topfreeapplications", "topgrossingapplications"] as const;
/** « » = tous genres ; puis les genres de l'App Store hors jeux (éducation, style de vie, réseaux sociaux, santé…). */
export const STORE_GENRES = ["", "6017", "6012", "6005", "6013", "6007", "6008", "6006", "6002", "6016", "6015", "6023", "6011", "6024", "6003", "6018", "6020", "6000", "6010", "6009", "6004", "6027"] as const;

export type StoreFeed = { country: string; list: string; genre: string };

export const STORE_FEEDS: readonly StoreFeed[] = STORE_COUNTRIES.flatMap((country) => STORE_LISTS.flatMap((list) => STORE_GENRES.map((genre) => ({ country, list, genre }))));

export function storeFeedUrl(f: StoreFeed): string {
  return `https://itunes.apple.com/${f.country}/rss/${f.list}/limit=200/${f.genre ? `genre=${f.genre}/` : ""}json`;
}

/** Listes lues par passage : les 88 listes sont relues en un peu moins d'un jour (un passage toutes les 3 heures). */
export const STORE_FEEDS_PER_RUN = 12;

/** Les listes d'un passage, à partir du curseur, en boucle. */
export function feedsForRun(cursor: number, perRun: number = STORE_FEEDS_PER_RUN, feeds: readonly StoreFeed[] = STORE_FEEDS): { feeds: StoreFeed[]; next: number } {
  const n = Math.min(Math.max(0, perRun), feeds.length);
  const start = ((cursor % feeds.length) + feeds.length) % feeds.length;
  const out: StoreFeed[] = [];
  for (let i = 0; i < n; i++) out.push(feeds[(start + i) % feeds.length]);
  return { feeds: out, next: (start + n) % feeds.length };
}

export type StoreEntry = { storeId: string; name: string; artist: string; genre: string; released: string };

const obj = (x: unknown): Record<string, unknown> | undefined => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined);
const str = (x: unknown): string => (typeof x === "string" ? x : "");
const label = (x: unknown): string => str(obj(x)?.label);

/** Les apps d'une liste (la réponse du flux iTunes). Une liste d'une seule app arrive sans tableau. */
export function parseStoreFeed(raw: unknown): StoreEntry[] {
  const entry = obj(obj(raw)?.feed)?.entry;
  const list = Array.isArray(entry) ? entry : entry ? [entry] : [];
  const out: StoreEntry[] = [];
  for (const e of list) {
    const o = obj(e);
    const storeId = str(obj(obj(o?.id)?.attributes)?.["im:id"]);
    const name = label(o?.["im:name"]).trim();
    if (!/^\d+$/.test(storeId) || !name) continue;
    out.push({
      storeId,
      name: name.slice(0, 120),
      artist: label(o?.["im:artist"]).trim().slice(0, 80),
      genre: str(obj(obj(o?.category)?.attributes)?.label).slice(0, 40),
      released: label(o?.["im:releaseDate"]).slice(0, 10),
    });
  }
  return out;
}

// ─── Du nom de l'app à son hashtag ───────────────────────────────────────────

/** Minuscules sans accents. */
const fold = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
/** Le texte réduit à ses lettres et chiffres (« Alta Daily » → « altadaily »). */
export const compactName = (s: string): string => fold(s).replace(/[^a-z0-9]/g, "");

/** La marque d'une app : son nom sans le slogan (« Drawly: dessiner sur ipad » → « Drawly »). */
export function storeBrand(name: string): string {
  const first = name.trim().split(/\s*[:|•·™®,]\s*|\s+[-–—]\s+/)[0] ?? "";
  return first.replace(/\(.*?\)/g, "").trim();
}

const COMPANY = /\b(llc|inc|ltd|limited|gmbh|sas|sarl|s\.?a\.?|corp|corporation|co|company|pte|bv|ab|oy|ug|srl|ag|plc|technologies|technology|labs|studio|studios|apps)\b\.?/gi;

/**
 * Les hashtags à lire pour une app : sa marque (« drawly »), la même suivie de
 * « app » (« drawlyapp » : le hashtag propre à l'app quand la marque est un mot
 * courant), et l'éditeur quand le nom de l'app est une phrase (« Code de la route
 * 2026 Ornikar » → « ornikar »).
 */
export function storeTags(name: string, artist: string): string[] {
  const slug = compactName(storeBrand(name));
  const out: string[] = [];
  if (slug.length >= 3 && slug.length <= 22) {
    out.push(slug);
    if (!slug.endsWith("app")) out.push(`${slug}app`);
  }
  const art = compactName(artist.replace(COMPANY, ""));
  if ((slug.length >= 16 || slug.length < 3) && art.length >= 3 && art.length <= 18 && art !== slug) out.push(art);
  return out;
}

/** Le nom de l'app dans un hashtag : « livenapp » → « liven ». */
export const tagCore = (tag: string): string => (tag.endsWith("app") && tag.length > 6 ? tag.slice(0, -3) : tag);

// ─── Les pages d'intégration publiques de TikTok ─────────────────────────────

/** La valeur JSON qui suit `key` dans la page (un objet ou un tableau), ou `undefined`. */
export function cutJson(text: string, key: string): unknown {
  const i = text.indexOf(key);
  if (i < 0) return undefined;
  const start = i + key.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < text.length; k++) {
    const c = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, k + 1));
        } catch {
          return undefined;
        }
      }
    } else if (depth === 0 && !/\s/.test(c)) return undefined;
  }
  return undefined;
}

const count = (x: unknown): number => {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** La page d'un hashtag : ses compteurs et ses vidéos les plus vues (10 au plus), avec leur auteur. */
export type TagPage = { videos: number; views: number; items: { author: string; desc: string }[] };

export const tagEmbedUrl = (tag: string): string => `https://www.tiktok.com/embed/tag/${encodeURIComponent(tag)}`;
export const profileEmbedUrl = (handle: string): string => `https://www.tiktok.com/embed/@${encodeURIComponent(handle)}`;

/** `null` : la page ne porte pas les données attendues (TikTok ne l'a pas servie). */
export function parseTagEmbed(html: string): TagPage | null {
  const info = obj(cutJson(html, '"embedInfo":'));
  if (!info) return null;
  const list = cutJson(html, '"videoList":');
  const items = (Array.isArray(list) ? list : [])
    .map((v) => ({ author: str(obj(v)?.authorUniqueId), desc: str(obj(v)?.desc).slice(0, 300) }))
    .filter((v) => v.author.length > 0);
  return { videos: count(info.videoCount), views: count(info.viewCount), items };
}

/** Le profil public d'un auteur : sa bio, ses abonnés, ses dernières légendes (10 environ). */
export type AuthorProfile = { fans: number; bio: string; verified: boolean; descs: string[] };

export function parseProfileEmbed(html: string): AuthorProfile | null {
  const list = cutJson(html, '"videoList":');
  if (!Array.isArray(list)) return null;
  const ui = obj(cutJson(html, '"userInfo":')) ?? {};
  return { fans: count(ui.followerCount), bio: str(ui.signature).slice(0, 300), verified: ui.verified === true, descs: list.map((v) => str(obj(v)?.desc).slice(0, 300)) };
}

// ─── Un auteur est-il un compte créateur de l'app ? ──────────────────────────

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Le texte nomme l'app : le mot entier (suivi ou non de « app », « ai », « io »), ou, pour un nom long, écrit en plusieurs mots. */
export function citesStoreApp(text: string, slug: string): boolean {
  const t = fold(text);
  if (new RegExp(`(?<![a-z0-9])${escapeRe(slug)}(app|ai|io)?(?![a-z0-9])`).test(t)) return true;
  return slug.length >= 7 && t.replace(/[^a-z0-9#@ ]/g, "").replace(/ /g, "").includes(slug);
}

/**
 * Le pseudo porte le nom de l'app comme un MOT, avec autre chose à côté
 * (« kate.drawly3 », « laure_love8 », « crush_tracker_liv »), pas noyé dans un
 * autre mot (« frenzywaterpark », « theparrotlady »).
 */
export function handleCarries(handle: string, slug: string): boolean {
  if (slug.length < 4) return false;
  const raw = handle
    .toLowerCase()
    .split(/[._]+/)
    .map(compactName)
    .filter((t) => t.length > 0);
  // « love8 » tel quel, puis « drawly3 » sans son chiffre.
  for (const toks of [raw, raw.map((t) => t.replace(/\d+$/, "")).filter((t) => t.length > 0)]) {
    for (let i = 0; i < toks.length; i++) {
      let acc = "";
      for (let j = i; j < toks.length; j++) {
        acc += toks[j];
        if (acc === slug && toks.length > j - i + 1) return true;
      }
    }
  }
  return false;
}

const BRAND_TAILS = new Set(["", "app", "apps", "official", "officiel", "oficial", "hq", "ai", "io", "co", "fr", "us", "uk", "br", "es", "de", "it", "mx", "global", "team", "appofficial", "theapp", "inc"]);
const BRAND_HEADS = new Set(["get", "the", "try", "use", "join", "app"]);

/** Le compte de la marque elle-même (« getwyndy », « rapfame_app », un compte certifié) : pas un compte créateur. */
export function isBrandAccount(handle: string, slug: string, verified: boolean): boolean {
  const h = compactName(handle);
  if (h.startsWith(slug) && BRAND_TAILS.has(h.slice(slug.length))) return true;
  if (h.endsWith(slug) && BRAND_HEADS.has(h.slice(0, h.length - slug.length))) return true;
  return verified;
}

/** Un mot qui dit qu'on parle d'une APP (dans une bio) : sans lui, « parrot » dans une bio n'est qu'un perroquet. */
const APP_CONTEXT =
  /\b(app|apps|appli|application|aplicativo|aplicacion|download|telecharge|baixe|baixar|descarga|descargar|app ?store|play ?store|ambassad\w*|embajador\w*|embaixador\w*|partner|partenaire|ugc|link in bio|lien en bio|link na bio|brand)\b/;

export type CreatorWhy = "handle" | "bio" | "half";

/**
 * La preuve qu'un auteur est un compte créateur de l'app, ou `null` :
 *  - « handle » : son pseudo la porte comme un mot ;
 *  - « bio » : sa bio la nomme avec un mot d'app, ou mentionne son compte (« @drawly ») ;
 *  - « half » : au moins 5 de ses dernières vidéos, et la moitié, la citent.
 * Sans profil lu, seul le pseudo peut prouver.
 */
export function creatorEvidence(handle: string, slug: string, profile: AuthorProfile | null | undefined): CreatorWhy | null {
  if (isBrandAccount(handle, slug, profile?.verified === true)) return null;
  if (handleCarries(handle, slug)) return "handle";
  if (!profile) return null;
  const bio = fold(profile.bio);
  if (citesStoreApp(profile.bio, slug) && (APP_CONTEXT.test(bio) || bio.replace(/ /g, "").includes(`@${slug}`))) return "bio";
  const n = profile.descs.filter((d) => citesStoreApp(d, slug)).length;
  return n >= 5 && 2 * n >= profile.descs.length ? "half" : null;
}

// ─── Le verdict ──────────────────────────────────────────────────────────────

/** En dessous de 20 vidéos ou de 3 auteurs, on ne lit pas les profils : seul un pseudo peut prouver. */
export const STORE_MIN_TAG_VIDEOS = 20;
export const STORE_MIN_AUTHORS = 3;
/** Profils lus par hashtag (ses premiers auteurs). */
export const STORE_PROFILES_PER_TAG = 8;
/** Au-delà de 100 000 vidéos, le hashtag est un mot courant ou une très grande marque (« parrot », « roblox ») : écarté. */
export const STORE_MAX_TAG_VIDEOS = 100_000;
/** Comptes créateurs qu'il faut pour proposer l'app. */
export const STORE_MIN_CREATORS = 2;

/** Les auteurs distincts d'une page, dans l'ordre de leurs vidéos. */
export function tagAuthors(page: TagPage): string[] {
  return Array.from(new Set(page.items.map((v) => v.author)));
}

/** Les auteurs dont il faut lire le profil pour juger ce hashtag (aucun quand il est trop petit ou trop gros). */
export function profilesToRead(page: TagPage): string[] {
  const authors = tagAuthors(page);
  if (page.videos < STORE_MIN_TAG_VIDEOS || page.videos > STORE_MAX_TAG_VIDEOS || authors.length < STORE_MIN_AUTHORS) return [];
  return authors.slice(0, STORE_PROFILES_PER_TAG);
}

export type StoreCreator = { handle: string; why: CreatorWhy };
export type TagVerdict = { tag: string; videos: number; views: number; creators: StoreCreator[] };

/** Les comptes créateurs de l'app parmi les auteurs d'un hashtag. `profiles` : pseudo en minuscules → profil lu. */
export function tagVerdict(tag: string, page: TagPage, profiles: ReadonlyMap<string, AuthorProfile | null>): TagVerdict {
  const core = tagCore(tag);
  const creators: StoreCreator[] = [];
  if (page.videos <= STORE_MAX_TAG_VIDEOS) {
    for (const handle of tagAuthors(page)) {
      const why = creatorEvidence(handle, core, profiles.get(handle.toLowerCase()));
      if (why) creators.push({ handle, why });
    }
  }
  return { tag, videos: page.videos, views: page.views, creators };
}

export type StoreOutcome = "network" | "none";

/** Le meilleur hashtag d'une app (le plus de comptes créateurs, puis le plus de vidéos), et ce qu'on en conclut. */
export function storeVerdict(verdicts: readonly TagVerdict[]): { outcome: StoreOutcome; best: TagVerdict | null } {
  const best = [...verdicts].sort((a, b) => b.creators.length - a.creators.length || b.videos - a.videos)[0] ?? null;
  return { outcome: best !== null && best.creators.length >= STORE_MIN_CREATORS ? "network" : "none", best };
}

// ─── La file des apps à contrôler ────────────────────────────────────────────

const DAY = 86_400_000;
/** Une app sortie depuis moins de trois ans passe d'abord : 5,8 % d'entre elles ont un réseau, contre 1,6 % des plus anciennes (mesure du 12/11/2026). */
export const STORE_RECENT_YEARS = 3;
/** Sans réseau : revue dans 60 jours. Avec : dans 180 jours. Page illisible : le lendemain. */
export const STORE_RECHECK_NONE_MS = 60 * DAY;
export const STORE_RECHECK_NETWORK_MS = 180 * DAY;
export const STORE_RETRY_MS = DAY;

export function isRecentRelease(released: string, now: number): boolean {
  const year = Number(released.slice(0, 4));
  return Number.isFinite(year) && year > 0 && year >= new Date(now).getUTCFullYear() - (STORE_RECENT_YEARS - 1);
}

/** Le rang d'une app jamais contrôlée dans la file (`nextCheckAt`) : les récentes un an devant les autres. */
export function firstCheckAt(released: string, now: number): number {
  return isRecentRelease(released, now) ? now - 365 * DAY : now;
}

export function nextCheckAfter(outcome: StoreOutcome | "known" | "unreadable", now: number): number {
  if (outcome === "unreadable") return now + STORE_RETRY_MS;
  return now + (outcome === "none" ? STORE_RECHECK_NONE_MS : STORE_RECHECK_NETWORK_MS);
}

/** Pages TikTok lues au plus par passage (un passage par heure, une pause de 1,5 à 3 s entre deux pages). */
export const STORE_PAGES_PER_RUN = 90;
/** Une app coûte au plus ses hashtags et leurs profils : on ne commence pas une app sans cette marge. */
export const STORE_PAGES_PER_APP = 3 + 2 * STORE_PROFILES_PER_TAG;
/** Pages refusées d'affilée qui arrêtent le passage (TikTok ne répond plus à cette adresse). */
export const STORE_BREAKER = 5;

/**
 * L'app est-elle déjà suivie ? Oui quand un de ses hashtags EST un motif d'une app suivie (« retaincards »,
 * « retain.cards » sans son extension). L'égalité, pas l'inclusion : « cal » est dans « calai » et c'est une autre
 * app — le formulaire de suivi, lui, refusera un motif contenu dans celui d'une app suivie.
 */
export function alreadyFollowed(tags: readonly string[], apps: readonly { strong: readonly string[] }[]): boolean {
  const known = new Set(apps.flatMap((a) => a.strong.flatMap((s) => [compactName(s), compactName(s.replace(/\.[a-z]+$/, ""))])));
  return tags.some((t) => known.has(tagCore(t)));
}

/** La clé d'une app des classements parmi les apps repérées. */
export const storeCandidateKey = (storeId: string): string => `store:${storeId}`;
export const storeUrl = (storeId: string): string => `https://apps.apple.com/app/id${storeId}`;

// ─── Le contrôle d'une app, de bout en bout ──────────────────────────────────

/** Ce qu'une lecture de page rend : la page, « absent » (TikTok répond qu'elle n'existe pas), ou « suspect » (TikTok ne l'a pas servie). */
export type Read<T> = T | "absent" | "suspect";

export type StoreReaders = {
  tag: (tag: string) => Promise<Read<TagPage>>;
  profile: (handle: string) => Promise<Read<AuthorProfile>>;
  /** Vrai quand le passage doit s'arrêter (trop de pages refusées d'affilée). */
  stopped: () => boolean;
};

export type StoreCheck =
  /** Le passage s'est arrêté pendant cette app : rien n'est conclu, elle reste dans la file. */
  | { outcome: "stopped" }
  | { outcome: "known" | "unreadable" }
  | { outcome: StoreOutcome; best: TagVerdict | null };

/**
 * Contrôle UNE app : déjà suivie ? sinon ses hashtags, les profils de leurs
 * auteurs (`profiles` les garde d'une app à l'autre), et le verdict. Une page de
 * hashtag que TikTok ne sert pas rend l'app « illisible » (revue le lendemain).
 * Un profil que TikTok ne sert pas est un auteur qu'on n'a pas pu juger : s'il
 * manque un compte pour conclure à un réseau, l'app est « illisible » elle aussi,
 * plutôt que rangée « sans réseau » pour deux mois sur une lecture incomplète.
 */
export async function checkStoreApp(
  app: { name: string; artist: string },
  followed: readonly { strong: readonly string[] }[],
  read: StoreReaders,
  profiles: Map<string, AuthorProfile | null>,
): Promise<StoreCheck> {
  const tags = storeTags(app.name, app.artist);
  if (tags.length === 0) return { outcome: "none", best: null };
  if (alreadyFollowed(tags, followed)) return { outcome: "known" };
  const verdicts: TagVerdict[] = [];
  let unjudged = false;
  for (const tag of tags) {
    const page = await read.tag(tag);
    if (read.stopped()) return { outcome: "stopped" };
    if (page === "suspect") return { outcome: "unreadable" };
    if (page === "absent") continue;
    // Les profils de CE contrôle : ceux déjà lus, et ceux qu'on lit maintenant. Un profil refusé n'est pas gardé pour l'app suivante.
    const seen = new Map(profiles);
    for (const handle of profilesToRead(page)) {
      const key = handle.toLowerCase();
      if (profiles.has(key)) continue;
      const p = await read.profile(handle);
      if (read.stopped()) return { outcome: "stopped" };
      if (p === "suspect") {
        unjudged = true;
        continue;
      }
      profiles.set(key, p === "absent" ? null : p);
      seen.set(key, p === "absent" ? null : p);
    }
    verdicts.push(tagVerdict(tag, page, seen));
  }
  const verdict = storeVerdict(verdicts);
  return verdict.outcome === "none" && unjudged ? { outcome: "unreadable" } : verdict;
}

// ─── Un passage du contrôle ──────────────────────────────────────────────────

export type PageFetch = { kind: "ok"; text: string } | { kind: "absent" } | { kind: "suspect"; reason: string };

/**
 * Une page d'intégration publique de TikTok, demandée telle quelle (sans se
 * faire passer pour un navigateur). 400 ou 404 : le hashtag ou le compte
 * n'existe pas, c'est une réponse. Tout autre refus est suspect.
 */
export async function fetchEmbedPage(url: string, fetchImpl: typeof fetch = fetch): Promise<PageFetch> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    return { kind: "suspect", reason: `réseau : ${String(e).slice(0, 80)}` };
  }
  if (res.status === 400 || res.status === 404) return { kind: "absent" };
  if (!res.ok) return { kind: "suspect", reason: `HTTP ${res.status}` };
  try {
    return { kind: "ok", text: await res.text() };
  } catch (e) {
    return { kind: "suspect", reason: `corps illisible : ${String(e).slice(0, 60)}` };
  }
}

export type QueueIo<A> = {
  page: (url: string) => Promise<PageFetch>;
  /** La pause entre deux pages. */
  pause: () => Promise<void>;
  /** L'écriture de ce qu'un contrôle a conclu. */
  apply: (app: A, outcome: StoreOutcome | "known" | "unreadable", best: TagVerdict | null) => Promise<void>;
};

export type QueueRun = { checked: number; pages: number; stopped: string | null };

/**
 * Un passage : les apps de la file dans l'ordre, une page à la fois avec une
 * pause entre deux, jusqu'au plafond de pages. Une page refusée ou servie sans
 * ses données est « suspecte » ; `breaker` suspectes D'AFFILÉE arrêtent le
 * passage (TikTok ne répond plus à cette adresse) sans rien conclure pour l'app
 * en cours. Un hashtag ou un compte qui n'existe pas est une réponse normale.
 */
export async function runStoreQueue<A extends { name: string; artist: string }>(
  due: readonly A[],
  followed: readonly { strong: readonly string[] }[],
  io: QueueIo<A>,
  limits: { pages: number; perApp: number; breaker: number } = { pages: STORE_PAGES_PER_RUN, perApp: STORE_PAGES_PER_APP, breaker: STORE_BREAKER },
): Promise<QueueRun> {
  let pages = 0;
  let suspects = 0;
  let stopped: string | null = null;
  const note = (reason: string | null) => {
    if (reason === null) {
      suspects = 0;
      return;
    }
    suspects++;
    if (suspects >= limits.breaker) stopped = reason;
  };
  const get = async (url: string): Promise<PageFetch> => {
    if (pages > 0) await io.pause();
    pages++;
    return io.page(url);
  };
  const readers: StoreReaders = {
    tag: async (tag) => {
      const r = await get(tagEmbedUrl(tag));
      if (r.kind === "suspect") {
        note(r.reason);
        return "suspect";
      }
      if (r.kind === "absent") {
        note(null);
        return "absent";
      }
      const parsed = parseTagEmbed(r.text);
      // Servie sans ses données : TikTok a répondu autre chose que la page.
      note(parsed ? null : "page de hashtag sans données");
      return parsed ?? "suspect";
    },
    profile: async (handle) => {
      const r = await get(profileEmbedUrl(handle));
      if (r.kind === "suspect") {
        note(r.reason);
        return "suspect";
      }
      note(null);
      // Un compte privé ou vide n'a pas de liste de vidéos : ce n'est pas un refus.
      return r.kind === "absent" ? "absent" : (parseProfileEmbed(r.text) ?? "absent");
    },
    stopped: () => stopped !== null,
  };
  const profiles = new Map<string, AuthorProfile | null>();
  let checked = 0;
  for (const app of due) {
    // On ne commence pas une app qu'on ne pourrait pas finir.
    if (pages + limits.perApp > limits.pages) break;
    const r = await checkStoreApp(app, followed, readers, profiles);
    if (r.outcome === "stopped") break;
    await io.apply(app, r.outcome, "best" in r ? r.best : null);
    checked++;
  }
  return { checked, pages, stopped };
}

