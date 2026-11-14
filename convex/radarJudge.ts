/**
 * RADAR — LE JUGEMENT SÉMANTIQUE, PHASE A : l'IA juge, rien n'agit (règles : convex/radarJudgeMath). Toutes les
 * 30 minutes :
 *  1. les apps actives (20 par appel) : numérique ou non, type de produit, ses créateurs parlent-ils de CE produit
 *     → `radarApps.nature` ;
 *  2. les comptes actifs à preuve faible (12 par appel, 60 par passage), parcourus par un curseur : pousse-t-il CE
 *     produit → `radarAccountJudgments`.
 * Aucun compte, aucune app ne change de statut ; rien ne part vers Swarm. Payé sur le poste « Analyse IA ».
 * Sans la clé du fournisseur de données ni ANTHROPIC_API_KEY (tests, intégration continue), rien ne part.
 */
import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { e2eMutation } from "./functions";
import { FAMILY_MODEL, haikuCostUsd } from "./radarFamiliesMath";
import { NICHE_BIOS_MAX, nicheTexts } from "./radarFicheMath";
import {
  ACCOUNT_BATCH,
  outOfScope,
  verdictAction,
  type VerdictAction,
  ACCOUNT_SCHEMA,
  ACCOUNT_SYSTEM,
  ACCOUNT_VERDICTS,
  ABOUT,
  NATURE_BATCH,
  NATURE_SCHEMA,
  NATURE_SYSTEM,
  PRODUCT_KINDS,
  accountAnswer,
  accountPrompt,
  accountTexts,
  natureAnswer,
  natureDue,
  naturePrompt,
  weakProof,
  type AccountJudgment,
  type AccountToJudge,
  type AppNature,
  type NatureToJudge,
  type WeakWhy,
} from "./radarJudgeMath";
import { MEDIAN_WINDOW, findApp } from "./radarNetworkMath";
import { productKey } from "./radarMarketMath";
import { moveAccount, refreshAppNet } from "./radarSignals";
import { allowanceUsd, budgetState } from "./radarSignalsMath";
import { proofDetail, type ProofDetail } from "./radarVetMath";
import { scKeyPresent } from "./scrapeCreatorsApi";

const MIN_ALLOWANCE_USD = 0.01;
/** Comptes actifs lus par app pour savoir ce que ses créateurs écrivent, cités, et vidéos lues par compte cité. */
const ACCOUNTS_READ = 60;
const ACCOUNTS_QUOTED = 6;
const VIDEOS_PER_ACCOUNT = 3;
/** Comptes parcourus par passage pour trouver ceux à preuve faible, et jugés par passage au plus (5 appels). */
const JUDGE_SCAN = 150;
const JUDGE_PER_RUN = 5 * ACCOUNT_BATCH;

// ─── 1. Les apps ─────────────────────────────────────────────────────────────

/** Ce qu'on sait d'une app, à donner à lire : sa fiche, et ce qu'écrivent ses comptes ACTIFS les plus en vue. */
async function natureEvidence(ctx: QueryCtx, app: Doc<"radarApps">): Promise<NatureToJudge> {
  const accounts = (await ctx.db.query("radarTracked").withIndex("by_app", (q) => q.eq("appId", app._id)).take(ACCOUNTS_READ))
    // Pas les comptes en pause « hors sujet » : la chanteuse rangée sous Hush ne dit rien de Hush.
    .filter((a) => a.status === "active")
    .sort((a, b) => (b.best7d?.views ?? 0) - (a.best7d?.views ?? 0) || (b.medianViews ?? 0) - (a.medianViews ?? 0));
  const texts: (string | undefined)[] = [];
  for (const acc of accounts.slice(0, ACCOUNTS_QUOTED)) {
    const videos = await ctx.db
      .query("radarTrackedVideos")
      .withIndex("by_account_published", (q) => q.eq("accountId", acc._id))
      .order("desc")
      .take(VIDEOS_PER_ACCOUNT);
    for (const x of videos) texts.push(x.hook, x.caption);
  }
  return {
    id: app._id,
    name: app.name,
    searches: app.searches,
    ...(app.pitch ? { pitch: app.pitch } : {}),
    ...(app.store ? { store: { genre: app.store.genre, artist: app.store.artist } } : {}),
    ...(app.market ? { market: { productKind: app.market.productKind, ...(app.market.about ? { about: app.market.about } : {}) } } : {}),
    texts: nicheTexts(texts),
    bios: nicheTexts(accounts.map((a) => a.bio), NICHE_BIOS_MAX),
  };
}

async function natureWorkCore(ctx: QueryCtx, now: number, limit: number, only?: (slug: string) => boolean): Promise<NatureToJudge[]> {
  const apps = (await ctx.db.query("radarApps").withIndex("by_status", (q) => q.eq("status", "active")).collect())
    .filter((a) => a.mergedInto === undefined && (!only || only(a.slug)) && natureDue(a, now))
    .sort((a, b) => (a.natureAt ?? 0) - (b.natureAt ?? 0) || a.createdAt - b.createdAt)
    .slice(0, limit);
  const out: NatureToJudge[] = [];
  for (const app of apps) {
    const e = await natureEvidence(ctx, app);
    // Rien à lire (aucun texte de créateur, ni fiche, ni phrase) : l'IA rangerait « autre » sans preuve (vu le 14/11 :
    // Crush Tracker, Snitch). L'app attend d'avoir des comptes qui en parlent.
    if (e.texts.length === 0 && e.bios.length === 0 && !e.store && !e.market && !e.pitch) continue;
    out.push(e);
  }
  return out;
}

export const natureWork = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: (ctx, { now, limit }): Promise<NatureToJudge[]> => natureWorkCore(ctx, now, limit),
});

const natureValidator = v.object({
  digital: v.boolean(),
  kind: v.union(...PRODUCT_KINDS.map((k) => v.literal(k))),
  aboutIt: v.union(...ABOUT.map((k) => v.literal(k))),
  why: v.string(),
});

async function applyNaturesCore(ctx: MutationCtx, answers: readonly { id: string; nature: AppNature }[], now: number): Promise<number> {
  let written = 0;
  for (const a of answers) {
    const id = ctx.db.normalizeId("radarApps", a.id);
    if (!id || !(await ctx.db.get(id))) continue;
    // Rangé à part : rien ne lit ce champ pour décider (phase A).
    await ctx.db.patch(id, { nature: a.nature, natureAt: now });
    written++;
  }
  return written;
}

export const applyNatures = internalMutation({
  args: { answers: v.array(v.object({ id: v.string(), nature: natureValidator })), now: v.number() },
  handler: (ctx, { answers, now }): Promise<number> => applyNaturesCore(ctx, answers, now),
});

// ─── 2. Les comptes à preuve faible ──────────────────────────────────────────

type JudgeItem = AccountToJudge & { appId: Id<"radarApps">; weak: WeakWhy; proof: ProofDetail };

/**
 * Les comptes à juger d'une page du parcours : actifs, preuve faible (radarJudgeMath.weakProof), pas encore jugés.
 * S'il y en a plus que `limit`, le curseur ne bouge pas : la page sera relue, les jugés sautés.
 */
/** Le compte à juger, s'il l'est : actif, d'une app connue, preuve faible, pas encore jugé. */
async function judgeItemFor(ctx: QueryCtx, t: Doc<"radarTracked">, apps: Map<Id<"radarApps">, Doc<"radarApps">>): Promise<JudgeItem | null> {
  if (t.status !== "active") return null;
  const app = apps.get(t.appId);
  if (!app) return null;
  const videos = (
    await ctx.db
      .query("radarTrackedVideos")
      .withIndex("by_account_published", (q) => q.eq("accountId", t._id))
      .order("desc")
      .take(MEDIAN_WINDOW)
  ).filter((x) => !x.platform);
  const proof = proofDetail(
    t.handle,
    t.bio,
    videos.map((x) => `${x.caption ?? ""} ${x.hook ?? ""}`),
    app,
    t.matchedBy,
  );
  const weak = weakProof(proof, t.matchedBy);
  if (!weak) return null;
  if (await ctx.db.query("radarAccountJudgments").withIndex("by_account", (q) => q.eq("accountId", t._id)).first()) return null;
  return {
    id: t._id,
    handle: t.handle,
    bio: t.bio ?? "",
    texts: accountTexts(videos),
    app: { name: app.name, searches: app.searches, ...(app.pitch ? { pitch: app.pitch } : {}), ...(app.store ? { store: { genre: app.store.genre, artist: app.store.artist } } : {}) },
    appId: app._id,
    weak,
    proof,
  };
}

async function judgeWorkCore(ctx: QueryCtx, cursor: string | null, limit: number): Promise<{ items: JudgeItem[]; cursor: string | null; done: boolean }> {
  const r = await ctx.db.query("radarTracked").paginate({ cursor, numItems: JUDGE_SCAN });
  const apps = new Map((await ctx.db.query("radarApps").collect()).map((a) => [a._id, a]));
  const items: JudgeItem[] = [];
  for (const t of r.page) {
    const item = await judgeItemFor(ctx, t, apps);
    if (!item) continue;
    // Plus de comptes à juger que la part du passage : la page sera relue (les jugés sautés), le curseur ne bouge pas.
    if (items.length >= limit) return { items, cursor, done: false };
    items.push(item);
  }
  return { items, cursor: r.continueCursor, done: r.isDone };
}

export const judgeWork = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), limit: v.number() },
  handler: (ctx, { cursor, limit }) => judgeWorkCore(ctx, cursor, limit),
});

const metaValidator = v.object({
  accountId: v.id("radarTracked"),
  appId: v.id("radarApps"),
  handle: v.string(),
  weak: v.string(),
  proof: v.object({ by: v.union(v.string(), v.null()), cites: v.number(), of: v.number() }),
});
const judgmentValidator = v.object({ id: v.string(), verdict: v.union(...ACCOUNT_VERDICTS.map((k) => v.literal(k))), other: v.optional(v.string()), why: v.string() });

async function applyJudgmentsCore(
  ctx: MutationCtx,
  answers: readonly AccountJudgment[],
  meta: readonly { accountId: Id<"radarTracked">; appId: Id<"radarApps">; handle: string; weak: string; proof: { by: string | null; cites: number; of: number } }[],
  now: number,
): Promise<number> {
  const byId = new Map(meta.map((m) => [m.accountId as string, m]));
  let written = 0;
  for (const a of answers) {
    const m = byId.get(a.id);
    if (!m) continue;
    if (await ctx.db.query("radarAccountJudgments").withIndex("by_account", (q) => q.eq("accountId", m.accountId)).first()) continue;
    // Rangé à part : le compte ne change pas (phase A).
    await ctx.db.insert("radarAccountJudgments", { ...m, verdict: a.verdict, ...(a.other ? { other: a.other } : {}), why: a.why, at: now });
    written++;
  }
  return written;
}

export const applyJudgments = internalMutation({
  args: { answers: v.array(judgmentValidator), meta: v.array(metaValidator), now: v.number() },
  handler: (ctx, { answers, meta, now }): Promise<number> => applyJudgmentsCore(ctx, answers, meta, now),
});

export const judgeCursor = internalQuery({
  args: {},
  handler: async (ctx): Promise<string | null> => (await ctx.db.query("radarSettings").first())?.judgeCursor ?? null,
});

export const setJudgeCursor = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const s = await ctx.db.query("radarSettings").first();
    if (s) await ctx.db.patch(s._id, { judgeCursor: cursor ?? undefined });
    return null;
  },
});

// ─── Les tâches ──────────────────────────────────────────────────────────────

type JudgeRun = { skipped: "no-key" | "no-ai-key" | "budget" } | { judged: number; calls: number; usd: number; error?: string };

/** Un appel à l'IA : la réponse JSON lue, son coût, ou ce qui l'a empêchée. */
async function askHaiku(system: string, schema: object, content: string): Promise<{ json: unknown; usd: number; error?: string }> {
  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: FAMILY_MODEL,
      max_tokens: 6_000,
      system,
      output_config: { effort: "low", format: { type: "json_schema", schema: schema as Record<string, unknown> } },
      messages: [{ role: "user", content }],
    });
    const usd = haikuCostUsd(response.usage);
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return { json: null, usd, error: `Analyse IA : réponse interrompue (${response.stop_reason})` };
    return { json: JSON.parse(response.content.find((b) => b.type === "text")?.text ?? "null"), usd };
  } catch (e) {
    return {
      json: null,
      usd: 0,
      error:
        e instanceof Anthropic.RateLimitError
          ? "Analyse IA : trop de demandes, nouvel essai au prochain passage"
          : e instanceof Anthropic.AuthenticationError
            ? "Analyse IA : clé ANTHROPIC_API_KEY refusée"
            : e instanceof Anthropic.APIError
              ? `Analyse IA : erreur ${e.status ?? "réseau"}`
              : "Analyse IA : réponse illisible",
    };
  }
}

async function aiAllowed(ctx: ActionCtx, now: number): Promise<"no-key" | "no-ai-key" | "budget" | null> {
  if (!scKeyPresent()) return "no-key";
  if (!process.env.ANTHROPIC_API_KEY) return "no-ai-key";
  const st = await ctx.runQuery(internal.radarSignals.jobState, { now });
  return allowanceUsd(st.budget, budgetState(st.budget, st.usage, st.balance), "ai") < MIN_ALLOWANCE_USD ? "budget" : null;
}

export const runAppNatures = internalAction({
  args: {},
  handler: async (ctx): Promise<JudgeRun> => {
    const now = Date.now();
    const blocked = await aiAllowed(ctx, now);
    if (blocked) return { skipped: blocked };
    const batch: NatureToJudge[] = await ctx.runQuery(internal.radarJudge.natureWork, { now, limit: NATURE_BATCH });
    if (batch.length === 0) return { judged: 0, calls: 0, usd: 0 };
    const r = await askHaiku(NATURE_SYSTEM, NATURE_SCHEMA, naturePrompt(batch));
    const judged = r.json ? await ctx.runMutation(internal.radarJudge.applyNatures, { answers: natureAnswer(r.json, batch), now }) : 0;
    await ctx.runMutation(internal.radarSignals.recordRun, { poste: "ai", credits: 0, calls: 1, errors: r.error ? 1 : 0, now, usd: r.usd, ...(r.error ? { lastError: r.error } : {}) });
    return { judged, calls: 1, usd: r.usd, ...(r.error ? { error: r.error } : {}) };
  },
});

export const runAccountJudgments = internalAction({
  args: {},
  handler: async (ctx): Promise<JudgeRun> => {
    const now = Date.now();
    const blocked = await aiAllowed(ctx, now);
    if (blocked) return { skipped: blocked };
    const cursor: string | null = await ctx.runQuery(internal.radarJudge.judgeCursor, {});
    const work: { items: JudgeItem[]; cursor: string | null; done: boolean } = await ctx.runQuery(internal.radarJudge.judgeWork, { cursor, limit: JUDGE_PER_RUN });
    let judged = 0;
    let usd = 0;
    let calls = 0;
    let error: string | undefined;
    for (let i = 0; i < work.items.length; i += ACCOUNT_BATCH) {
      const batch = work.items.slice(i, i + ACCOUNT_BATCH);
      const r = await askHaiku(ACCOUNT_SYSTEM, ACCOUNT_SCHEMA, accountPrompt(batch));
      calls++;
      usd += r.usd;
      if (r.error) {
        error = r.error;
        break;
      }
      judged += await ctx.runMutation(internal.radarJudge.applyJudgments, {
        answers: accountAnswer(r.json, batch),
        meta: batch.map((b) => ({ accountId: b.id as Id<"radarTracked">, appId: b.appId, handle: b.handle, weak: b.weak, proof: b.proof })),
        now,
      });
    }
    // Une page dont des comptes restent à juger (erreur en route) est relue au passage suivant.
    if (!error) await ctx.runMutation(internal.radarJudge.setJudgeCursor, { cursor: work.done ? null : work.cursor });
    if (calls) await ctx.runMutation(internal.radarSignals.recordRun, { poste: "ai", credits: 0, calls, errors: error ? 1 : 0, now, usd, ...(error ? { lastError: error } : {}) });
    return { judged, calls, usd, ...(error ? { error } : {}) };
  },
});

// ─── e2e (l'appel à l'IA n'est pas joué : la réponse est donnée) ──────────────

export const e2eJudgeNatures = e2eMutation({
  args: { slugs: v.array(v.string()), answers: v.array(v.object({ slug: v.string(), nature: natureValidator })) },
  handler: async (ctx, { slugs, answers }) => {
    const now = Date.now();
    const batch = await natureWorkCore(ctx, now, NATURE_BATCH, (slug) => slugs.includes(slug));
    const idOf = new Map<string, string>();
    for (const slug of slugs) {
      const app = await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
      if (app) idOf.set(slug, app._id);
    }
    const raw = { products: answers.map((a) => ({ id: idOf.get(a.slug) ?? a.slug, ...a.nature })) };
    const written = await applyNaturesCore(ctx, natureAnswer(raw, batch), now);
    return { asked: batch.map((b) => ({ name: b.name, texts: b.texts, bios: b.bios })), prompt: naturePrompt(batch), written };
  },
});

export const e2eJudgeAccounts = e2eMutation({
  args: { handles: v.array(v.string()), answers: v.array(v.object({ handle: v.string(), verdict: v.union(...ACCOUNT_VERDICTS.map((k) => v.literal(k))), other: v.optional(v.string()), why: v.string() })) },
  handler: async (ctx, { handles, answers }) => {
    const now = Date.now();
    // Les comptes donnés, retrouvés par leur pseudo (une seule pagination par fonction : pas de parcours ici).
    const apps = new Map((await ctx.db.query("radarApps").collect()).map((a) => [a._id, a]));
    const asked: JudgeItem[] = [];
    for (const handle of handles) {
      const t = await ctx.db.query("radarTracked").withIndex("by_handle", (q) => q.eq("platform", "tiktok").eq("handle", handle)).first();
      const item = t ? await judgeItemFor(ctx, t, apps) : null;
      if (item) asked.push(item);
    }
    const idOf = new Map(asked.map((a) => [a.handle, a.id]));
    const written = await applyJudgmentsCore(
      ctx,
      accountAnswer({ accounts: answers.map((a) => ({ id: idOf.get(a.handle) ?? a.handle, verdict: a.verdict, other: a.other ?? "", why: a.why })) }, asked),
      asked.map((b) => ({ accountId: b.id as Id<"radarTracked">, appId: b.appId, handle: b.handle, weak: b.weak, proof: b.proof })),
      now,
    );
    // Rien n'agit : chaque compte garde son statut.
    const statuses: Record<string, string | null> = {};
    for (const handle of handles) {
      const t = await ctx.db.query("radarTracked").withIndex("by_handle", (q) => q.eq("platform", "tiktok").eq("handle", handle)).first();
      statuses[handle] = t?.status ?? null;
    }
    return { asked: asked.map((a) => ({ handle: a.handle, weak: a.weak, proof: a.proof, texts: a.texts.length })), prompt: accountPrompt(asked), written, statuses };
  },
});

// ─── Phase B : les jugements agissent (définitions du fondateur du 14/11/2026) ─

/** Jugements de comptes appliqués par passage, et apps regardées pour le périmètre. */
const APPLY_BATCH = 60;

/** L'app suivie qui porte ce nom (nom collé identique, sinon ses motifs dans le nom), parmi les apps non fondues. */
function followedByName(name: string, apps: readonly Doc<"radarApps">[]): Doc<"radarApps"> | null {
  const key = productKey(name);
  const live = apps.filter((a) => a.mergedInto === undefined);
  return (key.length >= 4 ? live.find((a) => productKey(a.name) === key) : undefined) ?? findApp(name, "", live) ?? null;
}

/** Une piste : l'app que ce compte pousse à la place de la sienne, rangée parmi les apps repérées (kind « ia »). */
async function noteLead(ctx: MutationCtx, product: string, handle: string, fromApp: Id<"radarApps">, now: number): Promise<void> {
  const key = `ia:${productKey(product)}`;
  const got = await ctx.db.query("radarAppCandidates").withIndex("by_key", (q) => q.eq("key", key)).first();
  const example = { handle, url: `https://www.tiktok.com/@${handle}` };
  if (!got) {
    await ctx.db.insert("radarAppCandidates", {
      key,
      kind: "ia",
      label: product,
      authors: [handle],
      authorCount: 1,
      fromApps: [fromApp],
      examples: [example],
      status: "new",
      firstSeenAt: now,
      lastSeenAt: now,
    });
    return;
  }
  if (got.authors.includes(handle)) return;
  await ctx.db.patch(got._id, {
    authors: [...got.authors, handle].slice(0, 50),
    authorCount: got.authorCount + 1,
    fromApps: got.fromApps.includes(fromApp) ? got.fromApps : [...got.fromApps, fromApp],
    examples: [...got.examples, example].slice(0, 10),
    lastSeenAt: now,
    // Un deuxième compte la désigne : le suivi d'office la regarde de nouveau (radarAutoMath.autoPlan, « ia »).
    autoAt: undefined,
    autoNote: undefined,
  });
}

/** Applique les jugements de comptes pas encore appliqués. Rend ce qui a été fait, par genre. */
async function applyVerdictsCore(ctx: MutationCtx, now: number, only?: (handle: string) => boolean): Promise<Record<string, number>> {
  const done: Record<string, number> = {};
  const rows = await ctx.db
    .query("radarAccountJudgments")
    .withIndex("by_applied", (q) => q.eq("appliedAt", undefined))
    .take(APPLY_BATCH * 4);
  const apps = await ctx.db.query("radarApps").collect();
  const touched = new Set<Id<"radarApps">>();
  let n = 0;
  for (const j of rows) {
    if (only && !only(j.handle)) continue;
    if (n++ >= APPLY_BATCH) break;
    const acc = await ctx.db.get(j.accountId);
    let action: VerdictAction = { kind: "none" };
    // Jugé sous une autre app que la sienne aujourd'hui (déplacé depuis) : le jugement ne vaut plus.
    if (acc && acc.appId === j.appId) {
      action = verdictAction(j, acc, (name) => {
        const a = followedByName(name, apps);
        return a ? { id: a._id, active: a.status === "active" } : null;
      });
    }
    if (acc && action.kind === "pause") {
      await ctx.db.patch(acc._id, { status: "paused", pausedReason: "offTopic" });
      touched.add(acc.appId);
    } else if (acc && action.kind === "placement") {
      await ctx.db.patch(acc._id, { placement: true });
      touched.add(acc.appId);
    } else if (acc && action.kind === "move") {
      const from = apps.find((a) => a._id === acc.appId);
      const to = apps.find((a) => a._id === action.to);
      if (from && to && from._id !== to._id) {
        const recent = await ctx.db.query("radarTrackedVideos").withIndex("by_account_published", (q) => q.eq("accountId", acc._id)).order("desc").take(100);
        await moveAccount(ctx, acc, from, to, recent);
        // Relevé tout de suite sous sa nouvelle app : jugé sur ses motifs.
        await ctx.db.patch(acc._id, { nextReadAt: now });
        touched.add(from._id);
        touched.add(to._id);
      }
    } else if (acc && action.kind === "lead") {
      await ctx.db.patch(acc._id, { status: "paused", pausedReason: "offTopic" });
      await noteLead(ctx, action.product, acc.handle, acc.appId, now);
      touched.add(acc.appId);
    }
    await ctx.db.patch(j._id, { appliedAt: now, applied: action.kind });
    done[action.kind] = (done[action.kind] ?? 0) + 1;
  }
  for (const id of touched) await refreshAppNet(ctx, id, now);
  return done;
}

/**
 * Les apps qui ne sont ni une app, ni un SaaS, ni un jeu mobile, sur un verdict net (radarJudgeMath.outOfScope) :
 * en pause dans le Radar — plus relevées, plus cherchées, plus envoyées à Swarm. Jamais une concurrente d'un projet,
 * ni une app remise en route à la main (`scopeByHand`).
 */
async function applyPerimeterCore(ctx: MutationCtx, now: number, only?: (slug: string) => boolean): Promise<string[]> {
  const paused: string[] = [];
  for (const a of await ctx.db.query("radarApps").withIndex("by_status", (q) => q.eq("status", "active")).collect()) {
    if (only && !only(a.slug)) continue;
    if (a.mergedInto !== undefined || a.rivalOf.length > 0 || a.scopeByHand || !outOfScope(a.nature, !!a.store)) continue;
    await ctx.db.patch(a._id, { status: "paused", pausedReason: "perimetre" });
    await refreshAppNet(ctx, a._id, now);
    paused.push(a.slug);
  }
  return paused;
}

export const applyJudgmentsNow = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ verdicts: Record<string, number>; perimeter: string[] }> => {
    const now = Date.now();
    return { perimeter: await applyPerimeterCore(ctx, now), verdicts: await applyVerdictsCore(ctx, now) };
  },
});

/** e2e : applique les jugements des comptes et des apps donnés (rien d'autre n'est touché). */
export const e2eApplyJudgments = e2eMutation({
  args: { handles: v.array(v.string()), slugs: v.array(v.string()) },
  handler: async (ctx, { handles, slugs }) => {
    const now = Date.now();
    return {
      perimeter: await applyPerimeterCore(ctx, now, (s) => slugs.includes(s)),
      verdicts: await applyVerdictsCore(ctx, now, (h) => handles.includes(h)),
    };
  },
});

