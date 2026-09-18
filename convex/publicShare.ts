/**
 * PARTAGE PUBLIC D'UN DASHBOARD — le cœur PUR (aucun accès base).
 *
 * Un lien `/s/<token>` montre une partie du Tracker à quelqu'un qui n'a pas de
 * compte : une marque, ou une créatrice. Tout ce qui décide de CE QUI SORT vit
 * ici, sans `ctx`, pour être testé par `lib/public-share.test.ts` :
 *
 *   - `effectiveFilters`  : le périmètre réellement appliqué (la créatrice est
 *                           verrouillée sur elle-même, quoi qu'on ait stocké) ;
 *   - `shareWindow`       : la période, glissante ou fixe, résolue à un instant ;
 *   - `shareStatus`       : lien valide, expiré ou révoqué ;
 *   - `projectPublicTracker` : LA projection. Elle reçoit des posts internes et
 *                           rend un objet qui ne contient que ce qui est coché.
 *
 * ── LA RÈGLE : UN CHAMP NON ÉCRIT NE SORT PAS ────────────────────────────────
 * On ne « masque » rien côté navigateur. Un bloc décoché n'est pas envoyé ; un
 * nom anonymisé n'existe pas dans la réponse ; le @handle et la campagne interne
 * ne sont jamais copiés. La page publique ne peut pas afficher ce qu'elle n'a
 * pas reçu — c'est la seule garantie qui résiste à un visiteur qui ouvre les
 * outils de développement.
 *
 * ── AUCUN MONTANT, JAMAIS ────────────────────────────────────────────────────
 * Le Tracker ne porte pas d'argent, et la projection n'a AUCUN champ où en
 * mettre. Une créatrice ne voit donc pas ses gains par un lien public (décision
 * produit du 2026-09-18) : ce n'est pas une option décochée, c'est une forme
 * de réponse qui ne sait pas les porter. Étendre le partage à un dashboard
 * d'argent demandera d'ajouter ces champs ICI, sous les yeux d'un relecteur.
 *
 * ── LE QUADRANT N'EST PAS PARTAGEABLE ────────────────────────────────────────
 * Ses verdicts (« À archiver ») sont des décisions internes. Il n'est pas
 * « décoché par défaut » : il n'existe pas dans `SHARE_BLOCKS`, et
 * `sanitizeBlocks` jette toute valeur hors liste — y compris un « quadrant »
 * écrit à la main en base.
 */
import { passesWarmupMode, type WarmupMode } from "./warmupMode";
import { tiktokVideoIdFromUrl } from "./postUrlDate";

/** Les dashboards partageables. Un seul pour l'instant ; l'union grandira. */
export const SHARE_DASHBOARDS = ["tracker"] as const;
export type ShareDashboard = (typeof SHARE_DASHBOARDS)[number];

/**
 * Les blocs qu'un lien peut montrer, dans l'ordre d'affichage. Les quatre
 * chiffres clés sont séparés : on peut vouloir montrer l'engagement sans le
 * volume de vues, et l'inverse.
 */
export const SHARE_BLOCKS = [
  "kpi_views",
  "kpi_likes",
  "kpi_comments",
  "kpi_engagement",
  "daily",
  "by_platform",
  "by_creator",
  "posts",
] as const;
export type ShareBlock = (typeof SHARE_BLOCKS)[number];

export type ShareAudience = "brand" | "creator";

/**
 * Nombre de posts montrés dans le bloc « posts » : le TOP 3 par vues (podium de
 * la page publique, décision produit du 2026-09-18). Les liens déjà envoyés
 * passent au top 3 avec la page, c'est voulu.
 */
export const PUBLIC_POSTS_LIMIT = 3;

/** Un identifiant de vidéo TikTok bien formé (garde des actions publiques). */
export function isTikTokVideoId(id: string): boolean {
  return /^\d{6,25}$/.test(id);
}

/**
 * Miniature d'une vidéo depuis la réponse oEmbed de TikTok. On n'en garde QUE
 * l'image : la même réponse porte `author_unique_id` et `author_name`, qui ne
 * doivent jamais atteindre le visiteur d'un lien anonymisé. L'échéance vient
 * du paramètre signé `x-expires` de l'image (≈ 48 h constatées).
 */
export function thumbnailFromOembed(
  body: unknown,
): { url: string; expiresAt: number | null } | null {
  if (body === null || typeof body !== "object") return null;
  const url = (body as { thumbnail_url?: unknown }).thumbnail_url;
  if (typeof url !== "string" || !/^https:\/\/[^/]*tiktokcdn[^/]*\//.test(url)) {
    return null;
  }
  let expiresAt: number | null = null;
  try {
    const raw = new URL(url).searchParams.get("x-expires");
    if (raw !== null && /^\d+$/.test(raw)) expiresAt = Number(raw) * 1000;
  } catch {
    return null;
  }
  return { url, expiresAt };
}

/** Ne garde que les blocs connus, sans doublon, dans l'ordre canonique. */
export function sanitizeBlocks(blocks: readonly string[]): ShareBlock[] {
  const wanted = new Set(blocks);
  return SHARE_BLOCKS.filter((b) => wanted.has(b));
}

/**
 * Blocs RÉELLEMENT servis pour une audience. Pour une créatrice, « par
 * créatrice » n'a qu'une barre — la sienne — et le montrer ne dirait rien
 * d'autre que la somme déjà affichée : on le retire plutôt que d'afficher un
 * graphe vide de sens.
 */
export function blocksForAudience(
  blocks: readonly string[],
  audience: ShareAudience,
): ShareBlock[] {
  const clean = sanitizeBlocks(blocks);
  return audience === "creator"
    ? clean.filter((b) => b !== "by_creator")
    : clean;
}

// ─── Période ────────────────────────────────────────────────────────────────

export type SharePeriod =
  | { kind: "rolling"; days: number }
  | { kind: "fixed"; from: number; to: number }
  | { kind: "all" };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bornes de la période à l'instant `now`. Glissante = les `days` derniers jours
 * jusqu'à maintenant ; le lien reste donc vivant. `now` vient TOUJOURS du
 * serveur : un visiteur qui choisirait l'instant choisirait aussi la fenêtre,
 * et verrait des posts hors du périmètre partagé.
 */
export function shareWindow(
  period: SharePeriod,
  now: number,
): { from: number | undefined; to: number | undefined } {
  if (period.kind === "rolling") {
    const days = Math.max(1, Math.round(period.days));
    return { from: now - days * DAY_MS, to: now };
  }
  if (period.kind === "fixed") return { from: period.from, to: period.to };
  return { from: undefined, to: undefined };
}

// ─── Périmètre ──────────────────────────────────────────────────────────────

export type SharePerimeter = {
  period: SharePeriod;
  creatorIds?: string[];
  comptes?: string[];
  plateformes?: ("TikTok" | "Instagram" | "YouTube")[];
  campaignIds?: string[];
  warmup: WarmupMode;
};

export type EffectiveFilters = {
  dateFrom: number | undefined;
  dateTo: number | undefined;
  creatorIds: string[] | undefined;
  comptes: string[] | undefined;
  plateformes: ("TikTok" | "Instagram" | "YouTube")[] | undefined;
  campaignIds: string[] | undefined;
  warmup: WarmupMode;
};

/**
 * Le filtre appliqué aux publications pour servir un lien.
 *
 * Pour une créatrice, la liste de créatrices STOCKÉE est ignorée et remplacée
 * par la sienne. Ce n'est pas une ceinture de plus : c'est ce qui fait qu'un
 * lien de créatrice ne peut PAS montrer une autre créatrice, même si son
 * périmètre a été écrit de travers. Sans `creatorId`, le lien ne montre rien
 * (liste vide ≠ « toutes » : on n'élargit jamais par défaut).
 */
export function effectiveFilters(
  share: {
    audience: ShareAudience;
    creatorId?: string | null;
    perimeter: SharePerimeter;
  },
  now: number,
): EffectiveFilters {
  const { from, to } = shareWindow(share.perimeter.period, now);
  const nonEmpty = <T>(l: T[] | undefined) =>
    l !== undefined && l.length > 0 ? l : undefined;
  return {
    dateFrom: from,
    dateTo: to,
    creatorIds:
      share.audience === "creator"
        ? [share.creatorId ?? "__aucune__"]
        : nonEmpty(share.perimeter.creatorIds),
    comptes: nonEmpty(share.perimeter.comptes),
    plateformes: nonEmpty(share.perimeter.plateformes),
    campaignIds: nonEmpty(share.perimeter.campaignIds),
    warmup: share.perimeter.warmup,
  };
}

// ─── Statut du lien ─────────────────────────────────────────────────────────

/**
 * Valide, ou pas. Trois raisons d'être invalide, UNE seule réponse vers
 * l'extérieur (cf `getPublicShare`) : on ne dit pas à un visiteur qu'un lien a
 * existé, ni pourquoi il ne marche plus.
 */
export function shareStatus(
  share: { revokedAt?: number; expiresAt?: number } | null,
  now: number,
): "valid" | "invalid" {
  if (share === null) return "invalid";
  if (share.revokedAt !== undefined) return "invalid";
  if (share.expiresAt !== undefined && share.expiresAt <= now) return "invalid";
  return "valid";
}

// ─── Projection ─────────────────────────────────────────────────────────────

/** Un post tel que la query le lit, AVANT projection. Rien de tout ça ne sort tel quel. */
export type InternalSharePost = {
  id: string;
  label: string;
  plateforme: string;
  compte: string;
  datePubli: number;
  vues: number;
  likes: number;
  comments: number;
  isWarmup: boolean;
  creatorId: string | null;
  creatorName: string | null;
  postUrl: string | null;
};

/** Qui a fait un post, vu de l'extérieur : un nom, une lettre, ou rien. */
export type PublicCreatorRef =
  | { kind: "named"; name: string }
  | { kind: "anonymous"; index: number }
  | null;

export type PublicTrackerView = {
  postCount: number;
  kpi: {
    views?: number;
    likes?: number;
    comments?: number;
    /** (Σlikes + Σcomments) / Σvues, hors chauffe sauf mode « only ». null = pas de vues. */
    engagement?: number | null;
  } | null;
  byPlatform: { label: string; vues: number }[] | null;
  byCreator: { creator: PublicCreatorRef; vues: number }[] | null;
  posts:
    | {
        label: string;
        plateforme: string;
        datePubli: number;
        vues: number;
        likes: number;
        comments: number;
        url: string | null;
        /**
         * Vidéo lisible SUR la page (lecteur TikTok intégré). Seulement l'id :
         * l'URL, elle, porte le @handle. null = option décochée, ou plateforme
         * sans lecteur anonyme (Instagram et YouTube affichent le compte).
         */
        video: { platform: "tiktok"; id: string } | null;
        creator: PublicCreatorRef;
      }[]
    | null;
};

/**
 * La réponse complète d'un lien public. Vit ICI, dans le module pur, pour que
 * les écrans l'importent sans tirer convex/publicShares.ts (et ses lectures de
 * base) dans leur graphe d'imports.
 */
export type PublicSharePayload = {
  status: "valid";
  dashboard: "tracker";
  name: string;
  projectName: string;
  projectLogoUrl: string | null;
  accentColor: string;
  audience: ShareAudience;
  /** Lien de créatrice : son prénom, pour le titre. null pour une marque. */
  creatorName: string | null;
  period: { kind: "rolling" | "fixed" | "all"; from: number | null; to: number | null };
  /** Dernier relevé de vues du projet — « à jour il y a 2 h ». */
  updatedAt: number | null;
  blocks: string[];
  view: PublicTrackerView;
  daily: { date: string; value: number }[] | null;
};

export type ProjectionConfig = {
  audience: ShareAudience;
  blocks: readonly string[];
  /** Marque seulement : montrer les vrais noms au lieu de « Créatrice A ». */
  showCreatorNames: boolean;
  /** Lien vers le post sur la plateforme. ⚠️ L'URL porte le @handle du compte. */
  postLinks: boolean;
  /** Vidéo lisible sur la page, sans @handle (TikTok seulement). */
  playableVideos: boolean;
  warmup: WarmupMode;
};

/**
 * Lettre stable par créatrice DANS une réponse : classement par vues
 * décroissantes, puis par identifiant pour départager. La même créatrice porte
 * la même lettre dans « par créatrice » et dans la liste des posts — sinon
 * « Créatrice A » désignerait deux personnes sur la même page.
 */
function anonymousIndexes(posts: readonly InternalSharePost[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const p of posts) {
    if (p.creatorId === null) continue;
    totals.set(p.creatorId, (totals.get(p.creatorId) ?? 0) + p.vues);
  }
  const order = [...totals.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  return new Map(order.map(([id], i) => [id, i]));
}

export function projectPublicTracker(
  posts: readonly InternalSharePost[],
  cfg: ProjectionConfig,
): PublicTrackerView {
  const blocks = new Set(blocksForAudience(cfg.blocks, cfg.audience));
  const anon = anonymousIndexes(posts);
  const creatorOf = (p: InternalSharePost): PublicCreatorRef => {
    // Lien de créatrice : tout est à elle, la répéter sur chaque ligne n'apprend
    // rien — et ne rien écrire est le plus sûr.
    if (cfg.audience === "creator") return null;
    if (p.creatorId === null) return null;
    if (cfg.showCreatorNames && p.creatorName !== null) {
      return { kind: "named", name: p.creatorName };
    }
    return { kind: "anonymous", index: anon.get(p.creatorId) ?? 0 };
  };

  // ── Chiffres clés : même formule que computeGlobalStats (lib/tracker-data),
  //    répliquée ici parce que convex/ n'importe pas lib/ (A6). Le taux se lit
  //    hors chauffe, sauf quand la chauffe EST l'objet mesuré.
  const wantsKpi =
    blocks.has("kpi_views") ||
    blocks.has("kpi_likes") ||
    blocks.has("kpi_comments") ||
    blocks.has("kpi_engagement");
  let kpi: PublicTrackerView["kpi"] = null;
  if (wantsKpi) {
    const ratioMode: WarmupMode = cfg.warmup === "only" ? "only" : "exclude";
    let vues = 0, likes = 0, comments = 0, rVues = 0, rInter = 0;
    for (const p of posts) {
      vues += p.vues;
      likes += p.likes;
      comments += p.comments;
      if (passesWarmupMode(p.isWarmup, ratioMode)) {
        rVues += p.vues;
        rInter += p.likes + p.comments;
      }
    }
    kpi = {};
    if (blocks.has("kpi_views")) kpi.views = vues;
    if (blocks.has("kpi_likes")) kpi.likes = likes;
    if (blocks.has("kpi_comments")) kpi.comments = comments;
    if (blocks.has("kpi_engagement")) {
      kpi.engagement = rVues > 0 ? rInter / rVues : null;
    }
  }

  let byPlatform: PublicTrackerView["byPlatform"] = null;
  if (blocks.has("by_platform")) {
    const m = new Map<string, number>();
    for (const p of posts) m.set(p.plateforme, (m.get(p.plateforme) ?? 0) + p.vues);
    byPlatform = [...m.entries()]
      .map(([label, vues]) => ({ label, vues }))
      .sort((a, b) => b.vues - a.vues);
  }

  let byCreator: PublicTrackerView["byCreator"] = null;
  if (blocks.has("by_creator")) {
    const m = new Map<string, { ref: PublicCreatorRef; vues: number }>();
    for (const p of posts) {
      const key = p.creatorId ?? "";
      const cur = m.get(key) ?? { ref: creatorOf(p), vues: 0 };
      cur.vues += p.vues;
      m.set(key, cur);
    }
    byCreator = [...m.values()]
      .map(({ ref, vues }) => ({ creator: ref, vues }))
      .sort((a, b) => b.vues - a.vues);
  }

  const videoOf = (p: InternalSharePost) => {
    if (!cfg.playableVideos || p.postUrl === null) return null;
    if (p.plateforme !== "TikTok") return null;
    const id = tiktokVideoIdFromUrl(p.postUrl);
    return id === null ? null : { platform: "tiktok" as const, id };
  };

  let publicPosts: PublicTrackerView["posts"] = null;
  if (blocks.has("posts")) {
    publicPosts = [...posts]
      .sort((a, b) => b.vues - a.vues || b.datePubli - a.datePubli)
      .slice(0, PUBLIC_POSTS_LIMIT)
      .map((p) => ({
        label: p.label,
        plateforme: p.plateforme,
        datePubli: p.datePubli,
        vues: p.vues,
        likes: p.likes,
        comments: p.comments,
        url: cfg.postLinks ? p.postUrl : null,
        video: videoOf(p),
        creator: creatorOf(p),
      }));
  }

  return { postCount: posts.length, kpi, byPlatform, byCreator, posts: publicPosts };
}

// ─── Jeton ──────────────────────────────────────────────────────────────────

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Jeton d'URL : 22 caractères base62 ≈ 131 bits d'aléa, assez court pour une
 * URL qu'on colle dans WhatsApp, impossible à deviner. Le léger biais du modulo
 * (256 % 62) coûte moins d'un bit sur l'ensemble.
 */
export function newShareToken(): string {
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
