/**
 * Lecture des ARGUMENTS des outils MCP d'écriture (pur, sans base) : les usages,
 * catégories et colonnes s'écrivent comme à l'écran ou par leur code ; les
 * montants à la française ; les jours en AAAA-MM-JJ ; une créatrice, un compte,
 * une campagne ou une brique par son nom (`designer`).
 */

import type { ChargeCategory, ComptaBucket, TransferUsage } from "./comptaMath";
import { PLATEFORMES, type Plateforme } from "./platforms";
import { tiktokVideoIdFromUrl } from "./postUrlDate";
import { formatPostWindow, isValidPostWindow, POST_WINDOW_PRESETS, type PostWindow } from "./postWindow";

/** Sans accents, sans casse, espaces réduits : « Paiement Créatrices » = « paiement creatrices ». */
export const plierTexte = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const USAGES: Record<TransferUsage, readonly string[]> = {
  pay: ["remuneration", "paie", "ma paie"],
  creators: ["paiement createurs", "paiement creatrices", "createurs", "creatrices"],
  provision: ["mise de cote", "mise de cote (impots, urssaf)", "impots", "urssaf"],
  business: ["charges de l'activite", "charge de l'activite", "depense", "charges"],
  recover: ["a recuperer", "a recuperer (bloque, en transit)", "bloque", "en transit"],
  other: ["autre"],
};
const CATEGORIES: Record<ChargeCategory, readonly string[]> = {
  hosting: ["hebergement"],
  tools: ["outils", "outil"],
  subscriptions: ["abonnements", "abonnement"],
  ads: ["publicite", "pub"],
  scans: ["scans", "scan"],
  other: ["autre"],
};
const COLONNES: Record<ComptaBucket, readonly string[]> = {
  gross: ["ca brut", "chiffre d'affaires"],
  refunds: ["remboursements", "remboursement"],
  disputes: ["litiges", "litige"],
  fees: ["frais whop", "frais"],
  transfers: ["virements", "virements vers la banque", "virement"],
  internal: ["mouvements internes", "mouvements internes (hors resultat)", "interne"],
};

function depuis<K extends string>(table: Record<K, readonly string[]>, texte: unknown): K | null {
  if (typeof texte !== "string") return null;
  const t = plierTexte(texte);
  for (const [code, libelles] of Object.entries(table) as [K, readonly string[]][]) {
    if (t === code || libelles.includes(t)) return code;
  }
  return null;
}

/** Un usage de part de virement, écrit comme à l'écran ou par son code. */
export const usageDepuis = (texte: unknown): TransferUsage | null => depuis(USAGES, texte);
/** Une catégorie de charge, écrite comme à l'écran ou par son code. */
export const categorieDepuis = (texte: unknown): ChargeCategory | null => depuis(CATEGORIES, texte);
/** Une colonne du grand livre, écrite comme à l'écran ou par son code. */
export const colonneDepuis = (texte: unknown): ComptaBucket | null => depuis(COLONNES, texte);

/** Un montant : nombre, ou texte à la française (« 1 337,49 », « 1337.49 »). */
export function montantDepuis(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x !== "string" || x.trim() === "") return null;
  const n = Number(x.replace(/[\s  €$]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Un jour AAAA-MM-JJ ; absent = aujourd'hui (Paris). */
export function jourDepuis(x: unknown, aujourdhui: string): string | null {
  if (x === undefined || x === null || x === "") return aujourdhui;
  return typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.trim()) ? x.trim() : null;
}

/** « 1337,49 EUR » : lisible au journal, sans dépendre de la locale du runtime. */
export const montantTexte = (n: number, devise: string) =>
  `${n.toFixed(2).replace(".", ",")} ${devise.toUpperCase()}`;

export const LIBELLE_COLONNE: Record<ComptaBucket, string> = {
  gross: "CA brut",
  refunds: "remboursements",
  disputes: "litiges",
  fees: "frais Whop",
  transfers: "virements",
  internal: "mouvements internes",
};

/** « 05/09/2025 » : un jour AAAA-MM-JJ, lisible au journal. */
export const jourTexte = (day: string) => {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
};

// ─── Missions, scripts, publications ────────────────────────────────────────

/**
 * UN élément désigné par son NOM, comme Claude l'a lu dans un outil de lecture :
 * le nom exact d'abord (accents, casse et `@` de tête ignorés), sinon un morceau
 * qui n'en désigne qu'UN. Jamais de choix au hasard entre deux candidats : ils
 * reviennent à l'appelant, qui les cite dans son refus.
 */
export function designer<T>(
  items: readonly T[],
  nomDe: (t: T) => string,
  demande: string,
): { ok: true; item: T } | { ok: false; candidats: T[] } {
  const plie = (s: string) => plierTexte(s).replace(/^@/, "");
  const q = plie(demande);
  if (q === "") return { ok: false, candidats: [] };
  const exacts = items.filter((t) => plie(nomDe(t)) === q);
  if (exacts.length === 1) return { ok: true, item: exacts[0] };
  if (exacts.length > 1) return { ok: false, candidats: exacts };
  const proches = items.filter((t) => plie(nomDe(t)).includes(q));
  return proches.length === 1 ? { ok: true, item: proches[0] } : { ok: false, candidats: proches };
}

const PLAGES_NOMMEES: Record<string, PostWindow> = Object.fromEntries(
  POST_WINDOW_PRESETS.flatMap((p) => {
    const noms = p.id === "apresmidi" ? ["apresmidi", "apres-midi"] : [p.id];
    return noms.map((n) => [n, p.window] as const);
  }),
);

/**
 * Une PLAGE HORAIRE de publication : « 21h-23h », « 21:00-23:00 », « 21h30 à
 * 23h », ou un créneau de l'écran (« midi », « après-midi », « soir »).
 * « aucune » efface. `null` = illisible ou invalide (début après la fin) — jamais
 * une plage devinée, qui s'afficherait telle quelle à la créatrice.
 */
export function plageDepuis(x: unknown): PostWindow | "aucune" | null {
  if (typeof x !== "string") return null;
  const t = plierTexte(x);
  if (t === "aucune" || t === "aucun" || t === "sans") return "aucune";
  const nommee = PLAGES_NOMMEES[t.replace(/\s/g, "")];
  if (nommee) return nommee;
  const m = /^(?:de\s*)?(\d{1,2})\s*(?:[h:]\s*(\d{2})?)?\s*(?:-|–|a)\s*(\d{1,2})\s*(?:[h:]\s*(\d{2})?)?$/.exec(t);
  if (!m) return null;
  const w = {
    startMin: Number(m[1]) * 60 + Number(m[2] ?? 0),
    endMin: Number(m[3]) * 60 + Number(m[4] ?? 0),
  };
  return Number(m[2] ?? 0) < 60 && Number(m[4] ?? 0) < 60 && isValidPostWindow(w) ? w : null;
}

/** « 21h-23h » : une plage, lisible au journal (la forme de l'écran admin). */
export const plageTexte = (w: PostWindow) => formatPostWindow(w) ?? "";

const PLATEFORMES_ALIAS: Record<string, Plateforme> = {
  tiktok: "TikTok",
  tt: "TikTok",
  instagram: "Instagram",
  insta: "Instagram",
  ig: "Instagram",
  youtube: "YouTube",
  yt: "YouTube",
  shorts: "YouTube",
  facebook: "Facebook",
  fb: "Facebook",
  snapchat: "Snapchat",
  snap: "Snapchat",
};

/** Une plateforme, écrite comme à l'écran ou en abrégé (« insta », « YT »). */
export function plateformeDepuis(x: unknown): Plateforme | null {
  if (typeof x !== "string") return null;
  const t = plierTexte(x).replace(/\s/g, "");
  return PLATEFORMES_ALIAS[t] ?? PLATEFORMES.find((p) => p.toLowerCase() === t) ?? null;
}

/** Le contenu d'une mission : promo, ou warmup (« chauffe »). */
export function typeContenuDepuis(x: unknown): "promo" | "warmup" | null {
  if (typeof x !== "string") return null;
  const t = plierTexte(x);
  if (t === "promo" || t === "promotion") return "promo";
  if (t === "warmup" || t === "chauffe" || t === "warm-up") return "warmup";
  return null;
}

/** Le rôle d'une brique de script : hook, flux ou cta. */
export function roleBriqueDepuis(x: unknown): "hook" | "flux" | "cta" | null {
  if (typeof x !== "string") return null;
  const t = plierTexte(x);
  if (t === "hook" || t === "hooks" || t === "accroche") return "hook";
  if (t === "flux" || t === "corps") return "flux";
  if (t === "cta" || t === "appel a l'action") return "cta";
  return null;
}

/**
 * La CLÉ d'un post dans un lien — pour retrouver une publication par le lien que
 * Claude a lu (outils `meilleurs_posts`, `validation`) quelle qu'en soit la
 * forme : l'id TikTok, le shortcode Instagram (/reel/ et /p/ confondus), l'id
 * YouTube (shorts, watch, youtu.be) ; sinon l'adresse sans paramètres, sans
 * `www.` ni `/` final. `null` = pas un lien.
 */
export function cleDeLienPost(url: string): string | null {
  const brut = url.trim();
  const tiktok = tiktokVideoIdFromUrl(brut);
  if (tiktok) return `tiktok:${tiktok}`;
  let u: URL;
  try {
    u = new URL(brut);
  } catch {
    return null;
  }
  const hote = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (hote === "instagram.com") {
    const m = /^\/(?:[^/]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/.exec(u.pathname);
    if (m) return `instagram:${m[1]}`;
  }
  if (hote === "youtube.com" || hote === "youtu.be") {
    const id =
      hote === "youtu.be"
        ? u.pathname.slice(1).split("/")[0]
        : (/^\/shorts\/([A-Za-z0-9_-]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get("v"));
    if (id) return `youtube:${id}`;
  }
  return `${hote}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
}
