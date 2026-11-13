/**
 * RADAR — LA FICHE D'UNE APP : sa niche, ce qu'elle fait en une phrase, sa fiche App Store, sa campagne. Règles pures.
 *
 * Pourquoi : jusqu'au 13/11/2026 une app suivie n'était qu'un nom et des motifs. Swarm (le produit vendu sur ces
 * données) rangeait les apps par niche avec une table écrite à la main chez lui, 49 noms — or les apps entrent
 * maintenant d'office, par dizaines, depuis les classements de l'App Store et une place de marché de campagnes.
 * Une app qui entre doit donc arriver avec sa fiche :
 *  - sa NICHE et ce qu'elle fait EN UNE PHRASE : dites par une IA à partir de ce qu'on sait d'elle (genre App
 *    Store, texte de sa campagne, ce que ses créateurs écrivent à l'écran et en légende) ; pour les apps déjà
 *    rangées à la main chez Swarm, la niche posée à la main fait foi (NICHE_BY_HAND) ;
 *  - sa fiche App Store et ce que sa campagne paie : recopiés de l'app repérée dont elle vient (candidateFiche).
 * Les écritures et l'appel à l'IA : convex/radarFiche.
 */
import { marketPatterns } from "./radarMarketMath";
import { cleanText } from "./radarSignalsMath";
import { alreadyFollowed, compactName, tagCore } from "./radarStoreMath";

const DAY = 86_400_000;

// ─── Les niches ──────────────────────────────────────────────────────────────

/**
 * Les niches, avec ce que l'IA en sait. Les 11 de Swarm (13/11/2026), et 5 de plus pour ce que les nouvelles
 * sources font entrer : rencontres, bien-être mental, finance, productivité, création de contenu.
 */
export const NICHE_GUIDE = [
  ["Séduction IA", "AI that writes replies or pick-up lines for dating chats, rizz assistants and keyboards"],
  ["Jalousie et ex", "tools to watch a partner, crush or ex on social networks: new follows, who viewed, cheating or loyalty checks, anonymous story viewers"],
  ["Couple", "apps for people already in a relationship: couple questions and games, long-distance, shared widgets"],
  ["Rencontres", "dating and friend-making apps where you meet new people"],
  ["Études", "homework help, revision, flashcards, note summaries, school and exam AI"],
  ["Langues", "language learning and speaking practice"],
  ["Santé et physique", "calories and nutrition, fitness, looks rating, skin, cycle and pregnancy, quitting habits, sleep"],
  ["Bien-être mental", "therapy and coaching chat, journaling, meditation, mood, self-care, habit building for the mind"],
  ["Beauté IA", "AI photos and headshots, virtual try-on, hair and make-up simulation, glow-up filters"],
  ["Foi", "religion, prayer, Bible or Quran"],
  ["Side hustle", "making money online: tools sold as a way to earn (faceless videos, clipping, reselling, online business, audience growth), paid surveys and rewards"],
  ["Finance", "budgeting, saving, investing, trading, crypto, credit"],
  ["Productivité", "notes, planning, email, work and writing assistants, general AI chat"],
  ["Création de contenu", "video, photo, music or post editors and generators, when NOT sold as a way to earn money"],
  ["Social et loisirs", "social networks, music, films and series, games, hobbies, entertainment"],
  ["Autres", "anything else, or not enough evidence to tell"],
] as const;

export type Niche = (typeof NICHE_GUIDE)[number][0];
export const NICHES: readonly Niche[] = NICHE_GUIDE.map(([label]) => label);
export const NICHE_DEFAULT: Niche = "Autres";
const isNiche = (x: string): x is Niche => (NICHES as readonly string[]).includes(x);

/**
 * Les niches posées à la main : la table éditoriale de Swarm au 13/11/2026 (son `NICHES`), reprise telle quelle
 * sauf ses « Autres » (Sunsay, SafeNow, Palima, Kairo Alarme), laissées à l'IA. Clé : le nom de l'app ramené à ses
 * lettres et chiffres.
 */
const BY_HAND: Record<Exclude<Niche, "Autres">, readonly string[]> = {
  "Séduction IA": ["Rizz App", "WRizz", "Wing AI", "Plug AI", "Rizz Master", "Flert Now"],
  "Jalousie et ex": [
    "RecentFollow", "The Cringe", "The Ick", "FollowOtter", "Snitchy", "Snitch", "What Brandon Thinks", "FollowSpy", "Shady", "CheatLove",
    "Stalkie", "Katch", "Lurk", "Susly", "Leaked DMs", "Crush Tracker",
  ],
  Couple: ["Love8", "Loverzz"],
  Rencontres: [],
  Études: ["Astra AI", "Knowunity", "Retain Cards"],
  Langues: ["Praktika", "Voca AI", "Airlearn"],
  "Santé et physique": ["Cal AI", "Umax", "Flo", "Quittr", "Fit AI", "Finch"],
  "Bien-être mental": [],
  "Beauté IA": ["Glam AI"],
  Foi: ["Bible Chat", "Creed"],
  "Side hustle": ["Shortfy", "Sweatcoin", "Fluencify", "TrendSaaS"],
  Finance: [],
  Productivité: [],
  "Création de contenu": [],
  "Social et loisirs": ["Airbuds", "Serializd"],
};

export const NICHE_BY_HAND: ReadonlyMap<string, Niche> = new Map(
  (Object.entries(BY_HAND) as [Niche, readonly string[]][]).flatMap(([niche, names]) => names.map((name) => [compactName(name), niche] as const)),
);

/** La niche posée à la main pour cette app, s'il y en a une. */
export const handNiche = (name: string): Niche | undefined => NICHE_BY_HAND.get(compactName(name));

// ─── Quand demander la fiche d'une app ───────────────────────────────────────

/** Une app entrée sans rien à lire (ni fiche, ni vidéo de ses comptes) attend un jour : ses comptes sont relevés dans l'heure. */
export const NICHE_WAIT_MS = DAY;
/** Une app dont l'IA n'a pas su dire ce qu'elle fait est redemandée une semaine plus tard. */
export const NICHE_RETRY_MS = 7 * DAY;
/** Apps envoyées par appel. */
export const NICHE_BATCH = 20;

export function nicheDue(app: { createdAt: number; nicheAt?: number; pitch?: string }, evidence: number, now: number): boolean {
  if (app.nicheAt === undefined) return evidence > 0 || now - app.createdAt >= NICHE_WAIT_MS;
  return !app.pitch && now - app.nicheAt >= NICHE_RETRY_MS;
}

// ─── Ce qu'on donne à lire à l'IA, et ce qu'on garde de sa réponse ───────────

/** Textes de créateurs donnés par app, et leur longueur. */
export const NICHE_TEXTS_MAX = 8;
export const NICHE_BIOS_MAX = 3;
const TEXT_MAX = 160;

/** Un texte sur une ligne, sans blancs autour, coupé à `max` caractères. */
const tidy = (x: string, max: number): string => cleanText(x.replace(/\s+/g, " ").trim(), max);

/** Les textes des créateurs d'une app, propres, chacun une fois, les premiers donnés d'abord. */
export function nicheTexts(texts: readonly (string | undefined | null)[], max: number = NICHE_TEXTS_MAX): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    const clean = tidy(t ?? "", TEXT_MAX);
    const key = compactName(clean);
    if (key.length < 6 || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

export type NicheToJudge = {
  id: string;
  name: string;
  searches: string[];
  store?: { genre: string; artist: string };
  market?: { productKind: "app" | "software"; about?: string };
  texts: string[];
  bios: string[];
};

/** Ce qu'on sait d'une app, compté : sa fiche App Store, le texte de sa campagne, chaque texte de créateur. */
export const nicheEvidence = (a: Pick<NicheToJudge, "store" | "market" | "texts" | "bios">): number =>
  (a.store ? 1 : 0) + (a.market?.about ? 1 : 0) + a.texts.length + a.bios.length;

export const NICHE_SYSTEM = [
  "You classify consumer apps and web tools that short-form video creators promote.",
  "For each product, pick ONE niche from the list and write ONE French sentence saying what the product does for its user.",
  "Niches:",
  ...NICHE_GUIDE.map(([label, what]) => `- "${label}": ${what}.`),
  "pitch: one plain French sentence of at most 140 characters that starts with what the product is",
  '("Clavier IA qui souffle des réponses pour draguer par message", "App qui compte les calories à partir d\'une photo du repas").',
  "No brand name, no marketing words, no emoji, no quotation marks.",
  "Use only the evidence given: name, search terms, App Store genre, campaign text, what its creators write on screen, in captions and in their bios.",
  'When the evidence does not tell what the product does, answer niche "Autres" and an empty pitch — never guess from the name alone.',
  "Answer for every product, using its id.",
].join("\n");

export const NICHE_SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          niche: { type: "string", enum: [...NICHES] },
          pitch: { type: "string" },
        },
        required: ["id", "niche", "pitch"],
        additionalProperties: false,
      },
    },
  },
  required: ["products"],
  additionalProperties: false,
} as const;

const quoted = (xs: readonly string[]): string => xs.map((x) => `"${x.replace(/"/g, "'")}"`).join(" | ");

export function nichePrompt(batch: readonly NicheToJudge[]): string {
  return batch
    .map((a) =>
      [
        `id: ${a.id}`,
        `name: ${a.name}`,
        `search terms: ${a.searches.slice(0, 6).join(", ") || "(none)"}`,
        ...(a.store ? [`app store: genre "${a.store.genre}", publisher "${a.store.artist}"`] : []),
        ...(a.market ? [`paid campaign (${a.market.productKind === "app" ? "mobile app" : "web software"}): ${a.market.about || "(no text)"}`] : []),
        `creators write: ${a.texts.length ? quoted(a.texts) : "(nothing read yet)"}`,
        ...(a.bios.length ? [`creator bios: ${quoted(a.bios)}`] : []),
      ].join("\n"),
    )
    .join("\n\n");
}

export const PITCH_MAX = 160;
export type NicheAnswer = { id: string; niche: Niche; pitch: string };

/**
 * La réponse de l'IA ramenée à ce qu'on peut écrire : une ligne par app DEMANDÉE (une app inventée ou répétée est
 * écartée), une niche de la liste (sinon « Autres »), une phrase propre sur une ligne. Une phrase qui ne dit rien
 * (moins de 12 caractères) est vidée : l'app sera redemandée.
 */
export function nicheAnswer(raw: unknown, batch: readonly { id: string }[]): NicheAnswer[] {
  const asked = new Set(batch.map((a) => a.id));
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { products?: unknown }).products) ? (raw as { products: unknown[] }).products : [];
  const out: NicheAnswer[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const id = typeof x.id === "string" ? x.id : "";
    if (!asked.has(id)) continue;
    asked.delete(id);
    const niche = typeof x.niche === "string" && isNiche(x.niche) ? x.niche : NICHE_DEFAULT;
    const pitch = tidy(typeof x.pitch === "string" ? x.pitch : "", PITCH_MAX)
      .replace(/^["«»\s]+|["«»\s]+$/g, "")
      .replace(/\.$/, "");
    out.push({ id, niche, pitch: pitch.length >= 12 ? pitch : "" });
  }
  return out;
}

/** Ce qu'on écrit sur l'app : la niche posée à la main fait foi, la phrase vient toujours de l'IA. */
export function nicheToWrite(name: string, answer: Pick<NicheAnswer, "niche" | "pitch">): { niche: Niche; nicheBy: "hand" | "ai"; pitch?: string } {
  const hand = handNiche(name);
  return { niche: hand ?? answer.niche, nicheBy: hand ? "hand" : "ai", ...(answer.pitch ? { pitch: answer.pitch } : {}) };
}

// ─── La fiche recopiée de l'app repérée ──────────────────────────────────────

export type AppStoreFiche = { storeId: string; artist: string; genre: string; released: string };
export type AppMarketFiche = {
  source: string;
  productKind: "app" | "software";
  org: string;
  campaignUrl: string;
  campaigns: number;
  creators: number;
  views: number;
  spentCents: number;
  rateCents?: number;
  about?: string;
};

type CandidateFiche = {
  kind: "mention" | "domain" | "store" | "market";
  label: string;
  store?: AppStoreFiche & { tag: string };
  market?: AppMarketFiche & { handle: string };
};

/** Ce qu'une app repérée donne à la fiche de l'app suivie : sa fiche App Store, ou ce que ses campagnes paient. */
export function candidateFiche(c: Pick<CandidateFiche, "store" | "market">): { store?: AppStoreFiche; market?: AppMarketFiche } {
  const s = c.store;
  const m = c.market;
  return {
    ...(s ? { store: { storeId: s.storeId, artist: s.artist, genre: s.genre, released: s.released } } : {}),
    ...(m
      ? {
          market: {
            source: m.source,
            productKind: m.productKind,
            org: m.org,
            campaignUrl: m.campaignUrl,
            campaigns: m.campaigns,
            creators: m.creators,
            views: m.views,
            spentCents: m.spentCents,
            ...(m.rateCents !== undefined ? { rateCents: m.rateCents } : {}),
            ...(m.about ? { about: m.about } : {}),
          },
        }
      : {}),
  };
}

/**
 * Les motifs sous lesquels retrouver l'app SUIVIE d'une app repérée qui n'y est pas encore reliée (suivie avant le
 * 13/11/2026, ou reconnue « déjà suivie ») : le hashtag qui la prouvait, ou le nom de son produit.
 */
export function fichePatterns(c: CandidateFiche): string[] {
  if (c.kind === "store" && c.store) return [tagCore(c.store.tag)];
  if (c.kind === "market" && c.market) return marketPatterns(c.label, c.market.handle);
  return [];
}

/**
 * L'app suivie d'une app repérée : celle qui porte un de ses motifs, sinon celle qui porte son nom (une app
 * reconnue « déjà suivie » parce qu'elle avait le même nom peut avoir d'autres motifs).
 */
export function ficheApp<A extends { name: string; strong: readonly string[] }>(c: CandidateFiche, apps: readonly A[]): A | undefined {
  const patterns = fichePatterns(c);
  const name = compactName(c.label);
  return (patterns.length ? apps.find((a) => alreadyFollowed(patterns, [a])) : undefined) ?? (name.length >= 3 ? apps.find((a) => compactName(a.name) === name) : undefined);
}

/** La description d'une campagne, telle que rangée sur la fiche. */
export const MARKET_ABOUT_MAX = 300;
export const marketAbout = (description: string | undefined): string => tidy(description ?? "", MARKET_ABOUT_MAX);
