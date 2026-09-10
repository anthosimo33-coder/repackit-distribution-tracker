/**
 * Batch F — autodétection plateforme + type pour le pilier VEILLE.
 *
 * Pure logic, zero dépendance — tested in lib/inspiration-url.test.ts via
 * Vitest. L'override manuel côté UI (modal InspirationDialog) prend le
 * pas si la détection retourne null OU si l'utilisateur clique sur
 * "Modifier" pour forcer une autre classification.
 *
 * Patterns évalués dans l'ordre du plus spécifique au plus général. La
 * regex "account" finale n'est testée qu'après les regex video, donc une
 * URL `instagram.com/p/xyz` est correctement classée video et n'atteint
 * jamais la regex account (qui exclut quand même /p/, /reel/, /stories/,
 * /tv/, /explore/, /accounts/ via lookahead négatif par sécurité).
 */

export type InspirationType = "video" | "account";
export type Plateforme = "TikTok" | "Instagram" | "YouTube";

type Pattern = {
  regex: RegExp;
  plateforme: Plateforme;
  type: InspirationType;
};

// Ordre critique : du plus spécifique au plus général. Le `i` flag rend les
// patterns insensibles à la casse pour le domaine (TikTok.com == tiktok.com).
const PATTERNS: Pattern[] = [
  // TikTok video — /@user/video/123. Couvre www.tiktok.com et m.tiktok.com.
  {
    regex: /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[^/]+\/video\/\d+/i,
    plateforme: "TikTok",
    type: "video",
  },
  // TikTok carrousel PHOTO — /@user/photo/123. C'est un post, pas un profil.
  {
    regex: /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[^/]+\/photo\/\d+/i,
    plateforme: "TikTok",
    type: "video",
  },
  // TikTok shortlinks — vm./vt.tiktok.com ET tiktok.com/t/<code>, la forme que
  // rend « Copier le lien » dans l'app iOS. Cette dernière manquait : la garde
  // client refusait des liens TikTok en les annonçant non-TikTok (2026-09-03).
  // Même famille que `isTikTokShortlink` (convex/postUrlDate.ts), qui la connaît
  // depuis l'espace clippeur. Pointent quasi toujours vers une vidéo.
  {
    regex:
      /^https?:\/\/(?:(?:vm|vt)\.tiktok\.com\/|(?:www\.)?tiktok\.com\/t\/)[A-Za-z0-9]+/i,
    plateforme: "TikTok",
    type: "video",
  },
  // TikTok — ancien lien mobile /v/<id>.html, encore servi par des partages.
  {
    regex: /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/v\/\d+/i,
    plateforme: "TikTok",
    type: "video",
  },
  // TikTok account — /@user sans /video/.
  {
    regex: /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[^/?#]+\/?(?:\?|#|$)/i,
    plateforme: "TikTok",
    type: "account",
  },
  // Instagram reel/post.
  {
    regex:
      /^https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p)\/[A-Za-z0-9_-]+/i,
    plateforme: "Instagram",
    type: "video",
  },
  // Instagram PARTAGE — /share/<code> et /share/reel/<code>, la forme que rend
  // « Copier le lien » dans l'app depuis 2024. Testée AVANT le pattern account,
  // sinon « share » se lirait comme un nom d'utilisateur.
  {
    regex:
      /^https?:\/\/(?:www\.)?instagram\.com\/share\/(?:reel|reels|p)?\/?[A-Za-z0-9_-]+/i,
    plateforme: "Instagram",
    type: "video",
  },
  // Instagram account avec exclusion explicite des paths réservés (par
  // sécurité, même si les patterns video ci-dessus matchent en premier).
  {
    regex:
      /^https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|reels\/|stories\/|tv\/|explore\/|accounts\/|share\/)[A-Za-z0-9_.]+\/?(?:\?|#|$)/i,
    plateforme: "Instagram",
    type: "account",
  },
  // YouTube Short.
  {
    regex: /^https?:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/[A-Za-z0-9_-]+/i,
    plateforme: "YouTube",
    type: "video",
  },
  // YouTube long video — /watch?…v=… . `v` n'est PAS toujours le premier
  // paramètre : l'app Android rend /watch?app=desktop&v=… .
  {
    regex:
      /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=[A-Za-z0-9_-]+/i,
    plateforme: "YouTube",
    type: "video",
  },
  // YouTube — /live/<id> (rediffusion d'un direct, servie comme une vidéo).
  {
    regex: /^https?:\/\/(?:www\.|m\.)?youtube\.com\/live\/[A-Za-z0-9_-]+/i,
    plateforme: "YouTube",
    type: "video",
  },
  // youtu.be shortlink.
  {
    regex: /^https?:\/\/youtu\.be\/[A-Za-z0-9_-]+/i,
    plateforme: "YouTube",
    type: "video",
  },
  // YouTube account — @handle, channel/UC..., c/legacy, user/legacy.
  {
    regex:
      /^https?:\/\/(?:www\.)?youtube\.com\/(?:@[^/?#]+|channel\/[A-Za-z0-9_-]+|c\/[^/?#]+|user\/[^/?#]+)/i,
    plateforme: "YouTube",
    type: "account",
  },
];

/**
 * Trim et lowercase du domaine. Les pathnames restent intacts car les
 * usernames Instagram peuvent être case-sensitive sur certaines surfaces.
 * Les regex ci-dessus utilisent le flag `i`, donc en pratique
 * normalizeUrl est surtout utile pour trim les whitespace de copier-coller.
 */
export function normalizeUrl(url: string): string {
  return url.trim();
}

export function detectInspirationType(
  url: string,
): { plateforme: Plateforme; type: InspirationType } | null {
  const normalized = normalizeUrl(url);
  if (normalized.length === 0) return null;
  for (const p of PATTERNS) {
    if (p.regex.test(normalized)) {
      return { plateforme: p.plateforme, type: p.type };
    }
  }
  return null;
}
