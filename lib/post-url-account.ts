/**
 * Vérification CLIENT du compte dans une URL de post vs le compte cible attendu —
 * garde-fou de saisie admin (« coller le lien à la place de la créatrice »). Une
 * URL d'un AUTRE compte attribuerait/paierait les mauvaises vues (les vues sont
 * scrapées depuis l'URL). Best-effort : le handle N'EST PAS toujours dans l'URL.
 *   - TikTok : `/@handle/video/…` → fiable. Shortlink `vm.`/`vt.tiktok.com` → PAS
 *     de handle et résolution = action serveur ASYNC → NON VÉRIFIABLE (explicite).
 *   - Instagram : `/p|/reel/…` → pas de handle ; `/username/…` → handle.
 *   - YouTube : `/watch`,`/shorts`,`youtu.be` → pas de handle ; `/@handle` → handle.
 *
 * JAMAIS de blocage : renvoie un STATUT (match / mismatch / unverifiable) pour un
 * AVERTISSEMENT — un silence se lirait comme une validation. Pur, testé Vitest.
 */

export type UrlPlateforme = "TikTok" | "Instagram" | "YouTube";

/** Handle normalisé pour comparaison : sans `@`, minuscule, trim. */
function normHandle(h: string): string {
  return h.trim().replace(/^@+/, "").toLowerCase();
}

/** Shortlink TikTok (vm./vt.tiktok.com) — aucun handle, résolution serveur async. */
export function isTikTokShortlink(url: string): boolean {
  return /^https?:\/\/(vm|vt)\.tiktok\.com\//i.test(url.trim());
}

/**
 * Handle extrait d'une URL de POST, ou null si absent/non extractible.
 * TikTok/YouTube : segment `/@handle`. Instagram : 1er segment de chemin SAUF si
 * c'est une racine de post (p/reel/reels/tv/stories/explore) → alors pas de handle.
 */
export function handleFromPostUrl(
  url: string,
  platform: UrlPlateforme,
): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const atSeg = u.pathname.match(/\/@([^/?#]+)/);
  if (platform === "TikTok" || platform === "YouTube") {
    return atSeg ? normHandle(atSeg[1]) : null;
  }
  // Instagram
  if (atSeg) return normHandle(atSeg[1]);
  const seg = u.pathname.split("/").filter(Boolean);
  if (seg.length === 0) return null;
  const POST_ROOTS = new Set([
    "p",
    "reel",
    "reels",
    "tv",
    "stories",
    "explore",
  ]);
  if (POST_ROOTS.has(seg[0].toLowerCase())) return null;
  return normHandle(seg[0]);
}

export type AccountUrlStatus = "match" | "mismatch" | "unverifiable";

export interface AccountUrlCheck {
  status: AccountUrlStatus;
  /** Handle détecté dans l'URL (normalisé), ou null. */
  detected: string | null;
  /** Handle attendu (compte cible), normalisé, ou null. */
  expected: string | null;
  /** Pourquoi `unverifiable` (jamais un silence). */
  reason?: "shortlink" | "no-handle-in-url" | "no-expected" | "empty";
}

/**
 * Confronte l'URL au compte attendu → `match` / `mismatch` / `unverifiable`. Un
 * shortlink ou une plateforme sans handle donne un `unverifiable` EXPLICITE (avec
 * `reason`), jamais un faux « ok » silencieux. Avertissement, jamais blocage.
 */
export function accountUrlCheck(
  url: string,
  platform: UrlPlateforme,
  expectedHandle: string | null | undefined,
): AccountUrlCheck {
  const expected = expectedHandle ? normHandle(expectedHandle) : null;
  if (url.trim() === "") {
    return { status: "unverifiable", detected: null, expected, reason: "empty" };
  }
  if (isTikTokShortlink(url)) {
    return {
      status: "unverifiable",
      detected: null,
      expected,
      reason: "shortlink",
    };
  }
  const detected = handleFromPostUrl(url, platform);
  if (detected === null) {
    return {
      status: "unverifiable",
      detected: null,
      expected,
      reason: "no-handle-in-url",
    };
  }
  if (expected === null) {
    return {
      status: "unverifiable",
      detected,
      expected: null,
      reason: "no-expected",
    };
  }
  return {
    status: detected === expected ? "match" : "mismatch",
    detected,
    expected,
  };
}
