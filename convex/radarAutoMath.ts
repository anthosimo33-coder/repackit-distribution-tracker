/**
 * RADAR — SUIVI D'OFFICE : ce qu'on fait d'une app repérée. Règle pure (les écritures : convex/radarAuto).
 */
import { LEAD_MIN_ACCOUNTS } from "./radarJudgeMath";
import { marketPatterns, productKey } from "./radarMarketMath";
import { normalize } from "./radarNetworkMath";
import { AUTO_MIN_CREATORS, isShopGenre, storeAutoFollow, storeTrial, tagCore, type CreatorWhy } from "./radarStoreMath";

/** Le motif raccourci du hashtag prouvé (« hush » pour « hushapp ») : celui que le suivi d'office a utilisé à tort le 13/11/2026. */
export const shortenedPattern = (tag: string): string | null => (tagCore(tag) !== tag ? tagCore(tag) : null);

export type AutoPlan = { patterns: string[]; trial?: true } | { skip: string };

type Candidate = {
  kind: "mention" | "domain" | "store" | "market" | "hashtag" | "ia" | "liste";
  label: string;
  authorCount?: number;
  store?: { tag: string; genre?: string; creators: readonly { handle: string; why: CreatorWhy }[] };
  market?: { handle: string };
  /** Ce que l'IA a dit d'une mention ou d'un site (cf `triageAnswer`). */
  triage?: { kind: TriageKind; name: string };
};

/**
 * Les motifs pour suivre l'app d'office, ou pourquoi elle reste proposée :
 *  - une app des classements entre quand ses comptes créateurs la prouvent assez (radarStoreMath.storeAutoFollow),
 *    sous le hashtag PROUVÉ, tel quel. Le 13/11/2026, 13 h 36 à 13 h 46 UTC, elle entrait sous ce hashtag
 *    raccourci (« hush » pour « hushapp », « hyper », « guardian », « declic ») : la recherche de son réseau a
 *    rattaché 1 400 comptes sans rapport en dix minutes ;
 *  - un produit d'une place de marché entre dès qu'on sait le nommer : sa campagne paie des créateurs ;
 *  - un compte mentionné ou un site cité par des comptes ne sont jamais suivis d'office.
 */
export function autoPlan(c: Candidate): AutoPlan {
  if (c.kind === "store" && c.store) {
    if (storeAutoFollow(c.store.tag, c.store.creators)) return { patterns: [c.store.tag] };
    // Deux comptes créateurs : à l'essai, sauf une boutique (hors périmètre : ni app, ni SaaS, ni jeu mobile).
    if (storeTrial(c.store.tag, c.store.creators) && !isShopGenre(c.store.genre ?? "")) return { patterns: [c.store.tag], trial: true };
    return { skip: "preuve insuffisante" };
  }
  if (c.kind === "market" && c.market) {
    const patterns = marketPatterns(c.label, c.market.handle);
    return patterns.length ? { patterns } : { skip: "nom trop court" };
  }
  // Une app que des comptes suivis poussent à la place de la leur (jugement de l'IA, convex/radarJudge) : suivie dès
  // que 2 comptes la désignent (définition du fondateur, 14/11/2026), sous son nom collé.
  if (c.kind === "ia") {
    if ((c.authorCount ?? 0) < LEAD_MIN_ACCOUNTS) return { skip: "un seul compte la désigne" };
    const patterns = marketPatterns(c.label, "");
    return patterns.length ? { patterns } : { skip: "nom trop court" };
  }
  // Une app d'une liste importée (15/11/2026) : à l'essai sous son nom collé ; si l'IA le dit courant, sous
  // « nomapp » (cf `listFallback`, appelé par le suivi d'office).
  if (c.kind === "liste") {
    const patterns = listPatterns(c.label);
    if (patterns.length) return { patterns, trial: true };
    // Trois lettres (Tab, Fig, Flo) : compactées, elles sont partout (« table », « figure ») ; seulement « nomapp ».
    const fb = listFallback(c.label);
    return fb ? { patterns: fb.patterns, trial: true } : { skip: "nom trop court" };
  }
  // Un compte mentionné ou un site cité par deux comptes ou plus, que l'IA a dit app, logiciel ou jeu mobile et su
  // nommer (15/11/2026) : à l'essai, sous des motifs qu'une phrase n'emploie pas (cf `triagePatterns`).
  if ((c.kind === "mention" || c.kind === "domain") && c.triage) {
    if (!inTriageScope(c.triage.kind)) return { skip: TRIAGE_OUT_NOTE };
    const patterns = triagePatterns(c, c.triage.name);
    return patterns.length ? { patterns, trial: true } : { skip: "nom trop court" };
  }
  return { skip: "pas une source suivie d'office" };
}

// ─── Les listes importées (15/11/2026) ───────────────────────────────────────

/**
 * Les apps d'une liste importée (« autant d'apps que FarmSpot, les mêmes au minimum », fondateur, 15/11/2026 ; leur
 * liste copiée, avec l'accord de son avocat). Seuls les NOMS viennent de la liste : la recherche de chaque réseau et
 * la preuve de chaque compte sont les nôtres, et chaque app entre à l'essai.
 */
export const LIST_MIN_CORE = 4;
/** En dessous, même « nomapp » ne dit rien de sûr. */
const LIST_FALLBACK_MIN = 3;

/** Le motif d'une app d'une liste : son nom collé (« Blow Up » → « blowup »), s'il a au moins 4 lettres. */
export function listPatterns(name: string): string[] {
  const core = productKey(name);
  return core.length >= LIST_MIN_CORE ? [core] : [];
}

/** Ce qu'on cherche sur TikTok pour elle : son nom, son hashtag, « nom app ». */
export function listSearches(name: string): string[] {
  const n = name.toLowerCase().replace(/\s+/g, " ").trim();
  return [n, `#${productKey(name)}`, `${n} app`].filter((x, i, a) => a.indexOf(x) === i);
}

/** Les débuts de mots qui suivent « app » dans une phrase (« simple approach », « tab apple ») : jamais l'app. */
const APP_WORD_TAILS = ["appl", "appe", "appr", "appo", "appa", "appi"];

/**
 * Un nom COURANT (Simple, Glow, Reset, Tab) : pas le nom seul, mais « nomapp » ; et les tournures où « app » ouvre un
 * autre mot (« simple approach » contient « simpleapp » une fois compacté) sont retirées avant de chercher.
 * `null` : le nom finit déjà par « app », il n'y a rien de plus sûr.
 */
export function listFallback(name: string): { patterns: string[]; not: string[]; searches: string[] } | null {
  const core = productKey(name);
  if (core.length < LIST_FALLBACK_MIN || core.endsWith("app")) return null;
  const n = name.toLowerCase().replace(/\s+/g, " ").trim();
  return { patterns: [`${core}app`], not: APP_WORD_TAILS.map((t) => `${n} ${t}`), searches: [`${n} app`, `#${core}app`] };
}

// ─── Le tri des mentions et des sites (15/11/2026) ───────────────────────────

/**
 * Les @mentions et les sites que citent deux comptes ou plus (286 mentions et 32 sites le 15/11/2026) : des
 * personnes et des marques (@Rohat, @valorant, @H&M), mais aussi des apps qu'on ne suit pas (Learna, HealthMeter,
 * faithmode.app, tented.ai). Claude Haiku dit ce que c'est et le nom du produit ; seuls une app, un logiciel ou un
 * jeu mobile entrent, à l'essai.
 */
export const TRIAGE_KINDS = ["app", "software", "game", "other"] as const;
export type TriageKind = (typeof TRIAGE_KINDS)[number];
export const inTriageScope = (k: TriageKind): boolean => k === "app" || k === "software" || k === "game";
/** Comptes qui la citent, au moins, pour la faire trier. */
export const TRIAGE_MIN_AUTHORS = 2;
/** Mentions et sites envoyés par appel. */
export const TRIAGE_BATCH = 40;
export const TRIAGE_OUT_NOTE = "ni une app, ni un logiciel, ni un jeu mobile (IA)";

export const TRIAGE_SYSTEM = [
  "Each item is something several TikTok accounts cite in their videos: either a TikTok account they @mention (we give its display name) or a website domain.",
  "These accounts mostly promote apps. Say what the item is, and name the product.",
  'kind: "app" = a mobile app (iOS or Android); "software" = a website, SaaS, web tool or AI tool people sign up for; "game" = a mobile game;',
  '"other" = everything else: a person, creator, streamer, celebrity, musician or band, a TV show or film, a media or news site, a shop or a physical',
  "product or cosmetics brand, a restaurant or employer, a console or PC game, a generic site (github.io, netlify.app, amazon), or anything you cannot tell.",
  'name = the product\'s own name as people would search it ("Learna", "HealthMeter", "faithmode"), without slogan; empty string when kind is "other".',
  "When the display name is only a slogan (\"Spotify but for Muslims\") and you cannot tell the product's name, answer other.",
  "When unsure, answer other. Answer for every item, using its id.",
].join(" ");

export const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, kind: { type: "string", enum: [...TRIAGE_KINDS] }, name: { type: "string" } },
        required: ["id", "kind", "name"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

export type TriageToJudge = { id: string; kind: "mention" | "domain"; label: string; authors: number; apps: string[] };

export function triagePrompt(batch: readonly TriageToJudge[]): string {
  return batch
    .map((c) => `id: ${c.id}\n${c.kind === "mention" ? `mentioned account: ${c.label}` : `website: ${c.label}`}\ncited by: ${c.authors} accounts${c.apps.length ? ` (they also promote: ${c.apps.slice(0, 4).join(", ")})` : ""}`)
    .join("\n\n");
}

export type Triage = { id: string; kind: TriageKind; name: string };

/**
 * La réponse de l'IA ramenée à ce qu'on peut écrire : une ligne par élément DEMANDÉ (inventé ou répété : écarté), une
 * nature connue, un nom propre d'au moins 4 lettres ; un produit sans nom devient « autre ».
 */
export function triageAnswer(raw: unknown, batch: readonly { id: string }[]): Triage[] {
  const asked = new Set(batch.map((c) => c.id));
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const out: Triage[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const id = typeof x.id === "string" ? x.id : "";
    if (!asked.has(id)) continue;
    asked.delete(id);
    const k = typeof x.kind === "string" && (TRIAGE_KINDS as readonly string[]).includes(x.kind) ? (x.kind as TriageKind) : "other";
    const name = typeof x.name === "string" ? x.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    const named = inTriageScope(k) && productKey(name).length >= 4;
    out.push({ id, kind: named ? k : "other", name: named ? name : "" });
  }
  return out;
}

/**
 * Les motifs d'une mention ou d'un site trié : jamais le nom compacté seul. « Learna » compacté est dans « learn a new
 * language », que des profs écrivent chaque jour : la mention prend `@learna`, `#learna` et `learnaapp`. Un site
 * prend son domaine entier (« faithmode.app »), extension comprise.
 */
export function triagePatterns(c: { kind: "mention" | "domain" | string; label: string }, name: string): string[] {
  if (c.kind === "domain") {
    const d = normalize(c.label).compact;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && d.replace(/\.[a-z]+$/, "").length >= 4 ? [d] : [];
  }
  const core = productKey(name);
  if (core.length < 4) return [];
  return [`@${core}`, `#${core}`, core.endsWith("app") ? "" : `${core}app`].filter(Boolean);
}

/** Ce qu'on cherche sur TikTok pour une mention ou un site trié : son nom, son hashtag, « nom app » ; le site tel quel. */
export function triageSearches(c: { kind: "mention" | "domain" | string; label: string }, name: string): string[] {
  const core = productKey(c.kind === "domain" ? c.label.replace(/\.[a-z]+$/, "") : name);
  const first = c.kind === "domain" ? c.label.toLowerCase() : name.toLowerCase();
  return [first, `#${core}`, `${c.kind === "domain" ? core : name.toLowerCase()} app`].filter((x, i, a) => a.indexOf(x) === i);
}


// ─── L'essai ─────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** Comptes actifs qui gardent une app à l'essai : le seuil du suivi d'office. */
export const TRIAL_KEEP_MIN = AUTO_MIN_CREATORS;
/** Après sa recherche, le temps laissé aux premiers relevés de ses nouveaux comptes (« en contrôle ») pour la juger. */
export const TRIAL_SETTLE_MS = 2 * DAY_MS;
/** Au-delà, elle est jugée même si des comptes attendent encore leur premier relevé (palier du solde). */
export const TRIAL_MAX_WAIT_MS = 7 * DAY_MS;

/**
 * Ce qu'on fait d'une app à l'essai : la garder dès qu'elle a `TRIAL_KEEP_MIN` comptes actifs ; sinon attendre que
 * sa recherche ait tourné et que ses nouveaux comptes soient contrôlés (Peach, 15/11 : 17 rattachés, 1 seul gardé à
 * son premier relevé) ; puis la mettre en pause. `null` : elle n'est pas à l'essai.
 */
export function trialDecision(app: { trialSince?: number; networkSearchedAt?: number }, n: { active: number; vetting: number }, now: number): "keep" | "wait" | "pause" | null {
  if (app.trialSince === undefined) return null;
  if (n.active >= TRIAL_KEEP_MIN) return "keep";
  if (app.networkSearchedAt === undefined) return "wait";
  const since = now - app.networkSearchedAt;
  if (since < TRIAL_SETTLE_MS || (n.vetting > 0 && since < TRIAL_MAX_WAIT_MS)) return "wait";
  return "pause";
}

// ─── Le garde « nom courant » ────────────────────────────────────────────────

/**
 * Même prouvée, une app n'entre pas d'office quand son motif est un mot de tous les jours : « equals », « aisance »,
 * « arkose » (une chaîne de salles d'escalade) ont rattaché 573 comptes sans rapport le 13/11/2026. Une IA dit, pour
 * chaque motif, si une vidéo qui le contient parle presque toujours de CE produit ; dans le doute, non — l'app reste
 * proposée, à suivre à la main avec un motif plus précis.
 */
export const AUTO_COMMON_NOTE = "nom courant : à suivre à la main avec un motif précis";

export const AUTO_SYSTEM = [
  "You judge search terms. Each item is a product (a mobile app or a web tool) and the exact term we would search on TikTok to find the creators who promote it.",
  "distinctive = true when videos whose caption contains this term are almost always about THIS product:",
  'an invented brand name ("hipobuy", "learnaai", "coldtrace"), or a name with "app" or "ai" glued to it that nothing else uses ("hushapp", "retaincardsapp").',
  "distinctive = false when the term is an ordinary word in any language, a first name, a place, a common hashtag,",
  'or the name of a well-known brand, shop, team, media, artist or game that people talk about for other reasons ("equals", "aisance", "guardian", "hyper").',
  "When unsure, answer false.",
  "Answer for every item, using its id.",
].join(" ");

export const AUTO_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, distinctive: { type: "boolean" } },
        required: ["id", "distinctive"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

export type AutoToJudge = { id: string; name: string; what: string; patterns: string[] };

export function autoPrompt(batch: readonly AutoToJudge[]): string {
  return batch.map((c) => `id: ${c.id}\nproduct: ${c.name}${c.what ? ` (${c.what})` : ""}\nterm: ${c.patterns.join(", ")}`).join("\n\n");
}

export type AutoVerdict = { id: string; common: boolean };

/**
 * La réponse de l'IA ramenée à ce qu'on peut écrire : un verdict par app DEMANDÉE (inventée ou répétée : écartée).
 * Seul un « distinctive: true » franc fait entrer l'app ; toute autre réponse la laisse proposée. Une app sans
 * verdict n'est pas regardée : elle le sera au passage suivant.
 */
export function autoAnswer(raw: unknown, batch: readonly { id: string }[]): AutoVerdict[] {
  const asked = new Set(batch.map((c) => c.id));
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const out: AutoVerdict[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const id = typeof x.id === "string" ? x.id : "";
    if (!asked.has(id)) continue;
    asked.delete(id);
    out.push({ id, common: x.distinctive !== true });
  }
  return out;
}
