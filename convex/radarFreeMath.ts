/**
 * RADAR — LE RELEVÉ GRATUIT D'UN COMPTE, sur les pages publiques de TikTok. Règles pures.
 *
 * Pourquoi : le relevé d'un compte par le fournisseur de données coûte 1 crédit, et fait 88 % de la facture
 * (13/11/2026 : 1 333 relevés par jour pour 2 162 comptes, 87 $ par mois ; 15 000 comptes en coûteraient 600).
 * Or ce qu'il rend se lit aussi, sans clé, sur deux pages publiques :
 *  - la page d'intégration du profil (`/embed/@pseudo`) : abonnés, bio, et ses 10 à 13 dernières vidéos avec leurs
 *    vues, leur légende, leur miniature ;
 *  - la page d'une vidéo (`/@pseudo/video/<id>`) : j'aime, commentaires, partages, enregistrements, son, texte à
 *    l'écran, pays, langue, durée.
 *
 * Mesuré le 13/11/2026 contre les relevés payants : sur 500 comptes, 495 lus du premier coup (les 5 autres
 * n'existent plus), 96,4 % des vidéos de la semaine retrouvées, aucun compteur de vues en retard sur 1 665, bio
 * identique 493 fois sur 495 ; sur 300 vidéos, 298 lues, date et son identiques. UNE différence : quand une vidéo
 * porte plusieurs textes à l'écran, ils n'arrivent pas dans le même ordre (24 vidéos sur 148) — une vidéo déjà
 * connue garde donc le texte qu'elle a en base.
 *
 * Comment : le profil donne la liste. Une vidéo INCONNUE, ou de moins de 48 heures, est lue sur sa page (tout ce
 * que le relevé payant donnait) ; les autres ne reçoivent que leurs vues. Dès qu'une page manque — profil refusé,
 * compte privé ou vide, vidéo inconnue illisible — le compte est relevé par le fournisseur, comme avant : la
 * qualité ne dépend jamais de la page gratuite. Et après FREE_BREAKER refus d'affilée, le passage finit en payant.
 *
 * Mesuré le 13/11/2026 sur TOUTE la flotte (2 210 comptes actifs, 6 305 pages en 10 minutes) : 2 063 profils lus du
 * premier coup, 78 de plus au second essai, les 4 095 pages vidéo lues ; 67 profils « absents » alors que le
 * fournisseur les relève sans erreur (TikTok ne sert pas leur page d'intégration) et 9 listes vides → 3,5 % des
 * comptes restent au relevé payant. Un profil « absent » n'est donc PAS un compte disparu.
 */
import { cleanText, langBucket, mentionLabel, type SignalInput } from "./radarSignalsMath";
import { cutJson } from "./radarStoreMath";

const HOUR = 3_600_000;

export const freeProfileUrl = (handle: string): string => `https://www.tiktok.com/embed/@${handle}`;
export const freeVideoUrl = (handle: string, videoId: string): string => `https://www.tiktok.com/@${handle}/video/${videoId}`;

/** Une vidéo de moins de 48 heures est relue en entier à chaque relevé : c'est là que ses chiffres bougent. */
export const FREE_FRESH_MS = 48 * HOUR;
/** Refus d'affilée (profil non servi) qui font finir le passage en payant. */
export const FREE_BREAKER = 6;
/** Comptes relevés au plus par passage quand le relevé est gratuit (le payant, lui, suit le budget). */
export const FREE_READS_PER_RUN = 600;

const obj = (x: unknown): Record<string, unknown> | null => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const str = (x: unknown): string => (typeof x === "string" ? x : "");
const num = (x: unknown): number => {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** La date de publication d'une vidéo, lue dans son identifiant (ses 32 bits de poids fort sont des secondes). */
export function videoIdTime(videoId: string): number {
  try {
    return Number(BigInt(videoId) >> BigInt(32)) * 1000;
  } catch {
    return 0;
  }
}

export type FreeListed = { videoId: string; caption: string; views: number; publishedAt: number; coverUrl?: string };
export type FreeProfile = { fans: number; bio: string; private: boolean; videos: FreeListed[] };

/** Le profil public d'un compte : abonnés, bio, et ses dernières vidéos (les plus récentes d'abord). `null` si la page ne se lit pas. */
export function parseFreeProfile(html: string): FreeProfile | null {
  const list = cutJson(html, '"videoList":');
  const ui = obj(cutJson(html, '"userInfo":'));
  if (!Array.isArray(list) || !ui) return null;
  const videos: FreeListed[] = [];
  for (const raw of list) {
    const v = obj(raw);
    const videoId = str(v?.id);
    const publishedAt = videoIdTime(videoId);
    if (!v || !/^\d{15,}$/.test(videoId) || publishedAt <= 0 || videos.some((x) => x.videoId === videoId)) continue;
    const coverUrl = str(v.coverUrl) || str(v.originCoverUrl);
    videos.push({ videoId, caption: str(v.desc), views: num(v.playCount), publishedAt, ...(coverUrl ? { coverUrl } : {}) });
  }
  videos.sort((a, b) => b.publishedAt - a.publishedAt);
  return { fans: num(ui.followerCount), bio: cleanText(str(ui.signature), 300), private: ui.privateAccount === true, videos };
}

const REHYDRATION = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/;

/**
 * La page publique d'une vidéo, mise dans la forme d'un relevé. « gone » : TikTok dit que la vidéo n'est plus là
 * (supprimée, privée) ; `null` : la page ne se lit pas.
 */
export function parseFreeVideo(html: string, handle: string, fallbackLang?: string): SignalInput | "gone" | null {
  const m = REHYDRATION.exec(html);
  if (!m) return null;
  let scope: Record<string, unknown> | null = null;
  try {
    scope = obj(obj(obj(JSON.parse(m[1]))?.__DEFAULT_SCOPE__)?.["webapp.video-detail"]);
  } catch {
    return null;
  }
  if (!scope) return null;
  const it = obj(obj(scope.itemInfo)?.itemStruct);
  if (!it) return typeof scope.statusCode === "number" && scope.statusCode !== 0 ? "gone" : null;
  const videoId = str(it.id);
  const createTime = num(it.createTime);
  if (!videoId || createTime <= 0) return null;
  const author = obj(it.author) ?? {};
  const authorId = str(author.id);
  const authorStats = obj(it.authorStats) ?? {};
  const stats = obj(it.stats) ?? {};
  const video = obj(it.video) ?? {};
  const music = obj(it.music) ?? {};
  const caption = str(it.desc);
  const region = str(it.locationCreated);
  // Le texte à l'écran : chaque bloc sur une ligne, les blocs séparés comme le fait le relevé payant.
  const texts: string[] = [];
  for (const s of Array.isArray(it.stickersOnItem) ? it.stickersOnItem : []) {
    for (const t of Array.isArray(obj(s)?.stickerText) ? (obj(s)!.stickerText as unknown[]) : []) {
      const line = str(t).replace(/\s+/g, " ").trim();
      if (line) texts.push(line);
    }
  }
  const hook = cleanText(texts.join(" · "), 200);
  const mentions: { id: string; label: string }[] = [];
  for (const t of Array.isArray(it.textExtra) ? it.textExtra : []) {
    const e = obj(t);
    const id = str(e?.userId);
    if (!e || !id || id === authorId || mentions.some((x) => x.id === id)) continue;
    const label = mentionLabel(caption, num(e.start), num(e.end));
    if (label && label.length >= 3) mentions.push({ id, label: cleanText(label, 60) });
  }
  const musicId = str(music.id);
  const musicTitle = str(music.title);
  const musicOwner = str(music.authorName);
  const duration = num(video.duration);
  const coverUrl = str(video.cover) || str(video.originCover);
  const bio = str(author.signature);
  return {
    videoId,
    url: freeVideoUrl(handle, videoId),
    authorId: authorId || handle,
    authorHandle: handle,
    authorFans: num(authorStats.followerCount),
    caption,
    lang: langBucket(str(it.textLanguage) || undefined, region || undefined, fallbackLang),
    ...(region ? { region } : {}),
    publishedAt: createTime * 1000,
    ...(duration > 0 ? { durationSec: duration } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    isAd: it.isAd === true,
    views: num(stats.playCount),
    likes: num(stats.diggCount),
    comments: num(stats.commentCount),
    shares: num(stats.shareCount),
    saves: num(stats.collectCount),
    ...(hook ? { hook } : {}),
    ...(musicId ? { musicId } : {}),
    ...(musicTitle ? { musicTitle: cleanText(musicTitle, 120) } : {}),
    ...(musicOwner ? { musicOwner } : {}),
    ...(mentions.length ? { mentions: mentions.slice(0, 10) } : {}),
    ...(bio ? { authorBio: cleanText(bio, 300) } : {}),
  };
}

/** Ce qu'on sait déjà d'une vidéo du compte : son texte à l'écran et son son, tels que rangés, et si son pays est connu. */
export type KnownVideo = { videoId: string; hook?: string; musicId?: string; musicTitle?: string; region?: string };
/** Vidéos déjà rangées relues en entier pour situer un compte dont on ne connaît pas encore le pays. */
export const FREE_REGION_PAGES = 2;
/** Une vidéo connue et plus toute neuve : seules ses vues (et sa miniature, qui expire) sont rafraîchies. */
export type LightVideo = { videoId: string; views: number; coverUrl?: string };

/**
 * Ce qu'il faut lire en entier, et ce qui ne reçoit que ses vues : une vidéo inconnue, ou de moins de 48 heures,
 * est lue sur sa page ; les autres sont déjà rangées, leurs vues suffisent. `wantRegion` : le compte n'a pas encore
 * de pays — ses deux vidéos rangées les plus récentes dont on ignore le pays sont relues elles aussi (le pays d'une
 * vidéo ne se lit que sur sa page).
 */
export function freePlan(listed: readonly FreeListed[], known: readonly KnownVideo[], now: number, wantRegion = false): { detail: FreeListed[]; light: LightVideo[] } {
  const have = new Map(known.map((k) => [k.videoId, k]));
  const detail: FreeListed[] = [];
  const light: LightVideo[] = [];
  let forRegion = wantRegion ? FREE_REGION_PAGES : 0;
  for (const v of listed) {
    const k = have.get(v.videoId);
    const fresh = now - v.publishedAt < FREE_FRESH_MS;
    const locate = !!k && !fresh && !k.region && forRegion > 0;
    if (locate) forRegion--;
    if (!k || fresh || locate) detail.push(v);
    else light.push({ videoId: v.videoId, views: v.views, ...(v.coverUrl ? { coverUrl: v.coverUrl } : {}) });
  }
  return { detail, light };
}

/** `reason` : ce que TikTok a répondu quand il n'a pas servi la page (« HTTP 429 »), pour le dire à l'arrêt. */
export type FreePage = { ok: true; text: string } | { ok: false; kind: "absent" | "suspect"; reason?: string };

/** Attente avant le second essai d'une page refusée. */
export const FREE_RETRY_MS = 2_500;

/**
 * Une page refusée est redemandée UNE fois, après une pause. Mesuré le 13/11/2026 sur les 2 210 comptes suivis, à
 * 10 pages par seconde : 80 profils refusés (« ratelimit triggered »), par rafales de 5 à 20 secondes, jamais plus
 * de 4 d'affilée ; relus ensuite, 78 passent. Une page « absente » n'est pas redemandée : c'est une réponse.
 */
export function retrying(page: (url: string) => Promise<FreePage>, pause: () => Promise<void>): (url: string) => Promise<FreePage> {
  return async (url) => {
    const first = await page(url);
    if (first.ok || first.kind === "absent") return first;
    await pause();
    return page(url);
  };
}

export type FreeRead =
  | { ok: true; videos: SignalInput[]; light: LightVideo[]; profile: { fans: number; bio: string }; pages: number }
  /**
   * Pourquoi le relevé gratuit n'a pas abouti — le compte passe alors au relevé payant :
   *  absent : le profil n'existe plus à cette adresse · suspect : TikTok n'a pas servi le profil ·
   *  private / empty : rien à lire sur le profil · detail : la page d'une vidéo inconnue ne s'est pas lue.
   */
  | { ok: false; why: "absent" | "suspect" | "private" | "empty" | "detail"; pages: number; reason?: string };

/**
 * Le relevé gratuit d'un compte, de bout en bout. `page` lit une adresse ; `known` dit ce qu'on a déjà de ces
 * vidéos. Rend les vidéos lues en entier (dans la forme du relevé payant), celles dont seules les vues bougent,
 * et le profil — ou la raison de passer au payant.
 */
export async function freeRead(
  handle: string,
  io: { page: (url: string) => Promise<FreePage>; known: (videoIds: string[]) => Promise<KnownVideo[]> },
  now: number,
  fallbackLang?: string,
  // Le compte n'a pas encore de pays : on en profite pour situer deux de ses vidéos déjà rangées.
  wantRegion = false,
): Promise<FreeRead> {
  let pages = 1;
  const p = await io.page(freeProfileUrl(handle));
  if (!p.ok) return { ok: false, why: p.kind, pages, ...(p.reason ? { reason: p.reason } : {}) };
  const profile = parseFreeProfile(p.text);
  if (!profile) return { ok: false, why: "suspect", pages, reason: "page sans profil" };
  if (profile.private) return { ok: false, why: "private", pages };
  if (profile.videos.length === 0) return { ok: false, why: "empty", pages };
  const known = await io.known(profile.videos.map((v) => v.videoId));
  const byId = new Map(known.map((k) => [k.videoId, k]));
  const plan = freePlan(profile.videos, known, now, wantRegion);
  const videos: SignalInput[] = [];
  const light = [...plan.light];
  for (const listed of plan.detail) {
    pages++;
    const page = await io.page(freeVideoUrl(handle, listed.videoId));
    const parsed = page.ok ? parseFreeVideo(page.text, handle, fallbackLang) : null;
    const before = byId.get(listed.videoId);
    const asLight = (): void => void light.push({ videoId: listed.videoId, views: listed.views, ...(listed.coverUrl ? { coverUrl: listed.coverUrl } : {}) });
    if (parsed === "gone" || (!page.ok && page.kind === "absent")) {
      // Une vidéo rangée et plus toute neuve n'était relue que pour situer le compte : sans sa page, ses vues
      // suffisent, comme à tout autre relevé. Sinon, supprimée entre la liste et sa page : elle n'est plus à relever.
      if (before && now - listed.publishedAt >= FREE_FRESH_MS) asLight();
      continue;
    }
    if (!parsed) {
      // Une vidéo qu'on n'a pas encore ne peut pas entrer à moitié : le compte passe au relevé payant.
      if (!before) return { ok: false, why: "detail", pages };
      asLight();
      continue;
    }
    // Les abonnés et la bio du profil font foi ; une vidéo déjà rangée garde son texte à l'écran et son son.
    const { hook, musicId, musicTitle, ...rest } = parsed;
    videos.push({
      ...rest,
      authorFans: profile.fans,
      views: Math.max(parsed.views, listed.views),
      ...(before ? (before.hook ? { hook: before.hook } : {}) : hook ? { hook } : {}),
      ...(before ? (before.musicId ? { musicId: before.musicId } : {}) : musicId ? { musicId } : {}),
      ...(before ? (before.musicTitle ? { musicTitle: before.musicTitle } : {}) : musicTitle ? { musicTitle } : {}),
      ...(profile.bio ? { authorBio: profile.bio } : {}),
    });
  }
  return { ok: true, videos, light, profile: { fans: profile.fans, bio: profile.bio }, pages };
}

/** L'état du relevé gratuit pendant un passage : il s'éteint après FREE_BREAKER profils refusés d'affilée. */
export type FreeState = { on: boolean; ok: number; fallback: number; streak: number; stopped: string | null };
export const freeStart = (): FreeState => ({ on: true, ok: 0, fallback: 0, streak: 0, stopped: null });

/** Note l'issue d'un relevé gratuit. Seul un profil que TikTok n'a pas servi compte pour le coupe-circuit, qui dit pourquoi. */
export function freeNote(state: FreeState, outcome: "ok" | "absent" | "suspect" | "private" | "empty" | "detail", reason?: string): FreeState {
  if (outcome === "ok") return { ...state, ok: state.ok + 1, streak: 0 };
  const streak = outcome === "suspect" ? state.streak + 1 : 0;
  const off = streak >= FREE_BREAKER;
  const stopped = `${FREE_BREAKER} profils refusés d'affilée${reason ? ` (${reason})` : ""}`;
  return { ...state, fallback: state.fallback + 1, streak, on: state.on && !off, stopped: off ? stopped : state.stopped };
}

/**
 * LA VOIE GRATUITE d'un passage. Le 13/11/2026, premier passage en production : 8 comptes relevés de front, 6
 * profils refusés d'affilée, aucun lu — alors que le même code, du poste de travail, en lit 31 sur 32 à ce rythme.
 * Les serveurs sont donc servis moins volontiers. Ce que TikTok leur sert sans arrêt, c'est le contrôle des
 * classements (convex/radarStore) : UNE page à la fois, 0,3 à 0,7 seconde entre deux. La voie gratuite prend ce
 * rythme : un compte après l'autre, une pause avant chaque page, pendant FREE_LANE_MAX_MS au plus.
 * Ce qu'elle ne relève pas (refus, page qui manque, temps écoulé, coupe-circuit) part au relevé payant, dans la
 * limite du budget : un compte n'attend jamais plus qu'avant.
 */
export const FREE_LANE_MAX_MS = 5 * 60_000;

/** Une pause AVANT chaque page (le rythme auquel les serveurs sont servis). */
export function paced(page: (url: string) => Promise<FreePage>, pause: () => Promise<void>): (url: string) => Promise<FreePage> {
  return async (url) => {
    await pause();
    return page(url);
  };
}

/**
 * Déroule la voie gratuite : chaque compte est relevé à son tour tant qu'elle est ouverte (`alive` : le temps
 * imparti) et que le coupe-circuit n'a pas sauté. Rend l'état du passage et les comptes à relever en payant —
 * ceux dont le relevé gratuit n'a pas abouti, et tous ceux qu'elle n'a pas eu le temps de prendre.
 */
export async function runFreeLane<A>(
  accounts: readonly A[],
  read: (account: A) => Promise<{ ok: true } | { ok: false; why: "absent" | "suspect" | "private" | "empty" | "detail"; reason?: string }>,
  alive: () => boolean,
): Promise<{ state: FreeState; toPay: A[] }> {
  let state = freeStart();
  const toPay: A[] = [];
  for (const account of accounts) {
    if (!state.on || !alive()) {
      toPay.push(account);
      continue;
    }
    const r = await read(account);
    state = freeNote(state, r.ok ? "ok" : r.why, r.ok ? undefined : r.reason);
    if (!r.ok) toPay.push(account);
  }
  return { state, toPay };
}
