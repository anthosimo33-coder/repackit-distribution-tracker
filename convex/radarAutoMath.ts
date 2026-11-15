/**
 * RADAR — SUIVI D'OFFICE : ce qu'on fait d'une app repérée. Règle pure (les écritures : convex/radarAuto).
 */
import { LEAD_MIN_ACCOUNTS } from "./radarJudgeMath";
import { marketPatterns } from "./radarMarketMath";
import { AUTO_MIN_CREATORS, storeAutoFollow, storeTrial, tagCore, type CreatorWhy } from "./radarStoreMath";

/** Le motif raccourci du hashtag prouvé (« hush » pour « hushapp ») : celui que le suivi d'office a utilisé à tort le 13/11/2026. */
export const shortenedPattern = (tag: string): string | null => (tagCore(tag) !== tag ? tagCore(tag) : null);

export type AutoPlan = { patterns: string[]; trial?: true } | { skip: string };

type Candidate = {
  kind: "mention" | "domain" | "store" | "market" | "hashtag" | "ia";
  label: string;
  authorCount?: number;
  store?: { tag: string; genre?: string; creators: readonly { handle: string; why: CreatorWhy }[] };
  market?: { handle: string };
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
    if (storeTrial(c.store.tag, c.store.creators) && !SHOP_GENRES.has(c.store.genre ?? "")) return { patterns: [c.store.tag], trial: true };
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
  return { skip: "pas une source suivie d'office" };
}


/** Les genres de l'App Store qui sont des boutiques (Hipobuy, The Bradery, Superdrug : hors périmètre le 15/11/2026). */
export const SHOP_GENRES: ReadonlySet<string> = new Set(["Shopping", "Achats", "Compras", "Einkaufen", "Acquisti", "Winkelen"]);

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
