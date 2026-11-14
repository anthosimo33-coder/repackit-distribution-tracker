/**
 * RADAR — APPS ET LOGICIELS QUI PAIENT DES CRÉATEURS (place de marché de campagnes). Les règles sont dans
 * convex/radarMarketMath ; ici les tâches et les écritures.
 *
 *  1. `runMarketList` (toutes les 6 heures) : le plan de site de la place de marché donne ses campagnes ; chaque
 *     campagne inconnue entre dans la file.
 *  2. `runMarketReads` (toutes les 30 minutes) : la page publique de 40 campagnes — nom, marque ou agence,
 *     description, tarif, créateurs, vues, et les comptes TikTok de ses meilleurs clips. Aucun crédit.
 *  3. `runMarketJudge` (toutes les heures) : Claude Haiku lit nom et description de 25 campagnes et dit le
 *     produit promu et sa nature (poste « Analyse IA » du budget, moins d'un cent par appel). Une app ou un
 *     logiciel entre dans les apps repérées, ses campagnes additionnées ; un streamer, une chanson, un jeu, non.
 *
 * Rien n'est suivi d'office : l'app est PROPOSÉE à l'écran (onglet Comptes suivis), avec ce qu'elle paie et ses
 * comptes. « Suivre » crée l'app et rattache les comptes de ses meilleurs clips.
 */
import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { e2eMutation, permissionQuery, type ProjectQueryCtx } from "./functions";
import { ensureSettings, readSettings } from "./radarSignals";
import { allowanceUsd, budgetState } from "./radarSignalsMath";
import { FAMILY_MODEL, haikuCostUsd } from "./radarFamiliesMath";
import { alreadyFollowed } from "./radarStoreMath";
import { candidateFiche, marketAbout } from "./radarFicheMath";
import { scKeyPresent } from "./scrapeCreatorsApi";
import {
  fetchMarketPage,
  isProduct,
  marketAnswer,
  marketCandidateKey,
  MARKET_BREAKER,
  MARKET_CURRENCY,
  MARKET_JUDGE_BATCH,
  MARKET_READS_PER_RUN,
  MARKET_REREAD_MS,
  MARKET_RETRY_MS,
  MARKET_SCHEMA,
  MARKET_SITEMAP_URL,
  MARKET_SOURCE,
  MARKET_SYSTEM,
  marketPatterns,
  marketPauseMs,
  marketPrompt,
  marketTotals,
  parseCampaignPage,
  parseMarketSitemap,
  type MarketJudgement,
  type MarketToJudge,
} from "./radarMarketMath";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Sous ce reste d'enveloppe, on n'appelle pas l'IA (un appel coûte moins d'un cent). */
const MIN_ALLOWANCE_USD = 0.01;
/** Campagnes écrites par mutation quand le plan de site en apporte beaucoup. */
const LIST_BATCH = 200;
/** Comptes gardés au plus pour un produit (ceux de ses meilleurs clips, toutes campagnes confondues). */
const MAX_HANDLES = 50;

// ─── 1. La liste des campagnes ───────────────────────────────────────────────

/** Les campagnes inconnues entrent dans la file, à lire tout de suite. Rend combien sont nouvelles. */
async function upsertCampaignsCore(ctx: MutationCtx, source: string, campaigns: readonly { campaignId: string; url: string }[], now: number): Promise<number> {
  let added = 0;
  for (const c of campaigns) {
    const got = await ctx.db.query("radarMarketCampaigns").withIndex("by_campaign", (q) => q.eq("source", source).eq("campaignId", c.campaignId)).first();
    if (got) continue;
    await ctx.db.insert("radarMarketCampaigns", { source, campaignId: c.campaignId, url: c.url, firstSeenAt: now, nextReadAt: now, stage: "new" });
    added++;
  }
  if (added) {
    const s = await ensureSettings(ctx);
    await ctx.db.patch(s._id, { marketSeen: (s.marketSeen ?? 0) + added });
  }
  return added;
}

export const upsertCampaigns = internalMutation({
  args: { campaigns: v.array(v.object({ campaignId: v.string(), url: v.string() })), now: v.number() },
  handler: (ctx, { campaigns, now }): Promise<number> => upsertCampaignsCore(ctx, MARKET_SOURCE, campaigns, now),
});

export const noteMarketRun = internalMutation({
  args: { read: v.number(), judged: v.number(), stopped: v.union(v.string(), v.null()), now: v.number() },
  handler: async (ctx, { read, judged, stopped, now }) => {
    const s = await ensureSettings(ctx);
    await ctx.db.patch(s._id, { lastMarketAt: now, marketRead: (s.marketRead ?? 0) + read, marketJudged: (s.marketJudged ?? 0) + judged, lastMarketStop: stopped ?? undefined });
    return null;
  },
});

export const runMarketList = internalAction({
  args: {},
  handler: async (ctx): Promise<{ seen: number; added: number } | { skipped: "unreadable" | "no-key" }> => {
    // Sans la clé du fournisseur de données (tests, intégration continue), le Radar ne collecte rien.
    if (!scKeyPresent()) return { skipped: "no-key" };
    const page = await fetchMarketPage(MARKET_SITEMAP_URL);
    if (!page.ok) {
      await ctx.runMutation(internal.radarMarket.noteMarketRun, { read: 0, judged: 0, stopped: "plan de site illisible", now: Date.now() });
      return { skipped: "unreadable" };
    }
    const campaigns = parseMarketSitemap(page.text);
    let added = 0;
    for (let i = 0; i < campaigns.length; i += LIST_BATCH) {
      added += await ctx.runMutation(internal.radarMarket.upsertCampaigns, { campaigns: campaigns.slice(i, i + LIST_BATCH), now: Date.now() });
    }
    return { seen: campaigns.length, added };
  },
});

// ─── 2. La lecture d'une campagne ────────────────────────────────────────────

type DueCampaign = { id: Doc<"radarMarketCampaigns">["_id"]; url: string };

export const dueCampaigns = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }): Promise<DueCampaign[]> => {
    const rows = await ctx.db
      .query("radarMarketCampaigns")
      .withIndex("by_due", (q) => q.lte("nextReadAt", now))
      .take(Math.max(0, limit));
    return rows.map((r) => ({ id: r._id, url: r.url }));
  },
});

const readValidator = v.object({
  name: v.string(),
  org: v.string(),
  description: v.string(),
  launchedAt: v.union(v.number(), v.null()),
  rateCents: v.union(v.number(), v.null()),
  creators: v.number(),
  views: v.number(),
  spentCents: v.number(),
  handles: v.array(v.string()),
});

/** Refait l'app repérée d'un produit à partir de TOUTES ses campagnes (chiffres additionnés, comptes réunis). */
async function refreshMarketCandidate(ctx: MutationCtx, key: string, now: number): Promise<"created" | "updated" | null> {
  const campaigns = await ctx.db.query("radarMarketCampaigns").withIndex("by_candidate", (q) => q.eq("candidateKey", key)).take(50);
  const first = campaigns.find((c) => c.product && c.kind && isProduct(c.kind));
  if (!first || !first.kind || !isProduct(first.kind)) return null;
  // La campagne la plus vue porte le lien et le nom de qui paie.
  const lead = [...campaigns].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
  const handles = [...new Set(campaigns.flatMap((c) => c.handles ?? []))].slice(0, MAX_HANDLES);
  const totals = marketTotals(campaigns);
  const fields = {
    label: first.product!,
    authors: handles,
    authorCount: handles.length,
    examples: handles.slice(0, 5).map((handle) => ({ handle, url: `https://www.tiktok.com/@${handle}` })),
    lastSeenAt: now,
    market: {
      source: first.source,
      productKind: first.kind as "app" | "software",
      handle: campaigns.find((c) => c.productHandle)?.productHandle ?? "",
      org: lead.org ?? "",
      campaignUrl: lead.url,
      campaigns: totals.campaigns,
      creators: totals.creators,
      views: totals.views,
      spentCents: totals.spentCents,
      ...(totals.rateCents !== null ? { rateCents: totals.rateCents } : {}),
      // Ce que la campagne dit du produit : la matière de sa fiche (convex/radarFiche).
      ...(marketAbout(lead.description) ? { about: marketAbout(lead.description) } : {}),
    },
  };
  const got = await ctx.db.query("radarAppCandidates").withIndex("by_key", (q) => q.eq("key", key)).first();
  if (got) {
    await ctx.db.patch(got._id, fields);
    // Déjà une app suivie : les chiffres de ses campagnes y suivent.
    if (got.appId && (await ctx.db.get(got.appId))) await ctx.db.patch(got.appId, candidateFiche(fields));
    return "updated";
  }
  await ctx.db.insert("radarAppCandidates", { key, kind: "market", fromApps: [], status: "new", firstSeenAt: now, ...fields });
  return "created";
}

/** Écrit ce que sa page dit d'une campagne ; `read` nul = page illisible ou campagne retirée, réessayée demain. */
export const applyCampaignRead = internalMutation({
  args: { id: v.id("radarMarketCampaigns"), read: v.union(readValidator, v.null()), now: v.number() },
  handler: async (ctx, { id, read, now }): Promise<null> => {
    const c = await ctx.db.get(id);
    if (!c) return null;
    if (!read) {
      await ctx.db.patch(id, { nextReadAt: now + MARKET_RETRY_MS });
      return null;
    }
    await ctx.db.patch(id, {
      readAt: now,
      nextReadAt: now + MARKET_REREAD_MS,
      stage: c.stage === "judged" ? "judged" : "read",
      name: read.name,
      org: read.org,
      description: read.description,
      ...(read.launchedAt !== null ? { launchedAt: read.launchedAt } : {}),
      ...(read.rateCents !== null ? { rateCents: read.rateCents } : {}),
      creators: read.creators,
      views: read.views,
      spentCents: read.spentCents,
      handles: read.handles,
    });
    // Relue : les chiffres et les comptes de son produit suivent.
    if (c.candidateKey) await refreshMarketCandidate(ctx, c.candidateKey, now);
    return null;
  },
});

export const runMarketReads = internalAction({
  args: {},
  handler: async (ctx): Promise<{ read: number; stopped: string | null } | { skipped: "no-key" }> => {
    if (!scKeyPresent()) return { skipped: "no-key" };
    const due: DueCampaign[] = await ctx.runQuery(internal.radarMarket.dueCampaigns, { now: Date.now(), limit: MARKET_READS_PER_RUN });
    let read = 0;
    let suspects = 0;
    let stopped: string | null = null;
    for (const [i, c] of due.entries()) {
      if (i > 0) await sleep(marketPauseMs(Math.random()));
      const page = await fetchMarketPage(c.url);
      const parsed = page.ok ? parseCampaignPage(page.text) : null;
      // Une page refusée (ni lue, ni « absente ») compte pour le coupe-circuit ; une campagne retirée, non.
      suspects = !page.ok && page.kind === "suspect" ? suspects + 1 : 0;
      await ctx.runMutation(internal.radarMarket.applyCampaignRead, { id: c.id, read: parsed, now: Date.now() });
      if (parsed) read++;
      if (suspects >= MARKET_BREAKER) {
        stopped = `${MARKET_BREAKER} pages refusées d'affilée`;
        break;
      }
    }
    await ctx.runMutation(internal.radarMarket.noteMarketRun, { read, judged: 0, stopped, now: Date.now() });
    return { read, stopped };
  },
});

// ─── 3. Le produit promu ─────────────────────────────────────────────────────

export const campaignsToJudge = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }): Promise<MarketToJudge[]> => {
    const rows = await ctx.db
      .query("radarMarketCampaigns")
      .withIndex("by_stage", (q) => q.eq("stage", "read"))
      .take(Math.max(0, limit));
    return rows.map((r) => ({ id: r._id as string, name: r.name ?? "", org: r.org ?? "", description: r.description ?? "" }));
  },
});

const judgementValidator = v.object({ id: v.string(), kind: v.union(v.literal("app"), v.literal("software"), v.literal("game"), v.literal("other")), product: v.string(), handle: v.string() });

/** Écrit ce que l'IA a dit de chaque campagne ; une app ou un logiciel entre dans les apps repérées. Rend combien y sont entrées. */
async function applyJudgementsCore(ctx: MutationCtx, judgements: readonly MarketJudgement[], now: number): Promise<number> {
  let created = 0;
  for (const j of judgements) {
    const id = ctx.db.normalizeId("radarMarketCampaigns", j.id);
    const c = id ? await ctx.db.get(id) : null;
    if (!c) continue;
    const key = isProduct(j.kind) ? marketCandidateKey(j.product) : undefined;
    await ctx.db.patch(c._id, { stage: "judged", judgedAt: now, kind: j.kind, product: j.product || undefined, productHandle: j.handle || undefined, candidateKey: key });
    if (key && (await refreshMarketCandidate(ctx, key, now)) === "created") created++;
  }
  return created;
}

export const applyJudgements = internalMutation({
  args: { judgements: v.array(judgementValidator), now: v.number() },
  handler: (ctx, { judgements, now }): Promise<number> => applyJudgementsCore(ctx, judgements, now),
});

export const runMarketJudge = internalAction({
  args: {},
  handler: async (ctx): Promise<{ skipped: "no-key" | "budget" | "rien" } | { judged: number; found: number; usd: number }> => {
    if (!process.env.ANTHROPIC_API_KEY) return { skipped: "no-key" };
    const now = Date.now();
    const st = await ctx.runQuery(internal.radarSignals.jobState, { now });
    if (allowanceUsd(st.budget, budgetState(st.budget, st.usage, st.balance), "ai") < MIN_ALLOWANCE_USD) return { skipped: "budget" };
    const batch: MarketToJudge[] = await ctx.runQuery(internal.radarMarket.campaignsToJudge, { limit: MARKET_JUDGE_BATCH });
    if (batch.length === 0) return { skipped: "rien" };

    const client = new Anthropic();
    let usd = 0;
    let judged = 0;
    let found = 0;
    let lastError: string | undefined;
    try {
      const response = await client.messages.create({
        model: FAMILY_MODEL,
        max_tokens: 6_000,
        system: MARKET_SYSTEM,
        // Nommer un produit, pas raisonner longuement : effort bas.
        output_config: { effort: "low", format: { type: "json_schema", schema: MARKET_SCHEMA } },
        messages: [{ role: "user", content: marketPrompt(batch) }],
      });
      usd = haikuCostUsd(response.usage);
      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
        lastError = `Analyse IA : réponse interrompue (${response.stop_reason})`;
      } else {
        const text = response.content.find((b) => b.type === "text")?.text ?? "";
        const judgements = marketAnswer(JSON.parse(text), batch);
        found = await ctx.runMutation(internal.radarMarket.applyJudgements, { judgements, now });
        judged = judgements.length;
      }
    } catch (e) {
      lastError =
        e instanceof Anthropic.RateLimitError
          ? "Analyse IA : trop de demandes, nouvel essai au prochain passage"
          : e instanceof Anthropic.AuthenticationError
            ? "Analyse IA : clé ANTHROPIC_API_KEY refusée"
            : e instanceof Anthropic.APIError
              ? `Analyse IA : erreur ${e.status ?? "réseau"}`
              : "Analyse IA : réponse illisible";
    }
    await ctx.runMutation(internal.radarSignals.recordRun, { poste: "ai", credits: 0, calls: 1, errors: lastError ? 1 : 0, now, usd, ...(lastError ? { lastError } : {}) });
    await ctx.runMutation(internal.radarMarket.noteMarketRun, { read: 0, judged, stopped: null, now: Date.now() });
    return { judged, found, usd };
  },
});

// ─── L'écran ─────────────────────────────────────────────────────────────────

/** Produits montrés au plus, ceux dont on connaît le plus de comptes d'abord. */
const MARKET_LIST_CAP = 60;

export async function listMarketCandidatesCore(ctx: ProjectQueryCtx) {
  const rows = await ctx.db
    .query("radarAppCandidates")
    .withIndex("by_kind_status_count", (q) => q.eq("kind", "market").eq("status", "new"))
    .order("desc")
    .take(MARKET_LIST_CAP);
  const s = await readSettings(ctx);
  // Un produit déjà suivi (sous ce motif) n'est plus à proposer.
  const followed = (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
  return {
    apps: rows.flatMap((c) => {
      const m = c.market;
      const patterns = m ? marketPatterns(c.label, m.handle) : [];
      if (!m || alreadyFollowed(patterns, followed)) return [];
      return [
        {
          id: c._id,
          // Le nom et les motifs proposés pour la suivre.
          name: c.label,
          patterns,
          // Pourquoi le suivi d'office ne l'a pas pris (convex/radarAuto), s'il l'a regardé.
          note: c.autoNote ?? null,
          productKind: m.productKind,
          org: m.org,
          campaignUrl: m.campaignUrl,
          campaigns: m.campaigns,
          creators: m.creators,
          views: m.views,
          spentUsd: m.spentCents / 100,
          rateUsd: m.rateCents !== undefined ? m.rateCents / 100 : null,
          handles: c.authors.slice(0, 8).map((handle) => ({ handle, url: `https://www.tiktok.com/@${handle}` })),
          accounts: c.authorCount,
          firstSeenAt: c.firstSeenAt,
        },
      ];
    }),
    // La devise de ses montants : celle de la place de marché, pas celle du projet.
    currency: MARKET_CURRENCY,
    // Où en est la collecte : campagnes connues, lues, jugées ; dernier passage.
    seen: s?.marketSeen ?? 0,
    read: s?.marketRead ?? 0,
    judged: s?.marketJudged ?? 0,
    lastAt: s?.lastMarketAt ?? null,
    stopped: s?.lastMarketStop ?? null,
  };
}

export const listMarketCandidates = permissionQuery("radar.use")({
  args: {},
  handler: (ctx) => listMarketCandidatesCore(ctx),
});

// ─── E2E ─────────────────────────────────────────────────────────────────────

/** e2e : des campagnes déjà lues (la vraie collecte ne tourne pas en e2e). Rend leurs identifiants, dans l'ordre. */
export const e2eSeedMarketCampaigns = e2eMutation({
  args: { campaigns: v.array(v.object({ campaignId: v.string(), read: readValidator })) },
  handler: async (ctx, { campaigns }): Promise<string[]> => {
    const now = Date.now();
    const ids: string[] = [];
    for (const c of campaigns) {
      const url = `https://contentrewards.com/c/campaigns/${c.campaignId}`;
      await upsertCampaignsCore(ctx, MARKET_SOURCE, [{ campaignId: c.campaignId, url }], now);
      const row = await ctx.db.query("radarMarketCampaigns").withIndex("by_campaign", (q) => q.eq("source", MARKET_SOURCE).eq("campaignId", c.campaignId)).first();
      if (!row) continue;
      await ctx.runMutation(internal.radarMarket.applyCampaignRead, { id: row._id, read: c.read, now });
      ids.push(row._id);
    }
    return ids;
  },
});

/** e2e : ce que l'IA aurait répondu (elle n'est pas appelée en e2e), validé comme en vrai puis écrit. */
export const e2eJudgeMarket = e2eMutation({
  args: { answer: v.any() },
  handler: async (ctx, { answer }): Promise<{ judged: number; found: number }> => {
    const batch = (await ctx.db.query("radarMarketCampaigns").withIndex("by_stage", (q) => q.eq("stage", "read")).take(200)).map((r) => ({ id: r._id as string, name: r.name ?? "", org: r.org ?? "", description: r.description ?? "" }));
    const judgements = marketAnswer(answer, batch);
    return { judged: judgements.length, found: await applyJudgementsCore(ctx, judgements, Date.now()) };
  },
});

/** e2e : efface les campagnes dont l'identifiant commence par `prefix`, et les apps repérées qu'elles nourrissent. */
export const e2eClearMarket = e2eMutation({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }): Promise<number> => {
    const rows = await ctx.db
      .query("radarMarketCampaigns")
      .withIndex("by_campaign", (q) => q.eq("source", MARKET_SOURCE).gte("campaignId", prefix).lt("campaignId", `${prefix}￿`))
      .collect();
    for (const r of rows) {
      if (r.candidateKey) {
        const c = await ctx.db.query("radarAppCandidates").withIndex("by_key", (q) => q.eq("key", r.candidateKey!)).first();
        if (c) await ctx.db.delete(c._id);
      }
      await ctx.db.delete(r._id);
    }
    return rows.length;
  },
});
