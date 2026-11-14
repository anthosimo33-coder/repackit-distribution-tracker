/**
 * RADAR — LE JUGEMENT SÉMANTIQUE DES APPS ET DES COMPTES (lot 4 du dig du 13/11, 14/11/2026). Règles pures, sans
 * dépendance à Jarvia : le moteur du Radar partira chez Swarm, ce module avec lui.
 *
 * Pourquoi : les règles lexicales (le nom de l'app est-il cité ?) ne disent pas QUI pousse le produit. Le 13/11,
 * 20 des 25 déchets d'un échantillon jugé à la main étaient encore « prouvés » sur leur page : homonymes (Solaia
 * Condos, menugo.pt), sujet d'actualité (#examencivique2026), fermes d'histoires (#rizzapp), app non suivie
 * (KakoBuy). Et des « apps » n'en sont pas : une salle d'escalade (Arkose+), un agent d'achat de vêtements (Hipobuy).
 *
 * PHASE A (cette version) : l'IA juge, RIEN N'AGIT. Le jugement de chaque app (`radarApps.nature`) et celui des
 * comptes à preuve faible (`radarAccountJudgments`) sont rangés à part, pour mesurer leur justesse (contre
 * l'échantillon jugé à la main du dig) et laisser le fondateur fixer les deux définitions qui décident ensuite :
 * quels types de produits Swarm montre, et ce qu'on fait d'un compte que l'IA dit sans rapport.
 */
import { cleanText } from "./radarSignalsMath";
import type { ProofDetail } from "./radarVetMath";

const DAY = 86_400_000;
const tidy = (x: string | null | undefined, max: number): string => cleanText((x ?? "").replace(/\s+/g, " ").trim(), max);
const quoted = (xs: readonly string[]): string => xs.map((x) => `"${x.replace(/"/g, "'")}"`).join(" | ");

// ─── Les apps : ce qu'est le produit ─────────────────────────────────────────

export const PRODUCT_KINDS = ["app", "saas", "jeu", "ecommerce", "marque", "media", "autre"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const ABOUT = ["oui", "non", "incertain"] as const;
export type About = (typeof ABOUT)[number];

/** Le jugement d'une app : numérique ou non, son type, et si ses créateurs parlent bien de CE produit. */
export type AppNature = { digital: boolean; kind: ProductKind; aboutIt: About; why: string };

export const NATURE_BATCH = 20;
/** Une app jugée est rejugée au bout de 30 jours (ses comptes ont changé). */
export const NATURE_REFRESH_MS = 30 * DAY;
export const natureDue = (app: { natureAt?: number }, now: number): boolean => app.natureAt === undefined || now - app.natureAt >= NATURE_REFRESH_MS;

export type NatureToJudge = {
  id: string;
  name: string;
  searches: string[];
  pitch?: string;
  store?: { genre: string; artist: string };
  market?: { productKind: "app" | "software"; about?: string };
  /** Ce qu'écrivent ses comptes ACTIFS (légendes et texte à l'écran), et leurs bios. */
  texts: string[];
  bios: string[];
};

export const NATURE_SYSTEM = [
  "You review products that short-form video creators promote, for a catalogue of mobile apps and web tools.",
  "For each product, answer from the evidence only:",
  "- digital: true when the product is software the user installs or opens (mobile app, web app, browser extension, desktop software, online service used through an app or a site); false for a physical product, a shop or marketplace of physical goods, a place (gym, restaurant, hotel), a person, a show, a song, a team.",
  '- kind: "app" (mobile app), "saas" (web tool or software, AI tools used on the web included), "jeu" (video game or game app), "ecommerce" (store, marketplace or shopping agent selling physical goods), "marque" (physical brand or product), "media" (show, series, film, music, podcast, streamer, news), "autre".',
  '- aboutIt: do the creators\' texts and bios talk about THIS product (the product itself, what it does, its publisher)? "oui"; "non" when the name only appears as an ordinary word, a song, a person, a genre hashtag, or another product; "incertain" when there is too little text.',
  "- why: one plain French sentence of at most 120 characters with the decisive clue (no brand-free paraphrase needed, no emoji).",
  "Never guess from the name alone. Answer for every product, using its id.",
].join("\n");

export const NATURE_SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          digital: { type: "boolean" },
          kind: { type: "string", enum: [...PRODUCT_KINDS] },
          aboutIt: { type: "string", enum: [...ABOUT] },
          why: { type: "string" },
        },
        required: ["id", "digital", "kind", "aboutIt", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["products"],
  additionalProperties: false,
} as const;

export function naturePrompt(batch: readonly NatureToJudge[]): string {
  return batch
    .map((a) =>
      [
        `id: ${a.id}`,
        `name: ${a.name}`,
        `search terms: ${a.searches.slice(0, 6).join(", ") || "(none)"}`,
        ...(a.pitch ? [`known summary: ${a.pitch}`] : []),
        ...(a.store ? [`app store: genre "${a.store.genre}", publisher "${a.store.artist}"`] : []),
        ...(a.market ? [`paid campaign (${a.market.productKind === "app" ? "mobile app" : "web software"}): ${a.market.about || "(no text)"}`] : []),
        `creators write: ${a.texts.length ? quoted(a.texts) : "(nothing read yet)"}`,
        ...(a.bios.length ? [`creator bios: ${quoted(a.bios)}`] : []),
      ].join("\n"),
    )
    .join("\n\n");
}

export const WHY_MAX = 140;
const isKind = (x: unknown): x is ProductKind => typeof x === "string" && (PRODUCT_KINDS as readonly string[]).includes(x);
const isAbout = (x: unknown): x is About => typeof x === "string" && (ABOUT as readonly string[]).includes(x);

/** La réponse ramenée à ce qu'on range : une ligne par app DEMANDÉE, des valeurs de la liste (sinon la ligne saute). */
export function natureAnswer(raw: unknown, batch: readonly { id: string }[]): { id: string; nature: AppNature }[] {
  const asked = new Set(batch.map((a) => a.id));
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { products?: unknown }).products) ? (raw as { products: unknown[] }).products : [];
  const out: { id: string; nature: AppNature }[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const id = typeof x.id === "string" ? x.id : "";
    if (!asked.has(id) || typeof x.digital !== "boolean" || !isKind(x.kind) || !isAbout(x.aboutIt)) continue;
    asked.delete(id);
    out.push({ id, nature: { digital: x.digital, kind: x.kind, aboutIt: x.aboutIt, why: tidy(typeof x.why === "string" ? x.why : "", WHY_MAX) } });
  }
  return out;
}

// ─── Les comptes : pousse-t-il CE produit ? ──────────────────────────────────

/**
 * Pourquoi la preuve d'un compte est faible — mesuré par le dig sur 160 comptes jugés à la main : bio + vidéos 100 %
 * de justes, vidéos ≥ 50 % 89 %, pseudo + vidéos 88 %, vidéos < 30 % 19 %. Un compte ajouté à la main n'est jamais
 * jugé (c'est un choix humain).
 */
export type WeakWhy = "aucune" | "liste_non_prouvee" | "pseudo_seul" | "bio_seule" | "videos_minoritaires";
export const WEAK_SHARE = 0.5;

export function weakProof(d: ProofDetail, matchedBy: "caption" | "manual" | "seed"): WeakWhy | null {
  if (matchedBy === "manual") return null;
  if (d.by === null) return "aucune";
  if (d.by === "seed") return "liste_non_prouvee";
  if (d.by === "manual") return null;
  if (d.by === "handle" && d.cites === 0) return "pseudo_seul";
  if (d.by === "bio" && d.cites === 0) return "bio_seule";
  if (d.by === "videos" && d.of > 0 && d.cites / d.of < WEAK_SHARE) return "videos_minoritaires";
  return null;
}

export const ACCOUNT_VERDICTS = ["pousse", "autre_app", "sans_rapport", "placement", "incertain"] as const;
export type AccountVerdict = (typeof ACCOUNT_VERDICTS)[number];
export const ACCOUNT_BATCH = 12;
export const ACCOUNT_TEXTS_MAX = 10;
const ACCOUNT_TEXT_MAX = 180;

export type AccountToJudge = {
  id: string;
  handle: string;
  bio: string;
  texts: string[];
  app: { name: string; searches: string[]; pitch?: string; store?: { genre: string; artist: string } };
};

export const ACCOUNT_SYSTEM = [
  "You check whether a TikTok account promotes a given product (an app or a web tool).",
  "Verdicts:",
  '- "pousse": the account repeatedly posts about THIS product — its own account, an ambassador or UGC creator, or a creator whose videos show or name the product.',
  '- "autre_app": the account promotes a different product, often with a similar name; give that product\'s name in "other".',
  '- "sans_rapport": the product\'s name appears only as an ordinary word, a song, a person, a genre hashtag, or not at all; the account does not promote the product.',
  '- "placement": a general creator who mentions the product once in a paid placement, among unrelated content.',
  '- "incertain": the texts do not allow a decision.',
  "why: one plain French sentence of at most 120 characters with the decisive clue.",
  "Use only the evidence given. Answer for every account, using its id.",
].join("\n");

export const ACCOUNT_SCHEMA = {
  type: "object",
  properties: {
    accounts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: [...ACCOUNT_VERDICTS] },
          other: { type: "string" },
          why: { type: "string" },
        },
        required: ["id", "verdict", "other", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["accounts"],
  additionalProperties: false,
} as const;

/** Ses textes à donner à lire : texte à l'écran et légende de ses dernières vidéos, propres, chacun une fois. */
export function accountTexts(videos: readonly { caption?: string | null; hook?: string | null }[], max = ACCOUNT_TEXTS_MAX): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of videos) {
    const t = tidy([v.hook, v.caption].filter(Boolean).join(" — "), ACCOUNT_TEXT_MAX);
    if (t.length < 3 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function accountPrompt(batch: readonly AccountToJudge[]): string {
  return batch
    .map((a) =>
      [
        `id: ${a.id}`,
        `product: ${a.app.name}${a.app.pitch ? ` — ${a.app.pitch}` : ""}`,
        ...(a.app.store ? [`product app store: genre "${a.app.store.genre}", publisher "${a.app.store.artist}"`] : []),
        `product search terms: ${a.app.searches.slice(0, 6).join(", ") || "(none)"}`,
        `account: @${a.handle}`,
        `bio: ${a.bio ? quoted([tidy(a.bio, 200)]) : "(empty)"}`,
        `latest videos (on-screen text — caption): ${a.texts.length ? quoted(a.texts) : "(none)"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

const isVerdict = (x: unknown): x is AccountVerdict => typeof x === "string" && (ACCOUNT_VERDICTS as readonly string[]).includes(x);

export type AccountJudgment = { id: string; verdict: AccountVerdict; other?: string; why: string };

export function accountAnswer(raw: unknown, batch: readonly { id: string }[]): AccountJudgment[] {
  const asked = new Set(batch.map((a) => a.id));
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { accounts?: unknown }).accounts) ? (raw as { accounts: unknown[] }).accounts : [];
  const out: AccountJudgment[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const id = typeof x.id === "string" ? x.id : "";
    if (!asked.has(id) || !isVerdict(x.verdict)) continue;
    asked.delete(id);
    const other = x.verdict === "autre_app" ? tidy(typeof x.other === "string" ? x.other : "", 60) : "";
    out.push({ id, verdict: x.verdict, ...(other ? { other } : {}), why: tidy(typeof x.why === "string" ? x.why : "", WHY_MAX) });
  }
  return out;
}
