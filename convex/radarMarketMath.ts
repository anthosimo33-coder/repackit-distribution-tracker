/**
 * RADAR — APPS ET LOGICIELS QUI PAIENT DES CRÉATEURS, lus sur une place de marché de campagnes. Règles pures.
 *
 * Pourquoi : les classements de l'App Store (convex/radarStore) ne voient ni les logiciels vendus sur le web ni
 * les petites apps, et une app n'y prouve rien de sa distribution. Sur une place de marché de campagnes, une
 * marque PAIE des créateurs à la vue : chaque campagne dit qui paie, combien, combien de créateurs y publient,
 * et montre ses meilleurs clips avec leur adresse.
 *
 * Source branchée : Content Rewards (contentrewards.com), lisible sans compte. Mesuré le 13/11/2026 : 736
 * campagnes dans son plan de site, toutes actives, 2,7 milliards de vues suivies, 1,6 M$ versés, 244 campagnes
 * lancées en octobre contre 23 en juin. Une centaine font la promotion d'une app ou d'un logiciel (Abby AI,
 * TradeLens, Hairly AI, Sauce AI, Open Road, « Toxic: Followers Tracker »…) ; le reste, des extraits de
 * streamers, de la musique, des podcasts. 559 campagnes montrent leurs meilleurs clips (2 004 sur TikTok).
 * Sideshift, lui, ne montre ses campagnes qu'à un créateur inscrit : rien à lire sans compte.
 *
 * Le produit promu n'est pas un champ : « Abby AI [SLIDESHOW] » est porté par l'agence ClipGenie, « Aisance
 * Clipping » par EuroAFF. Une IA lit le nom et la description de chaque campagne et dit le produit et sa nature
 * (convex/radarMarket) ; ce module valide sa réponse.
 */
import { cleanText } from "./radarSignalsMath";

const DAY = 86_400_000;

export const MARKET_SOURCE = "contentrewards" as const;
/** La devise de la place de marché : ses tarifs, budgets et versements sont en dollars. */
export const MARKET_CURRENCY = "USD";
export const MARKET_SITEMAP_URL = "https://contentrewards.com/sitemap.xml";
const CAMPAIGN_URL = /^https:\/\/contentrewards\.com\/c\/campaigns\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Les campagnes du plan de site : leur identifiant et leur adresse, chacune une fois. */
export function parseMarketSitemap(xml: string): { campaignId: string; url: string }[] {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const hit = CAMPAIGN_URL.exec(m[1]);
    if (hit && !out.has(hit[1])) out.set(hit[1], m[1]);
  }
  return [...out].map(([campaignId, url]) => ({ campaignId, url }));
}

/** Coupe le JSON (objet ou tableau) qui commence à `start`, en respectant chaînes et échappements. */
function cutJsonAt(text: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let k = start; k < text.length; k++) {
    const c = text[k];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, k + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** Le contenu que la page pousse par morceaux (`self.__next_f.push([1,"…"])`), remis bout à bout. */
export function pageFlux(html: string): string {
  let flux = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      flux += JSON.parse(`"${m[1]}"`) as string;
    } catch {
      // Un morceau illisible ne perd que lui.
    }
  }
  return flux;
}

const TIKTOK_POST = /tiktok\.com\/@([A-Za-z0-9._]{2,30})\/(?:video|photo)\/\d+/;

export type CampaignRead = {
  name: string;
  org: string;
  description: string;
  launchedAt: number | null;
  /** Ce que rapportent 1 000 vues, en cents ; `null` quand la campagne ne paie pas à la vue. */
  rateCents: number | null;
  creators: number;
  views: number;
  spentCents: number;
  /** Les comptes TikTok de ses meilleurs clips, chacun une fois. */
  handles: string[];
};

const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0);
const str = (x: unknown): string => (typeof x === "string" && x !== "$undefined" ? x : "");
/** Un texte sur une ligne, sans blancs autour, coupé à `max` caractères. */
const tidy = (x: string, max: number): string => cleanText(x.replace(/\s+/g, " ").trim(), max);

/** Ce qu'une page de campagne dit d'elle : nom, marque ou agence, description, chiffres, comptes de ses meilleurs clips. `null` si la page ne se lit pas. */
export function parseCampaignPage(html: string): CampaignRead | null {
  const flux = pageFlux(html);
  const at = flux.indexOf('"data":{"banner":');
  const data = at < 0 ? undefined : cutJsonAt(flux, at + 7);
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const name = tidy(str(d.name), 120);
  if (!name) return null;
  const metrics = (d.metrics && typeof d.metrics === "object" ? d.metrics : {}) as Record<string, unknown>;
  const org = (d.organization && typeof d.organization === "object" ? d.organization : {}) as Record<string, unknown>;
  const launched = Date.parse(str(d.launchDate) || str(d.createdAt));
  const clipsAt = flux.indexOf('"topClips":[');
  const clips = clipsAt < 0 ? [] : cutJsonAt(flux, clipsAt + 11);
  const handles: string[] = [];
  for (const c of Array.isArray(clips) ? clips : []) {
    const hit = TIKTOK_POST.exec(str((c as Record<string, unknown> | null)?.postUrl));
    const h = hit?.[1].toLowerCase();
    if (h && !handles.includes(h)) handles.push(h);
  }
  // Payée à la vue : le tarif d'une plateforme (le même sur toutes, le plus souvent).
  const rate = /"payoutType":"cpm"[^{}]*?"rateCents":(\d+)/.exec(flux) ?? /"primaryPayoutCents":(\d+)/.exec(flux);
  return {
    name,
    org: tidy(str(org.name), 80),
    description: tidy(str(d.description), 600),
    launchedAt: Number.isFinite(launched) ? launched : null,
    rateCents: d.type === "cpm" && rate ? Number(rate[1]) : null,
    creators: num(metrics.creatorCount),
    views: num(metrics.totalViews),
    spentCents: num(metrics.budgetSpentCents),
    handles: handles.slice(0, 20),
  };
}

// ─── Rythme ──────────────────────────────────────────────────────────────────

/** Pages de campagne lues par passage (un passage toutes les 30 minutes, 1 à 2 s entre deux pages). */
export const MARKET_READS_PER_RUN = 40;
/** Une campagne lue est relue au bout de 3 jours (ses créateurs et ses vues bougent), tant qu'elle reste dans le plan de site. */
export const MARKET_REREAD_MS = 3 * DAY;
/** Une page qui ne se lit pas est réessayée le lendemain. */
export const MARKET_RETRY_MS = DAY;
/** Pages refusées d'affilée qui arrêtent le passage. */
export const MARKET_BREAKER = 4;
export const MARKET_PAUSE_MIN_MS = 1_000;
export const MARKET_PAUSE_MAX_MS = 2_000;
export function marketPauseMs(random: number): number {
  const r = Math.min(Math.max(random, 0), 1);
  return Math.round(MARKET_PAUSE_MIN_MS + r * (MARKET_PAUSE_MAX_MS - MARKET_PAUSE_MIN_MS));
}

// ─── Le produit promu, dit par l'IA ──────────────────────────────────────────

export const MARKET_KINDS = ["app", "software", "game", "other"] as const;
export type MarketKind = (typeof MARKET_KINDS)[number];
/** Ce qu'on propose de suivre : une app mobile ou un logiciel vendu sur le web. */
export const isProduct = (kind: MarketKind): boolean => kind === "app" || kind === "software";

/** Campagnes envoyées par appel. */
export const MARKET_JUDGE_BATCH = 25;

export const MARKET_SYSTEM = [
  "You read campaigns from a marketplace where brands pay short-form video creators per view.",
  "For each campaign, name the PRODUCT being promoted and say what it is.",
  'kind: "app" = a mobile app (iOS or Android); "software" = a website, SaaS, web tool, browser extension or AI tool people sign up for;',
  '"game" = a video game, including Roblox tools and mobile games; "other" = everything else: a streamer, YouTuber, podcast, musician or song, film or show,',
  "a person's brand, a shop or physical product, crypto tokens, trading, betting or casino, a political cause.",
  "product = the product's own name as people would search it (\"Abby AI\", \"Open Road\", \"systeme.io\"), never the agency running the campaign,",
  'never words like "Clipping", "Slideshow", "UGC", "Campaign". Empty string when kind is "other".',
  "handle = the product's TikTok or Instagram handle when the text gives one (without @), else an empty string.",
  "Answer for every campaign, using its id.",
].join(" ");

export const MARKET_SCHEMA = {
  type: "object",
  properties: {
    campaigns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: [...MARKET_KINDS] },
          product: { type: "string" },
          handle: { type: "string" },
        },
        required: ["id", "kind", "product", "handle"],
        additionalProperties: false,
      },
    },
  },
  required: ["campaigns"],
  additionalProperties: false,
} as const;

export type MarketToJudge = { id: string; name: string; org: string; description: string };

export function marketPrompt(batch: readonly MarketToJudge[]): string {
  return batch.map((c) => `id: ${c.id}\ncampaign: ${c.name}\nrun by: ${c.org || "?"}\ndescription: ${c.description || "(none)"}`).join("\n\n");
}

export type MarketJudgement = { id: string; kind: MarketKind; product: string; handle: string };

/**
 * La réponse de l'IA ramenée à ce qu'on peut écrire : une ligne par campagne DEMANDÉE (une campagne inventée ou
 * répétée est écartée), une nature connue, un nom de produit propre. Un « produit » sans nom devient « autre » :
 * on ne propose pas de suivre une app qu'on ne sait pas nommer.
 */
export function marketAnswer(raw: unknown, batch: readonly MarketToJudge[]): MarketJudgement[] {
  const asked = new Set(batch.map((c) => c.id));
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { campaigns?: unknown }).campaigns) ? (raw as { campaigns: unknown[] }).campaigns : [];
  const out: MarketJudgement[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const id = str(x.id);
    if (!asked.has(id)) continue;
    asked.delete(id);
    const kind = (MARKET_KINDS as readonly string[]).includes(str(x.kind)) ? (str(x.kind) as MarketKind) : "other";
    const product = tidy(str(x.product), 60);
    const handle = str(x.handle).replace(/^@/, "").toLowerCase();
    const named = isProduct(kind) && productKey(product) !== "";
    out.push({ id, kind: isProduct(kind) && !named ? "other" : kind, product: named ? product : "", handle: named && /^[a-z0-9._]{2,30}$/.test(handle) ? handle : "" });
  }
  return out;
}

/** Le nom d'un produit ramené à ses lettres et chiffres (« Abby AI » → « abbyai », « systeme.io » → « systemeio ») : la clé qui réunit ses campagnes. */
export function productKey(product: string): string {
  return product
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** La clé d'un produit parmi les apps repérées. */
export const marketCandidateKey = (product: string): string => `market:${productKey(product)}`;

/**
 * Les motifs proposés pour suivre le produit : son nom collé (« abbyai »), et son pseudo quand la campagne le
 * donne et qu'il dit autre chose (« openroadapp »). Un nom de moins de 4 lettres n'est pas un motif (« Elb »).
 */
export function marketPatterns(product: string, handle: string): string[] {
  const out: string[] = [];
  const name = productKey(product);
  if (name.length >= 4) out.push(name);
  const h = productKey(handle);
  if (h.length >= 4 && !out.includes(h)) out.push(h);
  return out;
}

export type MarketTotals = { campaigns: number; creators: number; views: number; spentCents: number; rateCents: number | null };

/** Les campagnes d'un même produit additionnées ; le tarif retenu est le plus haut. */
export function marketTotals(campaigns: readonly { creators?: number; views?: number; spentCents?: number; rateCents?: number | null }[]): MarketTotals {
  const rates = campaigns.map((c) => c.rateCents).filter((r): r is number => typeof r === "number");
  return {
    campaigns: campaigns.length,
    creators: campaigns.reduce((s, c) => s + (c.creators ?? 0), 0),
    views: campaigns.reduce((s, c) => s + (c.views ?? 0), 0),
    spentCents: campaigns.reduce((s, c) => s + (c.spentCents ?? 0), 0),
    rateCents: rates.length ? Math.max(...rates) : null,
  };
}

/**
 * Lit une page publique (plan de site, campagne) : son texte, « absent » (404, 410), ou « suspect » (tout autre
 * refus, erreur réseau). Aucun en-tête de navigateur : on se présente comme ce qu'on est.
 */
export async function fetchMarketPage(url: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; text: string } | { ok: false; kind: "absent" | "suspect" }> {
  try {
    const r = await fetchImpl(url, { headers: { Accept: "text/html,application/xml" } });
    if (r.status === 404 || r.status === 410) return { ok: false, kind: "absent" };
    if (!r.ok) return { ok: false, kind: "suspect" };
    return { ok: true, text: await r.text() };
  } catch {
    return { ok: false, kind: "suspect" };
  }
}
