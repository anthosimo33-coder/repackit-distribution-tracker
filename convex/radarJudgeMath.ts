/**
 * RADAR — LE JUGEMENT SÉMANTIQUE DES APPS ET DES COMPTES (lot 4 du dig du 13/11, 14/11/2026). Règles pures, sans
 * dépendance à Jarvia : le moteur du Radar partira chez Swarm, ce module avec lui.
 *
 * Pourquoi : les règles lexicales (le nom de l'app est-il cité ?) ne disent pas QUI pousse le produit. Le 13/11,
 * 20 des 25 déchets d'un échantillon jugé à la main étaient encore « prouvés » sur leur page : homonymes (Solaia
 * Condos, menugo.pt), sujet d'actualité (#examencivique2026), fermes d'histoires (#rizzapp), app non suivie
 * (KakoBuy). Et des « apps » n'en sont pas : une salle d'escalade (Arkose+), un agent d'achat de vêtements (Hipobuy).
 *
 * PHASE A (#511) : l'IA juge, rangé à part (`radarApps.nature`, `radarAccountJudgments`).
 * PHASE B : les jugements agissent, selon les deux définitions du fondateur du 14/11/2026 — ce que le Radar et
 * Swarm gardent (`outOfScope`), et le sort d'un compte selon son verdict (`verdictAction`).
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
 * DÉFINITION du fondateur (14/11/2026) : le Radar et Swarm ne gardent que les apps, les SaaS et les jeux MOBILES —
 * pas l'e-commerce (agents d'achat comme Hipobuy), ni les marques physiques, les médias, les jeux console ou PC.
 *
 * La qualité d'abord : une app n'est écartée que sur un verdict NET, c'est-à-dire quand l'IA dit que ses créateurs
 * parlent bien de CE produit (`aboutIt` « oui ») ET qu'il est hors périmètre. Rejoué sur la prod le 14/11 :
 *  - quand ses créateurs parlent d'autre chose (« non »), l'IA décrit ce dont ils parlent, pas le produit — Umax
 *    (looksmaxxing) et Airbuds (partage de musique) sortaient « non numériques ». C'est le réseau qui est faux, et il
 *    se juge compte par compte ;
 *  - sans texte (« incertain »), ou rangée « autre » mais numérique : elle reste (Crush Tracker, Snitch) ;
 *  - une app qui a sa fiche App Store est numérique : seule l'e-commerce peut l'écarter (un agent d'achat a son app).
 */
export const SWARM_KINDS: readonly ProductKind[] = ["app", "saas", "jeu_mobile"];
export const EXCLUDED_KINDS: readonly ProductKind[] = ["jeu", "ecommerce", "marque", "media"];
export function outOfScope(nature: Pick<AppNature, "digital" | "kind" | "aboutIt"> | null | undefined, hasStore = false): boolean {
  if (!nature || nature.aboutIt !== "oui") return false;
  if (hasStore) return nature.kind === "ecommerce";
  return !nature.digital || EXCLUDED_KINDS.includes(nature.kind);
}
export const shownInSwarm = (nature: Pick<AppNature, "digital" | "kind" | "aboutIt"> | null | undefined, hasStore = false): boolean => !outOfScope(nature, hasStore);

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
  /** `about` : ce qu'est le produit d'après son jugement (`radarApps.nature.why`), quand il n'a pas de phrase connue. */
  app: { name: string; searches: string[]; pitch?: string; about?: string; store?: { genre: string; artist: string } };
  /**
   * Ce que compte le filtre lexical : vidéos rangées qui citent l'app, celles qui portent une mention de pub ou de
   * partenariat (`ads`) ou un hashtag de campagne numéroté (`codes`, #4601), la bio qui la nomme, d'où vient le compte.
   */
  evidence: { cites: number; of: number; ads: number; codes: number; bioNames: boolean; source: "caption" | "seed" };
};

/**
 * Une mention de pub ou de partenariat, dans les langues du Radar (relecture du 15/11/2026 : le réseau d'Astra AI marque
 * presque chaque vidéo « adv », « publi », « anzeige », sans toujours nommer l'app, qui est à l'écran). « ad » seul ne
 * compte qu'en fin de légende ou devant un hashtag : en italien, « ad » est une préposition.
 */
const AD_WORDS =
  /(^|[^\p{L}\p{N}])(#ad|adv|advert\p{L}*|anzeige|werbung|publi|pu+bli+|publicidad|publicidade|publicit[ée]|pubblicit[àa]|sponsored|sponsoris[ée]e?|patrocinad[oa]|reklama|paid partnership)(?=$|[^\p{L}\p{N}])/iu;
const AD_LAST = /(^|\s)ad(?=\s*(#|$))/iu;
const PARTNER_TAG = /#[\p{L}\p{N}]*(partner|ambassador|ambassadeur|ambassadrice|embajador\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
export const adDisclosed = (text: string): boolean => AD_WORDS.test(text) || AD_LAST.test(text) || PARTNER_TAG.test(text);
/** Un hashtag de campagne numéroté (#4601, #8544, #9999) ; pas une année (#2026, #1998). */
export const campaignCoded = (text: string): boolean => /#(?!19\d\d|20\d\d)\d{4}(?!\p{N})/u.test(text);

/**
 * La version des définitions et de ce qui est donné à lire. v2 (14/11/2026), après la relecture à la main des 125
 * premiers verdicts qui auraient agi (3 sur 10 faux) : l'IA lit d'abord les vidéos qui citent l'app (elle ne voyait
 * que les 10 dernières, souvent sans elles), avec leur décompte ; « placement » = une ou deux vidéos (définition du
 * fondateur : un créateur généraliste payé une ou deux fois) ; un nom absent des textes n'est pas « sans rapport ».
 * Un jugement d'une version d'avant ne compte plus : le compte est rejugé.
 */
/**
 * v3 (15/11/2026), après la relecture de 227 actions v2 (~15 % fausses) : la preuve compte aussi les mentions de pub et
 * les hashtags de campagne (un créateur UGC payé à répétition n'est ni un placement ni « sans rapport », même s'il ne
 * nomme l'app qu'une fois) ; un compte qui pousse son produit ET un autre est « pousse », l'autre noté dans `other` ;
 * le produit est décrit par son jugement quand il n'a pas de phrase connue (« #love8 » pris pour un simple hashtag).
 */
export const JUDGE_VERSION = 3;

/** Où reprend le parcours des comptes : un parcours d'une version d'avant repart du début (tous rejugés). */
export const judgeCursorOf = (s: { judgeCursor?: string; judgeCursorV?: number } | null | undefined): string | null =>
  s && (s.judgeCursorV ?? 1) === JUDGE_VERSION ? (s.judgeCursor ?? null) : null;

/**
 * Un passage qui a jugé des comptes enchaîne le suivant une minute après : un rejugement de version (~3 000 comptes
 * parcourus jusqu'aux derniers jugés) prend ~20 minutes au lieu de 10 heures. Un passage qui n'a rien jugé, une erreur
 * ou la fin du parcours rendent la main à la tâche de 30 minutes, qui ne double pas une chaîne en cours.
 */
export const JUDGE_CHAIN_MS = 60_000;
export const JUDGE_CHAIN_HOLD_MS = 5 * 60_000;
export const chainNext = (r: { judged: number; error?: string; done: boolean }): boolean => r.judged > 0 && !r.error && !r.done;
export const cronYields = (chainAt: number | null | undefined, now: number): boolean => chainAt != null && now - chainAt < JUDGE_CHAIN_HOLD_MS;

/** Les comptes d'un passage rangés par app : un appel à l'IA ne mêle pas deux apps voisines quand il peut l'éviter. */
export const groupedByApp = <T extends { appId: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => (a.appId < b.appId ? -1 : a.appId > b.appId ? 1 : 0));

export const ACCOUNT_SYSTEM = [
  "You check whether a TikTok account promotes a given product (an app or a web tool).",
  "Each account comes with its own product: judge it only against that product, never against another account's product.",
  "Verdicts:",
  '- "pousse": the account posts about THIS product in several videos (three or more), or its bio names the product as its own, its partner or its link — the product\'s own account, an ambassador, a UGC creator paid repeatedly (partner or ambassador hashtags, a promo code, ad disclosures on the product\'s videos), even when it also posts other content. Also "pousse": an account whose videos mostly carry ad or partner disclosures, or numbered campaign hashtags (#4601-like), and that names this product at least once — a UGC creator paid repeatedly, the product may appear only on screen. If it promotes this product and another one too, answer "pousse" and give the other one in "other".',
  '- "placement": a general creator whose videos are mostly about other things, without repeated ad disclosures or campaign hashtags, and who names the product in only one or two videos, usually paid. Three or more videos naming the product is never a placement.',
  '- "autre_app": the account promotes a different product INSTEAD of this one, named in its texts or bio; give that one product\'s exact name as written, in "other". If that product is not named, answer "incertain".',
  '- "sans_rapport": the product\'s name or tag appears only with another meaning — an ordinary word in some language, a song, a person, a slang or genre hashtag — or the account clearly posts about something else and names the product at most once, without promoting it.',
  '- "incertain": the texts do not allow a decision. In particular, when the texts never name the product and the account was found through a list of the product\'s creators, answer "incertain": the product may appear only on screen in the videos.',
  "The evidence line counts the videos whose text contains the product's name or tag (check what each of them means, a match can be an ordinary word), and those with an ad or partner disclosure or a numbered campaign hashtag.",
  '"other": the exact name of ONE other product the account promotes — for "autre_app" the one it promotes instead, for "pousse" another one it also promotes; empty otherwise.',
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
    `${e.ads} of ${e.of} carry an ad or partner disclosure`,
    `${e.codes} of ${e.of} carry a numbered campaign hashtag`,
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
        ...(!a.app.pitch && a.app.about ? [`what the product is, from an earlier review: ${a.app.about}`] : []),
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
 * Ce que le Radar garde du verdict de l'IA. Un compte venu d'une liste de créateurs de l'app, sans autre preuve
 * (`proof.by === "seed"`), n'est jamais « sans rapport » : l'IA ne voit que ses textes, l'app peut n'être qu'à l'écran.
 * La consigne le disait en v2 ; l'IA l'a ignorée 6 fois sur les comptes relus (réseau d'Astra AI). Devient « incertain ».
 */
export function settledVerdict(verdict: AccountVerdict, proofBy: string | null): AccountVerdict {
  return verdict === "sans_rapport" && proofBy === "seed" ? "incertain" : verdict;
}

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
    // « autre » : l'app poussée à la place (autre_app), ou une autre app poussée en plus (pousse, v3).
    const other = x.verdict === "autre_app" || x.verdict === "pousse" ? productName(tidy(typeof x.other === "string" ? x.other : "", 60)) : "";
    const verdict: AccountVerdict = x.verdict === "autre_app" && !other ? "incertain" : x.verdict;
    out.push({ id, verdict, ...(other ? { other } : {}), why: tidy(typeof x.why === "string" ? x.why : "", WHY_MAX) });
  }
  return out;
}

// ─── Phase B : ce que fait chaque verdict ────────────────────────────────────

/**
 * DÉFINITION du fondateur (14/11/2026) :
 *  - « pousse », « incertain » : rien ne change ;
 *  - « sans_rapport » : en pause « hors sujet » (réversible) ;
 *  - « autre_app » : déplacé sous cette app si on la suit ; sinon en pause, et l'app devient une piste — dès que
 *    2 comptes la désignent, le suivi d'office la suit, y range ces comptes et cherche ses autres créateurs ;
 *  - « placement » : un créateur généraliste payé une ou deux fois n'est PAS un créateur de l'app (Swarm cherche des
 *    ambassadeurs), mais sa vidéo compte dans les vues de l'app, étiquetée « placement payé ». Le compte reste
 *    relevé, marqué `placement`, et n'est plus mis en pause faute de citer assez l'app.
 * Un compte gardé à la main (`keptByHand`) ou ajouté à la main n'est jamais touché.
 */
/**
 * `note` (v3, 15/11/2026) : le compte pousse son app ET une autre (What Brandon Thinks + Mokascore) — l'autre est notée
 * parmi les apps repérées (suivie d'office dès 2 comptes), le compte reste où il est, actif.
 */
export type VerdictAction =
  | { kind: "none" }
  | { kind: "pause" }
  | { kind: "placement" }
  | { kind: "move"; to: string }
  | { kind: "lead"; product: string }
  | { kind: "note"; product: string };

/** Vidéos qui citent son app à partir desquelles un compte la pousse aussi (règle du 13/11 : 2 vidéos prouvent). */
export const MULTI_APP_MIN_VIDEOS = 2;

/** Définition du fondateur (14/11/2026) : un placement, c'est un créateur généraliste payé « une ou deux fois ». */
export const PLACEMENT_MAX_VIDEOS = 2;

/**
 * Ce que fait un verdict. Deux gardes, tirées de la relecture à la main des verdicts v1 (14/11/2026) et des règles du
 * fondateur, que l'IA ne peut pas lever :
 *  - une bio qui nomme l'app prouve le compte (règle du 13/11 : pseudo, bio ou 2 vidéos) : ni pause, ni départ vers
 *    une autre app (« Official Fluencify ambassador », « The Ick me mantiene al día ») ;
 *  - un placement, c'est une ou deux vidéos : à 3 ou plus, c'est un partenaire récurrent, pas un placement.
 */
export function verdictAction(
  j: { verdict: AccountVerdict; other?: string },
  acc: { status: "active" | "paused"; keptByHand?: boolean; matchedBy: "caption" | "manual" | "seed" },
  followed: (name: string) => { id: string; active: boolean } | null,
  ev: { cites: number; bioNames: boolean },
): VerdictAction {
  if (acc.status !== "active" || acc.keptByHand || acc.matchedBy === "manual") return { kind: "none" };
  switch (j.verdict) {
    case "sans_rapport":
      return ev.bioNames ? { kind: "none" } : { kind: "pause" };
    case "placement":
      return ev.cites <= PLACEMENT_MAX_VIDEOS ? { kind: "placement" } : { kind: "none" };
    case "pousse": {
      // Il pousse aussi une autre app : notée si on ne la suit pas encore.
      const name = (j.other ?? "").trim();
      return name && !followed(name) ? { kind: "note", product: name } : { kind: "none" };
    }
    case "autre_app": {
      const name = (j.other ?? "").trim();
      if (!name) return { kind: "none" };
      // Sa bio ou deux de ses vidéos prouvent son app : il pousse les deux, il reste ; l'autre est notée.
      if (ev.bioNames || ev.cites >= MULTI_APP_MIN_VIDEOS) return followed(name) ? { kind: "none" } : { kind: "note", product: name };
      const app = followed(name);
      if (app?.active) return { kind: "move", to: app.id };
      // Suivie mais en pause (hors périmètre, à la main) : le compte ne pousse pas l'app où il est rangé.
      return app ? { kind: "pause" } : { kind: "lead", product: name };
    }
    default:
      return { kind: "none" };
  }
}

/** Comptes qui doivent désigner la même app pour qu'elle soit suivie d'office (une mention isolée ne prouve rien). */
export const LEAD_MIN_ACCOUNTS = 2;

