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

export const PRODUCT_KINDS = ["app", "saas", "jeu_mobile", "jeu", "ecommerce", "marque", "media", "autre"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const ABOUT = ["oui", "non", "incertain"] as const;
export type About = (typeof ABOUT)[number];

/** Le jugement d'une app : numérique ou non, son type, et si ses créateurs parlent bien de CE produit. */
export type AppNature = { digital: boolean; kind: ProductKind; aboutIt: About; why: string };

/**
 * DÉFINITION du fondateur (14/11/2026) : Swarm montre les apps, les SaaS et les jeux MOBILES — pas l'e-commerce
 * (agents d'achat comme Hipobuy), ni les marques physiques, les médias, les jeux console ou PC. Une app pas encore
 * jugée reste montrée (absent n'est pas exclu). Lu à partir de la phase B ; la phase A ne fait que juger.
 */
export const SWARM_KINDS: readonly ProductKind[] = ["app", "saas", "jeu_mobile"];
export const shownInSwarm = (nature: Pick<AppNature, "digital" | "kind"> | null | undefined): boolean =>
  !nature || (nature.digital && SWARM_KINDS.includes(nature.kind));

export const NATURE_BATCH = 20;
/** Une app jugée est rejugée au bout de 30 jours (ses comptes ont changé). */
export const NATURE_REFRESH_MS = 30 * DAY;
/**
 * La version des définitions données à l'IA. v2 (14/11/2026) : une app pour regarder des séries (FreeDrama, Shortical)
 * est une app, pas un « media » — le média, c'est le contenu lui-même. Un jugement d'une version d'avant est refait.
 */
export const NATURE_VERSION = 2;
export const natureDue = (app: { natureAt?: number; natureV?: number }, now: number): boolean =>
  app.natureAt === undefined || (app.natureV ?? 1) < NATURE_VERSION || now - app.natureAt >= NATURE_REFRESH_MS;

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
  '- kind: "app" (mobile app that is not a game — apps to watch series or videos, to read, to listen to music and social apps included), "saas" (web tool or software, AI tools used on the web included), "jeu_mobile" (game played on a phone, from the App Store or Google Play), "jeu" (any other video game: console, PC, browser), "ecommerce" (store, marketplace or shopping agent selling physical goods), "marque" (physical brand or product), "media" (the content itself or its outlet: a show, a film, a song, a podcast, a streamer, a news outlet — never the app or the site used to watch, read or listen to it), "autre".',
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
/** Le texte d'une vidéo qui cite l'app, plus long : coupé à 180, la citation tombait dans 27 cas sur 433 (0 à 400). */
const ACCOUNT_CITING_TEXT_MAX = 400;

export type AccountToJudge = {
  id: string;
  handle: string;
  bio: string;
  texts: string[];
  app: { name: string; searches: string[]; pitch?: string; store?: { genre: string; artist: string } };
  /** Ce que compte le filtre lexical : vidéos rangées qui citent l'app, la bio qui la nomme, et d'où vient le compte. */
  evidence: { cites: number; of: number; bioNames: boolean; source: "caption" | "seed" };
};

/**
 * La version des définitions et de ce qui est donné à lire. v2 (14/11/2026), après la relecture à la main des 125
 * premiers verdicts qui auraient agi (3 sur 10 faux) : l'IA lit d'abord les vidéos qui citent l'app (elle ne voyait
 * que les 10 dernières, souvent sans elles), avec leur décompte ; « placement » = une ou deux vidéos (définition du
 * fondateur : un créateur généraliste payé une ou deux fois) ; un nom absent des textes n'est pas « sans rapport ».
 * Un jugement d'une version d'avant ne compte plus : le compte est rejugé.
 */
export const JUDGE_VERSION = 2;

/** Où reprend le parcours des comptes : un parcours d'une version d'avant repart du début (tous rejugés). */
export const judgeCursorOf = (s: { judgeCursor?: string; judgeCursorV?: number } | null | undefined): string | null =>
  s && (s.judgeCursorV ?? 1) === JUDGE_VERSION ? (s.judgeCursor ?? null) : null;

/** Les comptes d'un passage rangés par app : un appel à l'IA ne mêle pas deux apps voisines quand il peut l'éviter. */
export const groupedByApp = <T extends { appId: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => (a.appId < b.appId ? -1 : a.appId > b.appId ? 1 : 0));

export const ACCOUNT_SYSTEM = [
  "You check whether a TikTok account promotes a given product (an app or a web tool).",
  "Each account comes with its own product: judge it only against that product, never against another account's product.",
  "Verdicts:",
  '- "pousse": the account posts about THIS product in several videos (three or more), or its bio names the product as its own, its partner or its link — the product\'s own account, an ambassador, a UGC creator paid repeatedly (partner or ambassador hashtags, a promo code, ad disclosures on the product\'s videos), even when it also posts other content.',
  '- "placement": a general creator whose videos are mostly about other things and who names the product in only one or two videos, usually paid. Three or more videos naming the product is never a placement.',
  '- "autre_app": the account promotes a different product, named in its texts or bio; give that one product\'s exact name as written, in "other". If that product is not named, answer "incertain".',
  '- "sans_rapport": the product\'s name or tag appears only with another meaning — an ordinary word in some language, a song, a person, a slang or genre hashtag — or the account clearly posts about something else and names the product at most once, without promoting it.',
  '- "incertain": the texts do not allow a decision. In particular, when the texts never name the product and the account was found through a list of the product\'s creators, answer "incertain": the product may appear only on screen in the videos.',
  "The evidence line counts the videos whose text contains the product's name or tag: check what each of them means, a match can be an ordinary word.",
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

type VideoText = { caption?: string | null; hook?: string | null };

/**
 * Ses textes à donner à lire : texte à l'écran et légende, propres, chacun une fois — D'ABORD ceux des vidéos qui
 * citent l'app (`cites`), puis les dernières. Avant (v1), seules les 10 dernières : une créatrice dont 4 vidéos sur 20
 * citent Fluencify était jugée « sans rapport » faute de les voir.
 */
export function accountTexts(videos: readonly VideoText[], max = ACCOUNT_TEXTS_MAX, cites?: (v: VideoText) => boolean): string[] {
  const citing = cites ? videos.filter((v) => cites(v)) : [];
  const ordered = cites ? [...citing, ...videos.filter((v) => !cites(v))] : videos;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of ordered) {
    const t = tidy([v.hook, v.caption].filter(Boolean).join(" — "), citing.includes(v) ? ACCOUNT_CITING_TEXT_MAX : ACCOUNT_TEXT_MAX);
    if (t.length < 3 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** La ligne de preuve donnée à lire : ce que le filtre lexical a compté, à vérifier par l'IA. */
export function evidenceLine(e: AccountToJudge["evidence"]): string {
  return [
    `${e.cites} of ${e.of} stored videos contain the product's name or tag (listed first)`,
    `bio names it: ${e.bioNames ? "yes" : "no"}`,
    `account found ${e.source === "seed" ? "through a list of the product's creators" : "through a video naming the product"}`,
  ].join("; ");
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
        `evidence: ${evidenceLine(a.evidence)}`,
        `videos (on-screen text — caption), those naming the product first, then the latest: ${a.texts.length ? quoted(a.texts) : "(none)"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

const isVerdict = (x: unknown): x is AccountVerdict => typeof x === "string" && (ACCOUNT_VERDICTS as readonly string[]).includes(x);

export type AccountJudgment = { id: string; verdict: AccountVerdict; other?: string; why: string };

/**
 * Le nom d'UNE app, tel qu'écrit : pas une liste (« StemUp, SimpleStudy »), pas une description (« web de révision TKA
 * (site non nommé) »). Sinon rien — et le verdict « autre app » devient « incertain » : une piste sans nom ne mène nulle part.
 */
export function productName(other: string): string {
  const x = other.trim();
  if (!x || x.length > 40 || /[,;/()]/.test(x) || /\b(non nomm|unnamed|unknown|inconnu|not named)/i.test(x) || x.split(/\s+/).length > 5) return "";
  return x;
}

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
    const other = x.verdict === "autre_app" ? productName(tidy(typeof x.other === "string" ? x.other : "", 60)) : "";
    const verdict: AccountVerdict = x.verdict === "autre_app" && !other ? "incertain" : x.verdict;
    out.push({ id, verdict, ...(other ? { other } : {}), why: tidy(typeof x.why === "string" ? x.why : "", WHY_MAX) });
  }
  return out;
}
